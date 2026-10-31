import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeContext,
  joinAs,
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
const item = (title: string, description = '') =>
  `<item><title>${title}</title><link>https://example.test/jobs/${encodeURIComponent(title)}</link><guid>${randomUUID()}</guid><description>${description}</description></item>`;
const feed = (...items: string[]) => {
  const url = `https://feeds.example.test/${randomUUID()}.xml`;
  ctx.fetcher.feeds.set(url, RSS(items.join('')));
  return url;
};
const jobPage = (title: string, company = 'Acme Ltd') =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title,
    description: 'Build and run services.',
    hiringOrganization: { name: company },
    jobLocation: { address: { addressLocality: 'Addis Ababa', addressCountry: 'ET' } },
  })}</script></head></html>`;

const post = (s: Session, path: string, body: unknown) =>
  ctx
    .http()
    .post(`/api/v1${path}`)
    .set(s.auth)
    .send(body as object);
const get = (s: Session, path: string) => ctx.http().get(`/api/v1${path}`).set(s.auth);

describe('the catalog', () => {
  it('lists every kind of source with what each needs, and keeps its own settings private', async () => {
    const s = await signUp(ctx);
    const res = await get(s, '/sources/catalog');
    expect(res.status).toBe(200);
    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'linkedin',
        'glassdoor',
        'google',
        'ethiojobs',
        'hahu',
        'bayt',
        'lever',
        'rss',
        'json',
        'html',
      ]),
    );
    const lever = res.body.find((e: { id: string }) => e.id === 'lever');
    expect(lever).toMatchObject({ access: 'OPEN', type: 'LEVER' });
    expect(lever.fields[0]).toMatchObject({ key: 'site', required: true });
    expect(lever).not.toHaveProperty('fixed');
    const linkedin = res.body.find((e: { id: string }) => e.id === 'linkedin');
    expect(linkedin).toMatchObject({ access: 'LINK_ONLY', type: null });
  });

  it('makes a source from an entry and what the person typed, and says plainly what is missing', async () => {
    const s = await signUp(ctx);
    const url = feed(item('Nurse at City Hospital'));
    const made = await post(s, '/sources/from-catalog', {
      presetId: 'rss',
      values: { feedUrl: url, companyName: 'City Hospital' },
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      type: 'RSS',
      presetId: 'rss',
      config: { feedUrl: url, companyName: 'City Hospital' },
      filters: { include: [], exclude: [], remoteOnly: false },
    });

    const missing = await post(s, '/sources/from-catalog', { presetId: 'lever', values: {} });
    expect(missing.status).toBe(422);
    expect(missing.body.detail).toBe('Account name is required');
    const blocked = await post(s, '/sources/from-catalog', { presetId: 'linkedin', values: {} });
    expect(blocked.status).toBe(422);
    expect(blocked.body.detail).toMatch(/cannot be read automatically/);
    expect(
      (await post(s, '/sources/from-catalog', { presetId: 'nonsense', values: {} })).status,
    ).toBe(404);
  });
});

describe('reading a source', () => {
  it('shows what a source would bring before anything is saved, and saves nothing', async () => {
    const s = await signUp(ctx);
    const url = feed(
      item('Senior Nurse', 'Remote ward support'),
      item('Driver'),
      item('Junior Nurse'),
    );
    const preview = await post(s, '/sources/preview', {
      type: 'RSS',
      config: { feedUrl: url, companyName: 'City Hospital' },
      filters: { include: ['nurse'], exclude: ['junior'] },
    });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ fetched: 3, kept: 1, filtered: 2 });
    expect(preview.body.sample).toEqual([
      expect.objectContaining({ title: 'Senior Nurse', company: 'City Hospital' }),
    ]);
    expect((await get(s, '/sources')).body).toEqual([]);
    expect((await get(s, '/jobs')).body.page.total).toBe(0);

    const bad = await post(s, '/sources/preview', {
      type: 'RSS',
      config: { feedUrl: 'https://nowhere.example.test/x.xml' },
    });
    expect(bad.status).toBe(502);
    expect(
      (await post(s, '/sources/preview', { type: 'LEVER', config: { site: 'a b' } })).status,
    ).toBe(422);
  });

  it('keeps only what the filters allow, and writes a line of history for each read', async () => {
    const s = await signUp(ctx);
    const url = feed(
      item('Backend Engineer', 'Node.js and Postgres'),
      item('Cook'),
      item('Frontend Engineer', 'React'),
    );
    const source = await post(s, '/sources', {
      type: 'RSS',
      name: 'Filtered',
      config: { feedUrl: url, companyName: 'Acme' },
      filters: { include: ['engineer'] },
    });
    expect(source.status).toBe(201);
    const run = await post(s, `/sources/${source.body.id}/run`, {});
    expect(run.body).toMatchObject({ fetched: 3, created: 2, filtered: 1, duplicates: 0 });
    expect(
      (await get(s, '/jobs')).body.items.map((j: { title: string }) => j.title).sort(),
    ).toEqual(['Backend Engineer', 'Frontend Engineer']);

    const changed = await ctx
      .http()
      .patch(`/api/v1/sources/${source.body.id}`)
      .set(s.auth)
      .send({ version: 1, filters: { include: ['cook'] } });
    expect(changed.body.filters.include).toEqual(['cook']);
    await post(s, `/sources/${source.body.id}/run`, {});

    const runs = (await get(s, `/sources/${source.body.id}/runs`)).body;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      status: 'OK',
      trigger: 'MANUAL',
      fetched: 3,
      created: 1,
      filtered: 2,
    });
    expect(runs[1]).toMatchObject({ created: 2, filtered: 1 });
    expect((await get(s, `/sources/${randomUUID()}/runs`)).status).toBe(404);
  });

  it('waits longer after each failure, and starts again at once when the source is fixed', async () => {
    const s = await signUp(ctx);
    const dead = 'https://feeds.example.test/dead-' + randomUUID() + '.xml';
    const source = await post(s, '/sources', {
      type: 'RSS',
      name: 'Dead',
      config: { feedUrl: dead },
      pollIntervalMinutes: 60,
    });
    const wait = async () => {
      const row = (
        await ctx.owner.query(
          `select consecutive_failures as f, extract(epoch from next_run_at - now())/60 as mins from job_sources where id = $1`,
          [source.body.id],
        )
      ).rows[0];
      return { failures: row.f as number, mins: Number(row.mins) };
    };
    expect((await post(s, `/sources/${source.body.id}/run`, {})).status).toBe(502);
    expect(await wait()).toMatchObject({ failures: 1 });
    expect((await wait()).mins).toBeGreaterThan(115);
    await post(s, `/sources/${source.body.id}/run`, {});
    const second = await wait();
    expect(second.failures).toBe(2);
    expect(second.mins).toBeGreaterThan(235);
    const runs = (await get(s, `/sources/${source.body.id}/runs`)).body;
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ status: 'ERROR', message: expect.stringContaining('No feed') });

    const fixed = feed(item('Welder'));
    const patched = await ctx
      .http()
      .patch(`/api/v1/sources/${source.body.id}`)
      .set(s.auth)
      .send({ version: 1, config: { feedUrl: fixed, companyName: 'Steel Co' } });
    expect(patched.body).toMatchObject({ consecutiveFailures: 0, nextRunAt: null });
    expect((await post(s, `/sources/${source.body.id}/run`, {})).body.created).toBe(1);
    expect((await get(s, '/sources')).body[0]).toMatchObject({
      consecutiveFailures: 0,
      lastRunStatus: 'OK',
    });
  });
});

describe('the schedule', () => {
  it('reads due sources in every organization, on its own, and not again before they are due', async () => {
    const a = await signUp(ctx, 'Org A');
    // The free plan allows one source; this organization needs two.
    await ctx.owner.query(`update organizations set plan = 'TEAM' where id = $1`, [
      a.organizationId,
    ]);
    const b = await signUp(ctx, 'Org B');
    const urlA = feed(item('Mechanic'));
    const urlB = feed(item('Pilot'), item('Navigator'));
    const sa = (
      await post(a, '/sources', {
        type: 'RSS',
        name: 'A',
        config: { feedUrl: urlA, companyName: 'Garage' },
        pollIntervalMinutes: 30,
      })
    ).body;
    const sb = (
      await post(b, '/sources', {
        type: 'RSS',
        name: 'B',
        config: { feedUrl: urlB, companyName: 'Airline' },
        pollIntervalMinutes: 30,
      })
    ).body;
    const off = (
      await post(a, '/sources', {
        type: 'RSS',
        name: 'Off',
        config: { feedUrl: feed(item('Ghost')), companyName: 'None' },
      })
    ).body;
    await ctx
      .http()
      .patch(`/api/v1/sources/${off.id}`)
      .set(a.auth)
      .send({ version: 1, enabled: false });
    // Sources left by other suites are not what this one is about.
    await ctx.owner.query(
      `update job_sources set next_run_at = now() + interval '1 day' where id not in ($1, $2, $3)`,
      [sa.id, sb.id, off.id],
    );

    expect(await ctx.pollSources()).toBe(2);
    expect((await get(a, '/jobs')).body.items.map((j: { title: string }) => j.title)).toEqual([
      'Mechanic',
    ]);
    expect(
      (await get(b, '/jobs')).body.items.map((j: { title: string }) => j.title).sort(),
    ).toEqual(['Navigator', 'Pilot']);
    const runsA = (await get(a, `/sources/${sa.id}/runs`)).body;
    expect(runsA).toEqual([
      expect.objectContaining({ trigger: 'SCHEDULE', status: 'OK', created: 1 }),
    ]);
    expect((await get(a, `/sources/${off.id}/runs`)).body).toEqual([]);
    expect(
      (await get(a, '/sources')).body.find((x: { id: string }) => x.id === sa.id).nextRunAt,
    ).not.toBeNull();

    // Nothing is due now; a source whose time has come is read again.
    expect(await ctx.pollSources()).toBe(0);
    await ctx.owner.query(
      `update job_sources set next_run_at = now() - interval '1 minute' where id = $1`,
      [sa.id],
    );
    expect(await ctx.pollSources()).toBe(1);
    expect((await get(a, `/sources/${sa.id}/runs`)).body).toHaveLength(2);
    // The audit trail says the system did it, not a person.
    const audit = await ctx.owner.query(
      `select actor_type, actor_user_id from audit_logs where action = 'source.run' and resource_id = $1 order by created_at desc limit 1`,
      [sa.id],
    );
    expect(audit.rows[0]).toMatchObject({ actor_type: 'SYSTEM', actor_user_id: null });
  });

  it('backs a failing source off instead of retrying it every pass', async () => {
    const s = await signUp(ctx);
    const src = (
      await post(s, '/sources', {
        type: 'RSS',
        name: 'Flaky',
        config: { feedUrl: 'https://feeds.example.test/flaky-' + randomUUID() + '.xml' },
        pollIntervalMinutes: 15,
      })
    ).body;
    await ctx.owner.query(
      `update job_sources set next_run_at = now() + interval '1 day' where id <> $1`,
      [src.id],
    );
    expect(await ctx.pollSources()).toBe(1);
    expect(await ctx.pollSources()).toBe(0);
    const row = (await get(s, '/sources')).body[0];
    expect(row).toMatchObject({ lastRunStatus: 'ERROR', consecutiveFailures: 1 });
    expect(new Date(row.nextRunAt).getTime() - Date.now()).toBeGreaterThan(25 * 60_000);
  });

  it('is behind the same tenant isolation: without the scheduler’s switch the application sees no sources', async () => {
    const s = await signUp(ctx);
    await post(s, '/sources', { type: 'RSS', name: 'Mine', config: { feedUrl: feed(item('X')) } });
    const none = await ctx.runtime.query(`select count(*)::int as n from job_sources`);
    expect(none.rows[0].n).toBe(0);
    const client = await ctx.runtime.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.dispatcher', 'on', true)`);
      expect(
        (await client.query(`select count(*)::int as n from job_sources`)).rows[0].n,
      ).toBeGreaterThan(0);
      // The switch opens job sources, nothing else.
      expect((await client.query(`select count(*)::int as n from jobs`)).rows[0].n).toBe(0);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });
});

describe('adding jobs from links', () => {
  it('adds a job from its link, and from links inside pasted text, and reports each one', async () => {
    const s = await signUp(ctx);
    const one = `https://acme.example.test/careers/${randomUUID()}`;
    const two = `https://acme.example.test/careers/${randomUUID()}`;
    const broken = `https://acme.example.test/careers/${randomUUID()}`;
    ctx.fetcher.feeds.set(one, jobPage('Platform Engineer'));
    ctx.fetcher.feeds.set(two, jobPage('Data Analyst'));
    const res = await post(s, '/jobs/import', {
      urls: [one],
      text: `Hi, new roles for you:\n- ${two}.\n- ${broken}\nand ${one} again`,
    });
    expect(res.status).toBe(200);
    const by = (u: string) => res.body.results.find((r: { url: string }) => r.url === u);
    expect(by(one)).toMatchObject({
      outcome: 'ADDED',
      title: 'Platform Engineer',
      company: 'Acme Ltd',
    });
    expect(by(two)).toMatchObject({ outcome: 'ADDED', title: 'Data Analyst' });
    expect(by(broken)).toMatchObject({ outcome: 'FAILED', jobId: null });
    expect(res.body.results).toHaveLength(3); // the repeated link is tried once

    const jobs = (await get(s, '/jobs')).body.items;
    expect(jobs.map((j: { title: string }) => j.title).sort()).toEqual([
      'Data Analyst',
      'Platform Engineer',
    ]);
    expect(jobs[0].sourceId).toBeNull();
    expect(
      jobs.find((j: { title: string }) => j.title === 'Platform Engineer').applicationUrl,
    ).toBe(one);

    const again = await post(s, '/jobs/import', { urls: [one] });
    expect(again.body.results[0]).toMatchObject({ outcome: 'ALREADY_KNOWN', jobId: by(one).jobId });
  });

  it('refuses nothing to read, an address that is not https, and anyone who may not add jobs', async () => {
    const host = await signUp(ctx);
    expect((await post(host, '/jobs/import', {})).status).toBe(400);
    expect((await post(host, '/jobs/import', { text: 'no links here' })).status).toBe(422);
    expect((await post(host, '/jobs/import', { urls: ['ftp://x.example.test/a'] })).status).toBe(
      400,
    );
    const candidate = await joinAs(ctx, host, await signUp(ctx), 'CANDIDATE');
    expect(
      (await post(candidate, '/jobs/import', { urls: ['https://a.example.test/j'] })).status,
    ).toBe(403);
    expect((await get(candidate, '/sources/catalog')).status).toBe(403);
    expect(
      (
        await post(candidate, '/sources/preview', {
          type: 'RSS',
          config: { feedUrl: 'https://a.example.test/x' },
        })
      ).status,
    ).toBe(403);
  });
});
