import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSkills,
  closeContext,
  joinAs,
  makeJob,
  myProfile,
  signUp,
  startContext,
  type Session,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startContext();
});
afterAll(async () => {
  await closeContext(ctx);
});

const RSS = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Jobs</title>${items}</channel></rss>`;
const item = (title: string, extra = '') =>
  `<item><title>${title}</title><link>https://example.test/jobs/${encodeURIComponent(title)}</link><guid>${title}</guid>${extra}</item>`;

describe('the career graph', () => {
  it('builds up a profile and works out the years of experience without counting overlaps twice', async () => {
    const s = await signUp(ctx, 'Selam Tadesse');
    const me = await myProfile(ctx, s);
    await ctx
      .http()
      .post(`/api/v1/candidates/${me.id}/experience`)
      .set(s.auth)
      .send({
        companyName: 'Alpha',
        title: 'Developer',
        startDate: '2018-01-01',
        endDate: '2022-01-01',
        technologies: ['typescript'],
      });
    const overlap = await ctx
      .http()
      .post(`/api/v1/candidates/${me.id}/experience`)
      .set(s.auth)
      .send({
        companyName: 'Beta',
        title: 'Contractor',
        startDate: '2020-01-01',
        endDate: '2023-01-01',
      });
    expect(overlap.status).toBe(201);
    // 2018-01 to 2023-01 is five years even though the two jobs overlap for two.
    expect(overlap.body.yearsExperience).toBe(5);
    await addSkills(ctx, s, me.id, ['TypeScript', 'PostgreSQL']);
    const dupe = await ctx
      .http()
      .post(`/api/v1/candidates/${me.id}/skills`)
      .set(s.auth)
      .send({ skillName: 'typescript' });
    expect(dupe.status).toBe(409);
    const full = (await ctx.http().get(`/api/v1/candidates/${me.id}`).set(s.auth)).body;
    expect(full.skills.map((x: { skillName: string }) => x.skillName)).toEqual([
      'PostgreSQL',
      'TypeScript',
    ]);
    expect(full.experience).toHaveLength(2);

    const removed = await ctx
      .http()
      .delete(`/api/v1/candidates/${me.id}/skills/${full.skills[0].id}`)
      .set(s.auth);
    expect(removed.body.skills).toHaveLength(1);
    const bad = await ctx
      .http()
      .post(`/api/v1/candidates/${me.id}/experience`)
      .set(s.auth)
      .send({ companyName: 'X', title: 'Y', startDate: '2020-01-01', endDate: '2019-01-01' });
    expect(bad.status).toBe(400);
  });

  it('uses optimistic concurrency and validates the salary range', async () => {
    const s = await signUp(ctx);
    const me = await myProfile(ctx, s);
    const ok = await ctx.http().patch(`/api/v1/candidates/${me.id}`).set(s.auth).send({
      version: me.version,
      headline: 'Backend engineer',
      salaryMin: 100000,
      salaryMax: 150000,
      remotePref: 'REMOTE_ONLY',
    });
    expect(ok.status).toBe(200);
    const stale = await ctx
      .http()
      .patch(`/api/v1/candidates/${me.id}`)
      .set(s.auth)
      .send({ version: me.version, headline: 'Late' });
    expect(stale.status).toBe(409);
    const range = await ctx
      .http()
      .patch(`/api/v1/candidates/${me.id}`)
      .set(s.auth)
      .send({ version: ok.body.version, salaryMin: 200000 });
    expect(range.status).toBe(409);
  });

  it('shows a candidate only themselves, and everyone else the whole organization', async () => {
    const host = await signUp(ctx);
    const cand = await joinAs(ctx, host, await signUp(ctx, 'Jobseeker One'), 'CANDIDATE');
    const other = await joinAs(ctx, host, await signUp(ctx, 'Jobseeker Two'), 'CANDIDATE');
    const mine = await myProfile(ctx, cand);
    const theirs = await myProfile(ctx, other);
    const asCand = await ctx.http().get('/api/v1/candidates').set(cand.auth);
    expect(asCand.body.items.map((p: { id: string }) => p.id)).toEqual([mine.id]);
    expect((await ctx.http().get(`/api/v1/candidates/${theirs.id}`).set(cand.auth)).status).toBe(
      404,
    );
    expect(
      (
        await ctx
          .http()
          .patch(`/api/v1/candidates/${theirs.id}`)
          .set(cand.auth)
          .send({ version: 1, headline: 'x' })
      ).status,
    ).toBe(404);
    const asOwner = await ctx.http().get('/api/v1/candidates?limit=50').set(host.auth);
    expect(asOwner.body.page.total).toBe(3);
  });
});

describe('jobs', () => {
  it('adds a job by hand, scores it, and refuses the same posting twice', async () => {
    const s = await signUp(ctx);
    const body = {
      companyName: 'Zemen Bank',
      title: 'Senior Backend Engineer',
      location: 'Addis Ababa',
      remoteType: 'HYBRID',
      requiredSkills: ['JS', 'postgres'],
      seniority: 'SENIOR',
    };
    const created = await ctx.http().post('/api/v1/jobs').set(s.auth).send(body);
    expect(created.status).toBe(201);
    expect(created.body.requiredSkills).toEqual(['javascript', 'postgresql']); // normalised
    const again = await ctx
      .http()
      .post('/api/v1/jobs')
      .set(s.auth)
      .send({ ...body, companyName: 'ZEMEN  bank!' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('job-exists');
    expect(again.body.jobId).toBe(created.body.id);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/jobs')
          .set(s.auth)
          .send({ ...body, title: 'Other', applicationUrl: 'javascript:alert(1)' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/jobs')
          .set(s.auth)
          .send({ ...body, title: 'Other', salaryMin: 5, salaryMax: 1 })
      ).status,
    ).toBe(400);
  });

  it('searches and filters, and updates with optimistic concurrency', async () => {
    const s = await signUp(ctx);
    const tag = randomUUID().slice(0, 8);
    const a = await makeJob(ctx, s, {
      title: `${tag} Alpha`,
      remoteType: 'REMOTE',
      requiredSkills: ['rust'],
    });
    await makeJob(ctx, s, { title: `${tag} Beta`, remoteType: 'ONSITE', requiredSkills: ['go'] });
    expect(
      (await ctx.http().get(`/api/v1/jobs?q=${tag}&sort=title`).set(s.auth)).body.items,
    ).toHaveLength(2);
    expect(
      (await ctx.http().get(`/api/v1/jobs?q=${tag}&remoteType=REMOTE`).set(s.auth)).body.page.total,
    ).toBe(1);
    expect(
      (await ctx.http().get(`/api/v1/jobs?q=${tag}&skill=Rust`).set(s.auth)).body.page.total,
    ).toBe(1);
    expect((await ctx.http().get('/api/v1/jobs?sort=description').set(s.auth)).status).toBe(400);

    const ok = await ctx
      .http()
      .patch(`/api/v1/jobs/${a.id}`)
      .set(s.auth)
      .send({ version: a.version, status: 'CLOSED' });
    expect(ok.status).toBe(200);
    expect(
      (
        await ctx
          .http()
          .patch(`/api/v1/jobs/${a.id}`)
          .set(s.auth)
          .send({ version: a.version, title: 'x' })
      ).status,
    ).toBe(409);
    expect((await ctx.http().get(`/api/v1/jobs?q=${tag}`).set(s.auth)).body.page.total).toBe(1);
    expect(
      (await ctx.http().get(`/api/v1/jobs?q=${tag}&status=CLOSED`).set(s.auth)).body.page.total,
    ).toBe(1);
  });
});

describe('matching', () => {
  it('scores a job against the candidate, recommends, and opens an application for a good one', async () => {
    const s = await signUp(ctx);
    const me = await myProfile(ctx, s);
    await ctx.http().patch(`/api/v1/candidates/${me.id}`).set(s.auth).send({
      version: me.version,
      remotePref: 'REMOTE_ONLY',
      salaryMin: 90000,
      salaryMax: 140000,
    });
    await addSkills(ctx, s, me.id, ['TypeScript', 'Node.js', 'PostgreSQL', 'Docker']);
    const strong = await makeJob(ctx, s, {
      title: 'Backend Engineer',
      requiredSkills: ['typescript', 'node', 'postgres'],
      preferredSkills: ['docker'],
      remoteType: 'REMOTE',
      salaryMin: 100000,
      salaryMax: 130000,
    });
    const weak = await makeJob(ctx, s, {
      title: 'Embedded Developer',
      requiredSkills: ['c++', 'rust', 'linux'],
      remoteType: 'REMOTE',
    });
    const matches = await ctx.http().get('/api/v1/matches?limit=50').set(s.auth);
    const byJob = (id: string) => matches.body.items.find((m: { jobId: string }) => m.jobId === id);
    expect(byJob(strong.id)).toMatchObject({ recommendation: 'APPLY', missingSkills: [] });
    expect(byJob(strong.id).overallScore).toBeGreaterThanOrEqual(80);
    expect(byJob(weak.id).recommendation).toBe('SKIP');
    expect(byJob(weak.id).missingSkills).toEqual(expect.arrayContaining(['c++', 'rust']));
    expect(matches.body.items[0].overallScore).toBeGreaterThanOrEqual(
      matches.body.items.at(-1).overallScore,
    );

    const apps = await ctx.http().get('/api/v1/applications').set(s.auth);
    const forStrong = apps.body.items.find((a: { jobId: string }) => a.jobId === strong.id);
    expect(forStrong.state).toBe('MATCHED');
    expect(apps.body.items.find((a: { jobId: string }) => a.jobId === weak.id)).toBeUndefined();
    expect(
      (await ctx.http().get('/api/v1/matches?recommendation=APPLY').set(s.auth)).body.items.length,
    ).toBeGreaterThan(0);
  });

  it('applies the hard filters whatever the skills say', async () => {
    const s = await signUp(ctx);
    const me = await myProfile(ctx, s);
    await ctx
      .http()
      .patch(`/api/v1/candidates/${me.id}`)
      .set(s.auth)
      .send({
        version: me.version,
        workAuthStatus: 'NEEDS_SPONSORSHIP',
        remotePref: 'FLEXIBLE',
        targetLocations: ['Nairobi'],
      });
    await addSkills(ctx, s, me.id, ['TypeScript']);
    const noVisa = await makeJob(ctx, s, {
      title: 'No Visa Role',
      visaSponsorship: false,
      remoteType: 'REMOTE',
    });
    const farOnsite = await makeJob(ctx, s, {
      title: 'Far Onsite Role',
      remoteType: 'ONSITE',
      location: 'Oslo',
    });
    const matches = (await ctx.http().get('/api/v1/matches?limit=50').set(s.auth)).body.items;
    const m1 = matches.find((m: { jobId: string }) => m.jobId === noVisa.id);
    const m2 = matches.find((m: { jobId: string }) => m.jobId === farOnsite.id);
    expect(m1).toMatchObject({
      recommendation: 'SKIP',
      hardFilters: ['visa-sponsorship-not-offered'],
    });
    expect(m2.recommendation).toBe('SKIP');
    expect(m2.hardFilters).toContain('onsite-outside-target-locations');
    expect(m1.technicalScore).toBe(100); // a perfect skills match does not rescue it
  });

  it('rescoring after the profile changes updates the matches', async () => {
    const s = await signUp(ctx);
    const me = await myProfile(ctx, s);
    const job = await makeJob(ctx, s, {
      title: 'Python Dev',
      requiredSkills: ['python', 'django'],
      remoteType: 'REMOTE',
    });
    const before = (await ctx.http().get('/api/v1/matches').set(s.auth)).body.items.find(
      (m: { jobId: string }) => m.jobId === job.id,
    );
    await addSkills(ctx, s, me.id, ['Python', 'Django']);
    const rescored = await ctx.http().post('/api/v1/matches/rescore').set(s.auth).send({});
    expect(rescored.body.matches).toBeGreaterThan(0);
    const after = (await ctx.http().get('/api/v1/matches').set(s.auth)).body.items.find(
      (m: { jobId: string }) => m.jobId === job.id,
    );
    expect(after.technicalScore).toBeGreaterThan(before.technicalScore);
    expect(after.id).toBe(before.id); // updated in place, one match per candidate and job
  });
});

describe('job sources', () => {
  async function owner(): Promise<{ s: Session; profileId: string }> {
    const s = await signUp(ctx);
    const me = await myProfile(ctx, s);
    await ctx
      .http()
      .patch(`/api/v1/candidates/${me.id}`)
      .set(s.auth)
      .send({ version: me.version, remotePref: 'FLEXIBLE' });
    await addSkills(ctx, s, me.id, ['TypeScript', 'React']);
    return { s, profileId: me.id };
  }

  it('reads an RSS feed: stores raw postings, adds new jobs once, scores them, and re-polls without duplicates', async () => {
    const { s } = await owner();
    const url = `https://feeds.example.test/${randomUUID()}.xml`;
    ctx.fetcher.feeds.set(
      url,
      RSS(
        item(
          'Senior Frontend Engineer at Acme Corp',
          '<description>&lt;p&gt;Remote. We use TypeScript and React. $120,000 - $150,000. Nice to have: GraphQL.&lt;/p&gt;</description>',
        ) + item('Data Analyst at Acme Corp', '<description>SQL and Python.</description>'),
      ),
    );
    const source = await ctx
      .http()
      .post('/api/v1/sources')
      .set(s.auth)
      .send({ type: 'RSS', name: 'Acme feed', config: { feedUrl: url } });
    expect(source.status).toBe(201);
    const run = await ctx.http().post(`/api/v1/sources/${source.body.id}/run`).set(s.auth);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ fetched: 2, created: 2, duplicates: 0, discarded: 0 });
    expect(run.body.matched).toBe(2);

    const jobs = (await ctx.http().get('/api/v1/jobs?q=Acme').set(s.auth)).body.items;
    const fe = jobs.find((j: { title: string }) => j.title === 'Senior Frontend Engineer');
    expect(fe).toMatchObject({
      companyName: 'Acme Corp',
      remoteType: 'REMOTE',
      seniority: 'SENIOR',
      salaryMin: 120000,
      salaryMax: 150000,
    });
    expect(fe.requiredSkills).toEqual(expect.arrayContaining(['typescript', 'react']));
    expect(fe.preferredSkills).toEqual(['graphql']);

    const again = await ctx.http().post(`/api/v1/sources/${source.body.id}/run`).set(s.auth);
    expect(again.body).toMatchObject({ fetched: 2, created: 0, duplicates: 2 });
    const listed = (await ctx.http().get('/api/v1/sources').set(s.auth)).body;
    expect(listed[0]).toMatchObject({ lastRunStatus: 'OK' });
    const raws = await ctx.owner.query(
      `select count(*)::int as n from raw_jobs where source_id = $1`,
      [source.body.id],
    );
    expect(raws.rows[0].n).toBe(4); // every fetch is kept as it arrived
  });

  it('reads a Greenhouse board', async () => {
    const { s } = await owner();
    const token = `board${randomUUID().slice(0, 6)}`;
    ctx.fetcher.feeds.set(
      `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`,
      JSON.stringify({
        jobs: [
          {
            id: 101,
            title: 'Staff Platform Engineer',
            absolute_url: 'https://boards.greenhouse.io/x/jobs/101',
            updated_at: '2026-10-01T10:00:00Z',
            location: { name: 'Remote - Europe' },
            content:
              '&lt;p&gt;Experience with Kubernetes, Terraform and Go (golang). We do not offer visa sponsorship.&lt;/p&gt;',
          },
        ],
      }),
    );
    const source = await ctx
      .http()
      .post('/api/v1/sources')
      .set(s.auth)
      .send({
        type: 'GREENHOUSE',
        name: 'GH',
        config: { boardToken: token, companyName: 'Globex' },
      });
    const run = await ctx.http().post(`/api/v1/sources/${source.body.id}/run`).set(s.auth);
    expect(run.body).toMatchObject({ created: 1 });
    const job = (await ctx.http().get('/api/v1/jobs?q=Platform').set(s.auth)).body.items[0];
    expect(job).toMatchObject({
      companyName: 'Globex',
      seniority: 'STAFF',
      remoteType: 'REMOTE',
      visaSponsorship: false,
    });
    expect(job.requiredSkills).toEqual(expect.arrayContaining(['kubernetes', 'terraform', 'go']));
    expect(job.applicationUrl).toBe('https://boards.greenhouse.io/x/jobs/101');
  });

  it('records a failing source as an error without half-writing anything', async () => {
    const { s } = await owner();
    const source = await ctx
      .http()
      .post('/api/v1/sources')
      .set(s.auth)
      .send({
        type: 'RSS',
        name: 'Dead feed',
        config: { feedUrl: 'https://feeds.example.test/none.xml' },
      });
    const run = await ctx.http().post(`/api/v1/sources/${source.body.id}/run`).set(s.auth);
    expect(run.status).toBe(502);
    expect(run.body.code).toBe('source-fetch-failed');
    const after = (await ctx.http().get('/api/v1/sources').set(s.auth)).body[0];
    expect(after).toMatchObject({ lastRunStatus: 'ERROR' });
    expect((await ctx.http().get('/api/v1/jobs').set(s.auth)).body.page.total).toBe(0);
  });

  it('validates the settings, manages sources and keeps the history of where jobs came from', async () => {
    const { s } = await owner();
    const bad = (config: Record<string, string>, type = 'RSS') =>
      ctx
        .http()
        .post('/api/v1/sources')
        .set(s.auth)
        .send({ type, name: `n${randomUUID()}`, config });
    expect((await bad({})).status).toBe(422);
    expect((await bad({ feedUrl: 'http://insecure.example.test/feed' })).status).toBe(422);
    expect((await bad({ boardToken: '../../etc/passwd' }, 'GREENHOUSE')).status).toBe(422);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/sources')
          .set(s.auth)
          .send({ type: 'SITEMAP', name: 'x', config: {} })
      ).status,
    ).toBe(400);

    const url = `https://feeds.example.test/${randomUUID()}.xml`;
    ctx.fetcher.feeds.set(url, RSS(item('Backend Engineer at Initech')));
    const source = (
      await ctx
        .http()
        .post('/api/v1/sources')
        .set(s.auth)
        .send({ type: 'RSS', name: 'Initech', config: { feedUrl: url } })
    ).body;
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/sources')
          .set(s.auth)
          .send({ type: 'RSS', name: 'INITECH', config: { feedUrl: url } })
      ).status,
    ).toBe(409);
    const off = await ctx
      .http()
      .patch(`/api/v1/sources/${source.id}`)
      .set(s.auth)
      .send({ version: source.version, enabled: false });
    expect(off.body.enabled).toBe(false);
    expect((await ctx.http().post(`/api/v1/sources/${source.id}/run`).set(s.auth)).status).toBe(
      409,
    );
    await ctx
      .http()
      .patch(`/api/v1/sources/${source.id}`)
      .set(s.auth)
      .send({ version: off.body.version, enabled: true });
    await ctx.http().post(`/api/v1/sources/${source.id}/run`).set(s.auth);
    const del = await ctx.http().delete(`/api/v1/sources/${source.id}`).set(s.auth);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('source-has-jobs');
  });

  it('is for recruiters and above, not for a candidate or an analyst', async () => {
    const host = await signUp(ctx);
    const cand = await joinAs(ctx, host, await signUp(ctx), 'CANDIDATE');
    const analyst = await joinAs(ctx, host, await signUp(ctx), 'ANALYST');
    const recruiter = await joinAs(ctx, host, await signUp(ctx), 'RECRUITER');
    const body = {
      type: 'RSS',
      name: 'x',
      config: { feedUrl: 'https://feeds.example.test/a.xml' },
    };
    expect((await ctx.http().post('/api/v1/sources').set(cand.auth).send(body)).status).toBe(403);
    expect((await ctx.http().post('/api/v1/sources').set(analyst.auth).send(body)).status).toBe(
      403,
    );
    expect((await ctx.http().post('/api/v1/sources').set(recruiter.auth).send(body)).status).toBe(
      201,
    );
    expect(
      (await ctx.http().post('/api/v1/jobs').set(cand.auth).send({ companyName: 'A', title: 'B' }))
        .status,
    ).toBe(403);
    expect((await ctx.http().get('/api/v1/jobs').set(cand.auth)).status).toBe(200);
  });
});
