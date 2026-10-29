/**
 * Runs a REAL AI generation through a running JobPilot and shows how the evidence checker judged the model's text.
 * It uses whatever connection the API has (the server default from its environment). Costs a few model calls.
 *
 *   API_URL=http://127.0.0.1:3000 node scripts/ai-live-check.mjs
 *
 * It creates one throwaway person in their own workspace (an address under example.test), gives them a small
 * honest record, and writes a resume and a cover letter for one job.
 */
const API = (process.env.API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PASSWORD = process.env.SEED_PASSWORD ?? 'live-check-passphrase-2026';

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

const email = `live.${Date.now()}@example.test`;
must(
  await call('POST', '/auth/register', {
    body: { email, password: PASSWORD, fullName: 'Lena Live' },
  }),
  'register',
);
const { accessToken: token } = must(
  await call('POST', '/auth/login', { body: { email, password: PASSWORD } }),
  'login',
);

const me = must(await call('GET', '/candidates/me', { token }), 'profile');
must(
  await call('PATCH', `/candidates/${me.id}`, {
    token,
    body: {
      version: me.version,
      headline: 'Backend engineer',
      summary: 'Five years building APIs for payments and logistics.',
      remotePref: 'REMOTE_ONLY',
      workAuthStatus: 'CITIZEN',
    },
  }),
  'edit profile',
);
for (const s of [
  { skillName: 'typescript', proficiency: 'ADVANCED', yearsExperience: 5 },
  { skillName: 'postgresql', proficiency: 'INTERMEDIATE', yearsExperience: 3 },
  { skillName: 'docker', proficiency: 'INTERMEDIATE', yearsExperience: 2 },
]) {
  must(
    await call('POST', `/candidates/${me.id}/skills`, { token, body: s }),
    `skill ${s.skillName}`,
  );
}
must(
  await call('POST', `/candidates/${me.id}/experience`, {
    token,
    body: {
      companyName: 'Tailspin Logistics',
      title: 'Backend Engineer',
      startDate: '2020-02-01',
      description: 'Built the shipment-tracking API and its PostgreSQL schema.',
      technologies: ['typescript', 'postgresql'],
    },
  }),
  'experience',
);
const job = must(
  await call('POST', '/jobs', {
    token,
    body: {
      companyName: 'Northwind Cloud',
      title: 'Senior Backend Engineer',
      remoteType: 'REMOTE',
      seniority: 'SENIOR',
      requiredSkills: ['typescript', 'postgresql', 'kubernetes'],
      description: 'Own the billing API for a cloud platform. Kubernetes experience is a plus.',
    },
  }),
  'job',
);
const app =
  (await call('GET', `/applications?jobId=${job.id}`, { token })).json.items[0] ??
  must(await call('POST', '/applications', { token, body: { jobId: job.id } }), 'application');
must(
  await call('POST', `/applications/${app.id}/transition`, { token, body: { to: 'SHORTLISTED' } }),
  'shortlist',
);

const status = (await call('GET', `/applications/${app.id}/documents`, { token })).json.ai;
console.log(
  `Connection in effect: ${status.available ? `${status.vendor} / ${status.model} (${status.source})` : 'NONE'}`,
);
if (!status.available) process.exit(2);

for (const kind of ['RESUME', 'COVER_LETTER']) {
  const started = Date.now();
  const r = await call('POST', `/applications/${app.id}/documents/generate`, {
    token,
    body: { kind },
  });
  console.log(`\n=== ${kind}: HTTP ${r.status} in ${Date.now() - started} ms`);
  if (r.status >= 300) {
    console.log(JSON.stringify(r.json));
    process.exit(1);
  }
  const d = r.json;
  console.log(
    `model ${d.provider}/${d.model}  verdicts ${JSON.stringify(d.verdicts)}  needsReview ${d.needsReview}  redactions ${d.redactions}`,
  );
  console.log(d.content);
  for (const c of d.claims.filter((x) => x.verdict !== 'SUPPORTED')) {
    console.log(`  [${c.verdict}] ${c.text}\n      ${c.detail}`);
  }
}
const state = (await call('GET', `/applications/${app.id}`, { token })).json.state;
console.log(`\nApplication state now: ${state}`);
