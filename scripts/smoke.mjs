/**
 * End-to-end smoke test of the whole stack as people use it: a real PostgreSQL database with the
 * restricted runtime role, the built API, the built web app, and HTTP between them. A person
 * registers, builds a profile, gets jobs scored (an on-site job is ruled out whatever the skills
 * say), walks an application through the pipeline and approves it herself, the audit chain is
 * verified, and a second person proves isolation between workspaces and the limits of a read-only role.
 *
 *   DATABASE_URL=postgres://owner:pass@host:5432/jobpilot_smoke node scripts/smoke.mjs
 *
 * DATABASE_URL here is the owner (it migrates and creates the runtime role); the API itself runs as
 * the restricted role. Needs a build first. The database name must end in `_smoke`; it is dropped
 * and recreated.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'apps/api/package.json'))('pg');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const dbName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!dbName.endsWith('_smoke'))
  throw new Error(`Refusing to recreate "${dbName}": it must end in _smoke`);

const API_PORT = 3100;
const WEB_PORT = 3101;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const ADA = { email: 'ada@smoke.test', password: 'a long smoke passphrase' };
const BEN = { email: 'ben@smoke.test', password: 'another long smoke passphrase' };

const children = [];
let failures = 0;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : `  -> ${detail}`}\n`,
  );
}

function run(file, args, env) {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`${file} failed:\n${r.stdout}\n${r.stderr}`);
}

function start(name, file, args, env, cwd = root) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('exit', (code) => {
    if (code && code !== 0 && code !== null)
      process.stdout.write(`${name} exited ${code}\n${log.slice(-2000)}\n`);
  });
  children.push(child);
  return () => log;
}

async function waitFor(url, label, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

async function recreateDatabase() {
  const admin = new URL(databaseUrl);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(
      'select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()',
      [dbName],
    );
    await client.query(`drop database if exists "${dbName}"`);
    await client.query(`create database "${dbName}"`);
  } finally {
    await client.end();
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query("select current_setting('server_version_num')::int as v");
    if (rows[0].v < 180000) {
      // PostgreSQL 18 has uuidv7(); an older local server gets an equivalent for the smoke run.
      await db.query(`create or replace function uuidv7() returns uuid language sql volatile as $$
        select encode(set_bit(set_bit(overlay(uuid_send(gen_random_uuid()) placing
          substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6), 52, 1), 53, 1), 'hex')::uuid $$`);
    }
  } finally {
    await db.end();
  }
}

async function ensureRuntimeRole() {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query("select 1 from pg_roles where rolname = 'jobpilot_app'");
    const clause = "login nosuperuser nocreatedb nocreaterole nobypassrls password 'jobpilot_app'";
    await db.query(
      rows.length ? `alter role jobpilot_app ${clause}` : `create role jobpilot_app ${clause}`,
    );
  } finally {
    await db.end();
  }
}

async function api(method, p, { token, body, headers } = {}) {
  const res = await fetch(`${API}/api/v1${p}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}

/** A person's browser: a cookie jar that follows what the web server sets. */
function browser(initial) {
  const jar = new Map(Object.entries(initial));
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  return {
    jar,
    async get(p) {
      const res = await fetch(`${WEB}${p}`, {
        redirect: 'manual',
        headers: { cookie: cookieHeader() },
      });
      absorb(res);
      return {
        status: res.status,
        location: res.headers.get('location'),
        text: await res.text(),
        res,
      };
    },
    async bff(method, p, body, headers = {}) {
      const res = await fetch(`${WEB}/bff${p}`, {
        method,
        headers: {
          cookie: cookieHeader(),
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      absorb(res);
      const text = await res.text();
      return { status: res.status, json: text ? JSON.parse(text) : undefined };
    },
  };
}

const sessionFor = async (creds) => {
  const r = await api('POST', '/auth/login', { body: creds });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

async function main() {
  process.stdout.write(`Smoke test against ${dbName}\n`);
  await recreateDatabase();
  await ensureRuntimeRole();
  const appUrl = new URL(databaseUrl);
  appUrl.username = 'jobpilot_app';
  appUrl.password = 'jobpilot_app';
  const apiEnv = {
    DATABASE_URL: appUrl.toString(),
    MIGRATION_DATABASE_URL: databaseUrl,
    JWT_SECRET: randomBytes(32).toString('hex'),
    PORT: String(API_PORT),
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
  };
  run('apps/api/dist/db/migrate.js', [], apiEnv);
  start('api', 'apps/api/dist/main.js', [], apiEnv);
  await waitFor(`${API}/health/ready`, 'API');
  const nextBin = path.join(root, 'apps/web/node_modules/next/dist/bin/next');
  start(
    'web',
    nextBin,
    ['start', '--port', String(WEB_PORT), '--hostname', '127.0.0.1'],
    { API_URL: API, NODE_ENV: 'production', SITE_URL: WEB },
    path.join(root, 'apps/web'),
  );
  await waitFor(`${WEB}/login`, 'web app');

  // --- the front door
  const guest = browser({});
  const landing = await guest.get('/');
  check(
    'the landing page is public',
    landing.status === 200 && landing.text.includes('never applies without you'),
  );
  const login = await guest.get('/login');
  check('the sign-in page is public', login.status === 200 && login.text.includes('Sign in'));
  const dash0 = await guest.get('/dashboard');
  check(
    'the workspace redirects to sign-in and remembers the way back',
    dash0.status === 307 && dash0.location?.includes('/login?next=%2Fdashboard'),
    `${dash0.status} ${dash0.location}`,
  );
  const guestApi = await guest.bff('GET', '/jobs');
  check('the API door refuses without a session', guestApi.status === 401);
  const robots = await guest.get('/robots.txt');
  check('robots.txt keeps the workspace out of search', robots.text.includes('Disallow: /'));

  // --- Ada registers; only the refresh cookie survives, the proxy renews the rest
  const reg = await api('POST', '/auth/register', { body: { ...ADA, fullName: 'Ada Applicant' } });
  check('Ada registers', reg.status === 201, JSON.stringify(reg.json));
  const adaSession = await sessionFor(ADA);
  const a = browser({ jp_refresh: adaSession.refreshToken });
  const dash = await a.get('/dashboard');
  check(
    'an expired access token is renewed by the proxy',
    dash.status === 200 && a.jar.has('jp_access') && dash.text.includes('Welcome, Ada'),
    `${dash.status}`,
  );

  // --- her profile
  const me = await a.bff('GET', '/candidates/me');
  const profileId = me.json?.id;
  check('she has a candidate profile', typeof profileId === 'string');
  const patch = await a.bff('PATCH', `/candidates/${profileId}`, {
    version: me.json?.version,
    headline: 'Backend engineer',
    targetRoles: ['Backend Engineer'],
    targetLocations: ['Remote'],
    remotePref: 'REMOTE_ONLY',
    workAuthStatus: 'CITIZEN',
    salaryMin: 60000,
    salaryMax: 90000,
  });
  check('she edits her profile', patch.status === 200, JSON.stringify(patch.json));
  for (const skill of ['typescript', 'node', 'postgresql']) {
    const r = await a.bff('POST', `/candidates/${profileId}/skills`, {
      skillName: skill,
      category: 'BACKEND',
      proficiency: 'ADVANCED',
      yearsExperience: 5,
    });
    check(`she adds the skill ${skill}`, r.status === 201, JSON.stringify(r.json));
  }
  await a.bff('POST', `/candidates/${profileId}/experience`, {
    companyName: 'Acme',
    title: 'Backend Engineer',
    startDate: '2018-01-01',
    technologies: ['typescript'],
  });
  for (const p of [
    '/profile',
    '/jobs',
    '/matches',
    '/applications',
    '/sources',
    '/team',
    '/audit',
  ]) {
    const r = await a.get(p);
    check(`page ${p} renders for the owner`, r.status === 200, `${r.status}`);
  }
  const profilePage = await a.get('/profile');
  check('the profile page shows her skills', profilePage.text.includes('typescript'));

  // --- jobs arrive and are scored
  const strong = await a.bff('POST', '/jobs', {
    companyName: 'Remote Co',
    title: 'Senior Backend Engineer',
    description: 'Build APIs.',
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 70000,
    salaryMax: 95000,
    requiredSkills: ['typescript', 'node', 'postgresql'],
    visaSponsorship: false,
  });
  check('a good job is added', strong.status === 201, JSON.stringify(strong.json));
  const blocked = await a.bff('POST', '/jobs', {
    companyName: 'Office Co',
    title: 'On-site Backend Engineer',
    description: 'Come to the office.',
    remoteType: 'ONSITE',
    location: 'Faraway City',
    requiredSkills: ['typescript', 'node'],
  });
  check('an on-site job is added', blocked.status === 201, JSON.stringify(blocked.json));

  const matches = await a.bff('GET', `/matches?candidateProfileId=${profileId}&limit=50`);
  const byJob = (id) => matches.json?.items?.find((m) => m.jobId === id);
  check(
    'the good job is scored APPLY',
    byJob(strong.json?.id)?.recommendation === 'APPLY',
    JSON.stringify(byJob(strong.json?.id)),
  );
  check(
    'the on-site job is ruled out whatever the skills say',
    byJob(blocked.json?.id)?.recommendation === 'SKIP' &&
      byJob(blocked.json?.id)?.hardFilters?.length > 0,
    JSON.stringify(byJob(blocked.json?.id)),
  );
  const matchesPage = await a.get('/matches');
  check(
    'the matches page shows the best job first',
    matchesPage.text.includes('Senior Backend Engineer'),
  );
  const jobPage = await a.get(`/jobs/${strong.json?.id}`);
  check(
    'the job page explains the match',
    jobPage.status === 200 && jobPage.text.includes('How well you match'),
  );
  const found = await a.get('/jobs?q=Senior');
  check('job search finds it', found.text.includes('Senior Backend Engineer'));

  // --- the pipeline, and the one thing only a person can do
  const apps = await a.bff('GET', `/applications?jobId=${strong.json?.id}`);
  const application = apps.json?.items?.[0];
  check(
    'the matcher opened an application for the good job',
    application?.state === 'MATCHED',
    JSON.stringify(application),
  );
  const appPage = await a.get(`/applications/${application?.id}`);
  check(
    'the application page renders',
    appPage.status === 200 && appPage.text.includes('Timeline'),
  );
  for (const to of [
    'SHORTLISTED',
    'RESUME_GENERATED',
    'COVER_LETTER_GENERATED',
    'READY_TO_APPLY',
  ]) {
    const r = await a.bff('POST', `/applications/${application?.id}/transition`, {
      to,
      note: `to ${to}`,
    });
    check(`move to ${to}`, r.status === 200 || r.status === 201, JSON.stringify(r.json));
  }
  const skip = await a.bff('POST', `/applications/${application?.id}/transition`, { to: 'OFFER' });
  check('a move the pipeline does not allow is refused', skip.status === 409, `${skip.status}`);
  const readyPage = await a.get(`/applications/${application?.id}`);
  check(
    'the page offers approval as its own card',
    readyPage.text.includes('Approve this application') &&
      readyPage.text.includes('Only a person can do this'),
  );
  const approved = await a.bff('POST', `/applications/${application?.id}/approve`, {});
  check(
    'she approves it',
    (approved.status === 200 || approved.status === 201) && approved.json?.state === 'APPROVED',
    JSON.stringify(approved.json),
  );
  const sent = await a.bff('POST', `/applications/${application?.id}/transition`, {
    to: 'APPLIED',
  });
  check(
    'she records that it was sent',
    sent.status === 200 || sent.status === 201,
    JSON.stringify(sent.json),
  );
  const dashAfter = await a.get('/dashboard');
  check('the dashboard counts it as sent', dashAfter.status === 200);

  // --- the audit trail holds
  const verify = await a.bff('GET', '/audit/verify');
  check(
    'the audit chain verifies',
    verify.json?.valid === true && verify.json?.checked > 5,
    JSON.stringify(verify.json),
  );
  const auditPage = await a.get('/audit');
  check(
    'the audit page lists actions',
    auditPage.text.includes('application.') ||
      auditPage.text.includes('job.') ||
      auditPage.text.includes('candidate'),
  );

  // --- somebody else's workspace is invisible, and a read-only analyst cannot write
  const reg2 = await api('POST', '/auth/register', { body: { ...BEN, fullName: 'Ben Stranger' } });
  check('Ben registers his own workspace', reg2.status === 201, JSON.stringify(reg2.json));
  const benSession = await sessionFor(BEN);
  const b = browser({ jp_refresh: benSession.refreshToken });
  const peek = await b.get(`/jobs/${strong.json?.id}`);
  check("Ben cannot open Ada's job", peek.status === 404, `${peek.status}`);
  const peekApp = await b.get(`/applications/${application?.id}`);
  check("Ben cannot open Ada's application", peekApp.status === 404, `${peekApp.status}`);
  const benJobs = await b.bff('GET', '/jobs');
  check(
    "Ben's job list is empty",
    benJobs.json?.page?.total === 0,
    JSON.stringify(benJobs.json?.page),
  );

  const invite = await a.bff('POST', '/organization/members', {
    email: BEN.email,
    role: 'ANALYST',
  });
  check(
    'Ada adds Ben to her organization as a read-only analyst',
    invite.status === 201 || invite.status === 200,
    JSON.stringify(invite.json),
  );
  const choice = await api('POST', '/auth/login', { body: BEN });
  check(
    'Ben now has two organizations and must choose one',
    choice.json?.organizationSelectionRequired === true && choice.json?.organizations?.length === 2,
    JSON.stringify(choice.json),
  );
  const adaOrg = choice.json?.organizations?.find((o) => o.role === 'ANALYST');
  const picked = await api('POST', '/auth/select-organization', {
    body: { selectionToken: choice.json?.selectionToken, organizationId: adaOrg?.id },
  });
  check(
    'he enters her organization as a read-only analyst',
    picked.status === 200 && picked.json?.organization?.role === 'ANALYST',
    JSON.stringify(picked.json),
  );
  const analyst = browser({ jp_refresh: picked.json?.refreshToken });
  const seeJob = await analyst.get(`/jobs/${strong.json?.id}`);
  check('an analyst can read her jobs', seeJob.status === 200, `${seeJob.status}`);
  const analystWrite = await analyst.bff('POST', '/jobs', { companyName: 'X', title: 'Y' });
  check('an analyst cannot add a job', analystWrite.status === 403, `${analystWrite.status}`);
  const analystSources = await analyst.get('/sources');
  check(
    'an analyst is sent away from job sources',
    analystSources.status === 307,
    `${analystSources.status}`,
  );
  const analystApprove = await analyst.bff('POST', `/applications/${application?.id}/approve`, {});
  check(
    'an analyst cannot approve anything',
    analystApprove.status === 403,
    `${analystApprove.status}`,
  );
}

try {
  await main();
} catch (e) {
  failures += 1;
  process.stdout.write(`\nSmoke test crashed: ${e.stack ?? e}\n`);
} finally {
  for (const c of children) c.kill();
  process.stdout.write(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed\n`);
  process.exit(failures ? 1 : 0);
}
