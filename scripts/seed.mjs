/**
 * Seeds a running JobPilot with a connected demo world: two agencies, every role, four candidates with
 * full career graphs, a job market, and applications at every stage of the pipeline.
 *
 *   API_URL=http://127.0.0.1:3000 SEED_PASSWORD='a long demo passphrase' node scripts/seed.mjs
 *
 * It uses the public API only, as the people it creates, so every rule holds: validation, row-level
 * security, the state machine (only a person approves), the audit chain and the outbox. Because of
 * that it is safe to run again: people, memberships, jobs and profile entries that exist are left
 * alone, and an application that has already moved is not moved again. Nothing is ever deleted.
 *
 * SEED_PASSWORD is the one password every demo account gets (12 characters or more). Outside
 * production a default is used and printed; against anything else you must set it yourself.
 */
import {
  AGED_JOBS,
  AGENCY,
  DOMAIN,
  GLOBEX_JOBS,
  JOBS,
  JOURNEYS,
  OTHER_AGENCY,
  PEOPLE,
  PROFILES,
  SOURCES,
} from './seed-data.mjs';

const API = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(API);
const PASSWORD =
  process.env.SEED_PASSWORD ??
  (isLocal && process.env.NODE_ENV !== 'production' ? 'JobPilot-Demo-2026' : '');
if (PASSWORD.length < 12) {
  throw new Error(
    'Set SEED_PASSWORD (12 characters or more): a default is only used for a local API.',
  );
}

const email = (key) => `${key}@${DOMAIN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (line) => process.stdout.write(`${line}\n`);

/** One API call; waits out a 429 (sign-in is rate limited per address) instead of failing. */
async function call(method, path, { token, body } = {}) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const res = await fetch(`${API}/api/v1${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 10);
      log(`  (rate limited, waiting ${wait}s)`);
      await sleep((wait + 1) * 1000);
      continue;
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  }
  throw new Error(`${method} ${path}: still rate limited after waiting`);
}

const must = (r, what, ok = [200, 201, 204]) => {
  if (!ok.includes(r.status))
    throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

/** Sign in, and when the person belongs to several workspaces choose the one named `orgName`. */
async function signIn(key, orgName) {
  const login = must(
    await call('POST', '/auth/login', { body: { email: email(key), password: PASSWORD } }),
    `sign in ${key}`,
  );
  if (login.accessToken && (!orgName || login.organization.name === orgName)) return login;
  if (login.organizationSelectionRequired) {
    const chosen = login.organizations.find((o) => o.name === orgName);
    if (!chosen) throw new Error(`${key} is not in "${orgName}"`);
    return must(
      await call('POST', '/auth/select-organization', {
        body: { selectionToken: login.selectionToken, organizationId: chosen.id },
      }),
      `choose ${orgName} for ${key}`,
    );
  }
  throw new Error(`${key} signed in to "${login.organization?.name}", wanted "${orgName}"`);
}

async function register(person) {
  const r = await call('POST', '/auth/register', {
    body: { email: email(person.key), password: PASSWORD, fullName: person.name },
  });
  if (r.status === 201) return 'created';
  if (r.status === 409) return 'exists';
  must(r, `register ${person.key}`);
}

async function ensureOrgName(session, name) {
  if (session.organization.name === name) return;
  must(
    await call('PATCH', '/organization', { token: session.accessToken, body: { name } }),
    'rename workspace',
  );
}

async function ensurePlan(session, plan) {
  must(
    await call('PUT', '/billing/plan', { token: session.accessToken, body: { plan } }),
    `plan ${plan}`,
  );
}

async function ensureMember(host, key, role) {
  const r = await call('POST', '/organization/members', {
    token: host.accessToken,
    body: { email: email(key), role },
  });
  if (r.status === 201 || r.status === 409) return;
  must(r, `add ${key} as ${role}`);
}

async function fillProfile(key, session) {
  const spec = PROFILES[key];
  const token = session.accessToken;
  const me = must(await call('GET', '/candidates/me', { token }), `profile of ${key}`);
  if (!me.headline) {
    must(
      await call('PATCH', `/candidates/${me.id}`, {
        token,
        body: { version: me.version, ...spec.patch },
      }),
      `edit profile of ${key}`,
    );
  }
  const existing = new Set(me.skills.map((s) => s.skillName.toLowerCase()));
  for (const skill of spec.skills) {
    if (!existing.has(skill.skillName))
      must(
        await call('POST', `/candidates/${me.id}/skills`, { token, body: skill }),
        `skill ${skill.skillName}`,
      );
  }
  const children = [
    ['experience', spec.experience, me.experience.length],
    ['education', spec.education, me.education.length],
    ['projects', spec.projects, me.projects.length],
  ];
  for (const [kind, items, have] of children) {
    if (have === 0)
      for (const item of items)
        must(
          await call('POST', `/candidates/${me.id}/${kind}`, { token, body: item }),
          `${kind} of ${key}`,
        );
  }
  return me.id;
}

async function addJobs(session, jobs) {
  let created = 0;
  for (const j of jobs) {
    const r = await call('POST', '/jobs', { token: session.accessToken, body: j });
    if (r.status === 201) created += 1;
    else if (r.status !== 409) must(r, `job ${j.title}`);
  }
  return created;
}

/** Walk one application along a path of states. APPROVE is the person's own act, not a transition. */
async function walk(token, applicationId, path) {
  for (const step of path) {
    const r =
      step === 'APPROVE'
        ? await call('POST', `/applications/${applicationId}/approve`, { token, body: {} })
        : await call('POST', `/applications/${applicationId}/transition`, {
            token,
            body: { to: step },
          });
    must(r, `${step} on ${applicationId}`);
  }
}

async function main() {
  log(`Seeding ${API}`);

  // ---- people
  for (const person of PEOPLE) {
    const result = await register(person);
    log(`  ${result === 'created' ? 'new   ' : 'exists'} ${email(person.key)}`);
  }

  // ---- the agency, its roles, and the second agency
  const olivia = await signIn(AGENCY.owner);
  await ensureOrgName(olivia, AGENCY.name);
  await ensurePlan(olivia, AGENCY.plan);
  const gina = await signIn(OTHER_AGENCY.owner);
  await ensureOrgName(gina, OTHER_AGENCY.name);
  await ensurePlan(gina, OTHER_AGENCY.plan);
  for (const person of PEOPLE.filter((p) => p.role)) {
    if (person.role !== 'OWNER') await ensureMember(olivia, person.key, person.role);
    if (person.also === 'globex') await ensureMember(gina, person.key, 'RECRUITER');
  }
  const agency = await signIn(AGENCY.owner, AGENCY.name);

  // ---- already seeded? Jobs are the last thing added before applications are walked, so look there.
  const jobCount = must(
    await call('GET', '/jobs?limit=1', { token: agency.accessToken }),
    'count jobs',
  ).page.total;

  // ---- candidates: full career graphs BEFORE jobs exist, so matching opens their applications
  const candidates = PEOPLE.filter((p) => p.role === 'CANDIDATE');
  const sessions = {};
  const profileIds = {};
  for (const c of candidates) {
    sessions[c.key] = await signIn(c.key, AGENCY.name);
    profileIds[c.key] = await fillProfile(c.key, sessions[c.key]);
    log(`  profile ready: ${c.name}`);
  }
  const rita = await signIn('rita.recruiter', AGENCY.name);

  must(
    await call('PUT', '/organization/policy', {
      token: olivia.accessToken,
      body: { minScoreForApproval: 65, salaryGapPercent: 30, maxMissingSkills: 3 },
    }),
    'review rules',
  );

  // ---- the job market
  const made = await addJobs(rita, JOBS);
  log(`  jobs: ${made} added to ${AGENCY.name}`);
  const ritaGlobex = await signIn('rita.recruiter', OTHER_AGENCY.name);
  log(`  jobs: ${await addJobs(ritaGlobex, GLOBEX_JOBS)} added to ${OTHER_AGENCY.name}`);

  // ---- sources: one that was run (and really failed: the board does not exist), one switched off
  const existingSources = must(
    await call('GET', '/sources', { token: rita.accessToken }),
    'sources',
  );
  const have = new Set((existingSources.items ?? existingSources).map((s) => s.name));
  for (const [i, s] of SOURCES.entries()) {
    if (have.has(s.name)) continue;
    const created = must(
      await call('POST', '/sources', { token: rita.accessToken, body: s }),
      `source ${s.name}`,
    );
    if (i === 0) await call('POST', `/sources/${created.id}/run`, { token: rita.accessToken });
    else
      must(
        await call('PATCH', `/sources/${created.id}`, {
          token: rita.accessToken,
          body: { version: created.version, enabled: false },
        }),
        'switch source off',
      );
  }

  // ---- application journeys (only for a fresh seed: a moved application is never moved again)
  const moved = [];
  if (jobCount === 0) {
    for (const [key, journeys] of Object.entries(JOURNEYS)) {
      const token = sessions[key].accessToken;
      const matches = must(
        await call('GET', `/matches?candidateProfileId=${profileIds[key]}&limit=100`, { token }),
        `matches of ${key}`,
      ).items;
      const apps = must(
        await call('GET', '/applications?limit=100', { token }),
        `applications of ${key}`,
      ).items;
      const byJob = new Map(apps.map((a) => [a.jobId, a]));
      const ranked = [...matches].sort((a, b) => b.overallScore - a.overallScore);
      // Applications the matcher opened, best first; then the near misses (MAYBE) opened by the person.
      const queue = ranked
        .filter((m) => byJob.get(m.jobId)?.state === 'MATCHED')
        .map((m) => byJob.get(m.jobId));
      for (const m of ranked.filter((x) => x.recommendation === 'MAYBE' && !byJob.has(x.jobId))) {
        if (queue.length >= journeys.length) break;
        const created = must(
          await call('POST', '/applications', { token, body: { jobId: m.jobId } }),
          'open application',
        );
        queue.push(created);
      }
      for (const [i, journey] of journeys.entries()) {
        const target = queue[i];
        if (!target) continue;
        const actor = journey.by ? (await signIn(journey.by, AGENCY.name)).accessToken : token;
        await walk(actor, target.id, journey.path);
        moved.push({
          key,
          id: target.id,
          title: target.jobTitle,
          company: target.companyName,
          label: journey.label,
          last: journey.path.at(-1) === 'APPROVE' ? 'APPROVED' : (journey.path.at(-1) ?? 'MATCHED'),
        });
      }
    }
    // Postings age: a closed or expired job stays visible in history.
    const all = must(
      await call('GET', '/jobs?limit=100', { token: rita.accessToken }),
      'list jobs',
    ).items;
    for (const aged of AGED_JOBS) {
      const j = all.find((x) => x.title === aged.title);
      if (j)
        must(
          await call('PATCH', `/jobs/${j.id}`, {
            token: rita.accessToken,
            body: { version: j.version, status: aged.status },
          }),
          `age ${aged.title}`,
        );
    }
  } else {
    log('  jobs already present: leaving existing applications as they are');
  }
  for (const m of moved) log(`  ${m.key}: ${m.title} at ${m.company} -> ${m.label}`);

  // ---- documents (written by hand: no AI key is needed) and employer emails, for applications that got that far
  const WITH_DOCS = new Set([
    'COVER_LETTER_GENERATED',
    'READY_TO_APPLY',
    'APPROVED',
    'APPLIED',
    'SCREENING',
    'INTERVIEW',
    'FINAL_INTERVIEW',
    'OFFER',
    'ACCEPTED',
    'REJECTED',
    'NO_RESPONSE',
  ]);
  let docs = 0;
  for (const m of moved.filter((x) => WITH_DOCS.has(x.last))) {
    const person = PEOPLE.find((p) => p.key === m.key);
    const token = sessions[m.key].accessToken;
    const spec = PROFILES[m.key];
    const top = spec.skills
      .slice(0, 3)
      .map((x) => x.skillName)
      .join(', ');
    const job = spec.experience[0];
    const resume = [
      person.name,
      spec.patch.headline,
      '',
      `${spec.patch.summary}`,
      '',
      `- ${job.title} at ${job.companyName}: ${job.description}`,
      `- Core skills: ${top}.`,
    ].join('\n');
    const letter = `Dear hiring team at ${m.company},\n\nI am applying for the ${m.title} role. In my work at ${job.companyName} I have used ${top} every day, and I would like to bring that to your team.\n\nSincerely,\n${person.name}`;
    for (const [kind, content] of [
      ['RESUME', resume],
      ['COVER_LETTER', letter],
    ]) {
      must(
        await call('POST', `/applications/${m.id}/documents/manual`, {
          token,
          body: { kind, content },
        }),
        `document for ${m.title}`,
      );
      docs += 1;
    }
  }
  log(`  documents: ${docs} written by hand`);

  const MAIL = [
    // An invitation that has not been dealt with: the suggestion to move to screening is waiting for a click.
    {
      label: 'sent',
      key: 'ana.bekele',
      subject: 'Interview for Principal Engineer',
      body: 'We would like to invite you to an interview. Please share your availability or use the calendar link below.',
      from: 'talent@wingtip-commerce.test',
      then: null,
    },
    {
      label: 'sent',
      key: 'chloe.dlamini',
      subject: 'Thank you for applying',
      body: 'Thank you for applying. We have received your application and will be in touch.',
      from: 'careers@lucerne-health.test',
      then: 'dismiss',
    },
    {
      label: 'rejected',
      key: 'david.eshete',
      subject: 'Your application to Woodgrove Bank',
      body: 'Unfortunately, we have decided to move forward with other candidates.',
      from: 'recruiting@woodgrove-bank.test',
      then: 'dismiss',
    },
  ];
  let mails = 0;
  for (const spec of MAIL) {
    const target = moved.find((x) => x.key === spec.key && x.label === spec.label);
    if (!target) continue;
    const token = sessions[spec.key].accessToken;
    const logged = must(
      await call('POST', `/applications/${target.id}/emails`, {
        token,
        body: { fromAddress: spec.from, subject: spec.subject, body: spec.body },
      }),
      'log email',
    );
    if (spec.then === 'dismiss')
      await call('POST', `/applications/${target.id}/emails/${logged.id}/dismiss`, { token });
    mails += 1;
  }
  log(`  employer emails: ${mails} logged and classified`);

  // ---- give the outbox dispatcher a moment, then make the inbox realistic: some read, some not
  await sleep(5000);
  const ana = sessions['ana.bekele'];
  const inbox = must(
    await call('GET', '/notifications?limit=100', { token: ana.accessToken }),
    'inbox',
  ).items;
  for (const n of inbox.filter((x) => !x.read).slice(-3))
    await call('POST', `/notifications/${n.id}/read`, { token: ana.accessToken });

  // ---- report what is there, and prove the audit chain still holds
  const apps = must(
    await call('GET', '/applications?limit=100', { token: agency.accessToken }),
    'applications',
  ).items;
  const byState = {};
  for (const a of apps) byState[a.state] = (byState[a.state] ?? 0) + 1;
  const chain = must(
    await call('GET', '/audit/verify', { token: agency.accessToken }),
    'verify audit',
  );
  log('');
  log(`${AGENCY.name}: ${apps.length} applications`);
  log(
    `  ${Object.entries(byState)
      .map(([s, n]) => `${s} ${n}`)
      .join(', ')}`,
  );
  log(`  audit chain: ${chain.valid ? 'valid' : 'BROKEN'} (${chain.checked} entries)`);
  log('');
  log('Sign in with any of these (same password for all):');
  for (const p of PEOPLE)
    log(`  ${email(p.key).padEnd(40)} ${p.role ?? '(no workspace data: the empty state)'}`);
  if (!process.env.SEED_PASSWORD) log(`\nPassword: ${PASSWORD}`);
  if (!chain.valid) process.exitCode = 1;
}

await main();
