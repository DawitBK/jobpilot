import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addSkills,
  closeContext,
  makeJob,
  myProfile,
  signUp,
  startContext,
  type Session,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
let alice: Session;
let bob: Session;
let aliceJobId: string;
let aliceProfileId: string;

beforeAll(async () => {
  ctx = await startContext();
  alice = await signUp(ctx, 'Alice Tenant');
  bob = await signUp(ctx, 'Bob Tenant');
  const profile = await myProfile(ctx, alice);
  aliceProfileId = profile.id;
  await addSkills(ctx, alice, profile.id, ['typescript']);
  aliceJobId = (await makeJob(ctx, alice, { title: 'Alice Only Role' })).id;
});
afterAll(async () => {
  await closeContext(ctx);
});

/** Run SQL as the application's runtime role, declaring (or not) which tenant it speaks for. */
async function asRuntime<T>(
  scope: { org?: string; user?: string },
  work: (
    q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>,
  ) => Promise<T>,
): Promise<T> {
  const client = await ctx.runtime.connect();
  try {
    await client.query('begin');
    if (scope.org)
      await client.query(`select set_config('app.organization_id', $1, true)`, [scope.org]);
    if (scope.user) await client.query(`select set_config('app.user_id', $1, true)`, [scope.user]);
    const result = await work((sql, params) => client.query(sql, params));
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

describe('the API keeps tenants apart', () => {
  it("never shows one tenant's data to another, and answers as if it did not exist", async () => {
    expect((await ctx.http().get(`/api/v1/jobs/${aliceJobId}`).set(alice.auth)).status).toBe(200);
    expect((await ctx.http().get(`/api/v1/jobs/${aliceJobId}`).set(bob.auth)).status).toBe(404);
    expect(
      (await ctx.http().get(`/api/v1/candidates/${aliceProfileId}`).set(bob.auth)).status,
    ).toBe(404);
    expect((await ctx.http().get('/api/v1/jobs?q=Alice').set(bob.auth)).body.page.total).toBe(0);
    expect((await ctx.http().get('/api/v1/matches').set(bob.auth)).body.page.total).toBe(0);
    const patch = await ctx
      .http()
      .patch(`/api/v1/jobs/${aliceJobId}`)
      .set(bob.auth)
      .send({ version: 1, title: 'Hijacked' });
    expect(patch.status).toBe(404);
    const apply = await ctx
      .http()
      .post('/api/v1/applications')
      .set(bob.auth)
      .send({ jobId: aliceJobId });
    expect(apply.status).toBe(422); // the job does not exist as far as Bob can tell
  });

  it('keeps the audit trail per tenant', async () => {
    const mine = await ctx.http().get('/api/v1/audit?limit=100').set(alice.auth);
    const theirs = await ctx.http().get('/api/v1/audit?limit=100').set(bob.auth);
    const jobEvents = (r: { body: { items: { action: string }[] } }) =>
      r.body.items.filter((i) => i.action === 'job.created').length;
    expect(jobEvents(mine)).toBe(1);
    expect(jobEvents(theirs)).toBe(0);
  });
});

describe('the database refuses even if the application forgets', () => {
  it('shows a session with no tenant nothing at all', async () => {
    for (const table of [
      'jobs',
      'candidate_profiles',
      'candidate_skills',
      'audit_logs',
      'outbox_events',
      'applications',
      'job_matches',
    ]) {
      const rows = await asRuntime({}, (q) => q(`select count(*)::int as n from ${table}`));
      expect(rows.rows[0]!.n, table).toBe(0);
    }
  });

  it('shows a session only the tenant it declared, with no WHERE clause at all', async () => {
    const a = await asRuntime({ org: alice.organizationId }, (q) => q('select title from jobs'));
    expect(a.rows.map((r) => r.title)).toEqual(['Alice Only Role']);
    const b = await asRuntime({ org: bob.organizationId }, (q) => q('select title from jobs'));
    expect(b.rows).toEqual([]);
    const profiles = await asRuntime({ org: bob.organizationId }, (q) =>
      q('select full_name from candidate_profiles'),
    );
    expect(profiles.rows.map((r) => r.full_name)).toEqual(['Bob Tenant']);
  });

  it('refuses to write a row into another tenant, or to change or delete one', async () => {
    await expect(
      asRuntime({ org: bob.organizationId }, (q) =>
        q(
          `insert into job_sources (organization_id, type, name, config) values ($1, 'RSS', 'planted', '{}')`,
          [alice.organizationId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Changing or deleting another tenant's row quietly affects nothing: it is invisible.
    const update = await asRuntime({ org: bob.organizationId }, (q) =>
      q(`update jobs set title = 'hijacked' where id = $1`, [aliceJobId]),
    );
    expect(update.rows).toEqual([]);
    const gone = await asRuntime({ org: bob.organizationId }, (q) =>
      q(`delete from jobs where id = $1 returning id`, [aliceJobId]),
    );
    expect(gone.rows).toEqual([]);
    const still = await asRuntime({ org: alice.organizationId }, (q) =>
      q('select title from jobs'),
    );
    expect(still.rows[0]!.title).toBe('Alice Only Role');
  });

  it('shows a person only their own memberships before they choose an organization', async () => {
    const none = await asRuntime({}, (q) =>
      q('select count(*)::int as n from organization_members'),
    );
    expect(none.rows[0]!.n).toBe(0);
    const mine = await asRuntime({ user: bob.userId }, (q) =>
      q('select organization_id from organization_members'),
    );
    expect(mine.rows.map((r) => r.organization_id)).toEqual([bob.organizationId]);
    const orgs = await asRuntime({ user: bob.userId }, (q) => q('select id from organizations'));
    expect(orgs.rows.map((r) => r.id)).toEqual([bob.organizationId]);
  });

  it('runs the application as a role that cannot bypass any of this', async () => {
    const { rows } = await ctx.runtime.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const forced = await ctx.owner.query(
      `select relname from pg_class where relrowsecurity and relforcerowsecurity and relkind = 'r' order by relname`,
    );
    const names = forced.rows.map((r) => r.relname);
    for (const t of [
      'jobs',
      'applications',
      'candidate_profiles',
      'audit_logs',
      'organizations',
      'organization_members',
      'roles',
      'job_matches',
    ]) {
      expect(names, t).toContain(t);
    }
  });
});

describe('the audit trail', () => {
  it('is a hash chain that proves nothing was edited, and is append-only', async () => {
    const verified = await ctx.http().get('/api/v1/audit/verify').set(alice.auth);
    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ valid: true, brokenAt: null });
    expect(verified.body.checked).toBeGreaterThan(2);

    // The runtime role cannot alter it, and neither can the trigger be dodged by a plain UPDATE.
    await expect(ctx.runtime.query('update audit_logs set action = $1', ['x'])).rejects.toThrow();
    await expect(ctx.owner.query('update audit_logs set action = $1', ['x'])).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.owner.query('delete from audit_logs')).rejects.toThrow(/append-only/);
    await expect(ctx.owner.query('truncate audit_logs')).rejects.toThrow(/append-only/);
  });

  it('shows tampering: a doctored row breaks the chain at that row', async () => {
    const carol = await signUp(ctx, 'Carol Tamper');
    await makeJob(ctx, carol);
    await makeJob(ctx, carol);
    const before = await ctx.http().get('/api/v1/audit/verify').set(carol.auth);
    expect(before.body.valid).toBe(true);

    // Someone with owner access switches the trigger off and rewrites history.
    const client = await ctx.owner.connect();
    try {
      await client.query('alter table audit_logs disable trigger audit_logs_no_update_delete');
      const victim = await client.query(
        `select id from audit_logs where organization_id = $1 and action = 'job.created' order by id limit 1`,
        [carol.organizationId],
      );
      await client.query(`update audit_logs set action = 'nothing.happened' where id = $1`, [
        victim.rows[0].id,
      ]);
      await client.query('alter table audit_logs enable trigger audit_logs_no_update_delete');
      const after = await ctx.http().get('/api/v1/audit/verify').set(carol.auth);
      expect(after.body.valid).toBe(false);
      expect(after.body.brokenAt).toBe(Number(victim.rows[0].id));
    } finally {
      await client
        .query('alter table audit_logs enable trigger audit_logs_no_update_delete')
        .catch(() => undefined);
      client.release();
    }
  });
});
