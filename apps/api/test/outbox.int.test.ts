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

const inbox = async (s: Session, query = '') => {
  const res = await ctx.http().get(`/api/v1/notifications${query}`).set(s.auth);
  expect(res.status).toBe(200);
  return res.body as {
    items: {
      id: string;
      kind: string;
      title: string;
      link: string | null;
      read: boolean;
      emailStatus: string;
    }[];
    page: { total: number };
  };
};
/** Adding a job scores it for the profile, and a good match opens the application by itself. */
const applicationFor = async (s: Session, jobId: string) => {
  const res = await ctx.http().get(`/api/v1/applications?jobId=${jobId}`).set(s.auth);
  expect(res.body.items.length).toBe(1);
  return res.body.items[0] as { id: string; state: string };
};
const readyToApply = async (s: Session, id: string) => {
  for (const to of [
    'SHORTLISTED',
    'RESUME_GENERATED',
    'COVER_LETTER_GENERATED',
    'READY_TO_APPLY',
  ]) {
    const r = await ctx
      .http()
      .post(`/api/v1/applications/${id}/transition`)
      .set(s.auth)
      .send({ to });
    expect(r.status, to).toBe(200);
  }
};
const pending = async (orgId: string) =>
  (
    await ctx.owner.query(
      `select status, attempts, last_error from outbox_events where organization_id = $1 order by id`,
      [orgId],
    )
  ).rows as { status: string; attempts: number; last_error: string | null }[];

describe('the outbox dispatcher', () => {
  it('turns events into notifications, once, and marks them dispatched', async () => {
    const ana = await signUp(ctx, 'Ana Notified');
    expect((await pending(ana.organizationId)).some((e) => e.status === 'PENDING')).toBe(true);
    await ctx.dispatch();
    expect((await pending(ana.organizationId)).every((e) => e.status === 'DISPATCHED')).toBe(true);
    const welcome = await inbox(ana);
    expect(welcome.items.map((n) => n.kind)).toEqual(['WELCOME']);
    // Dispatching again changes nothing: no event is handled twice.
    await ctx.dispatch();
    expect((await inbox(ana)).page.total).toBe(1);
  });

  it('tells the candidate about a match, and asks for approval when it is ready', async () => {
    const ana = await signUp(ctx, 'Ana Candidate');
    const profile = await myProfile(ctx, ana);
    await addSkills(ctx, ana, profile.id, ['typescript']);
    const job = await makeJob(ctx, ana, { title: 'Platform Engineer', companyName: 'Initech' });
    const created = await applicationFor(ana, job.id);
    await readyToApply(ana, created.id);
    await ctx.dispatch();
    const all = await inbox(ana);
    const kinds = all.items.map((n) => n.kind);
    expect(kinds).toContain('NEW_MATCH');
    const approval = all.items.find((n) => n.kind === 'APPROVAL_NEEDED');
    expect(approval?.title).toContain('Platform Engineer at Initech');
    expect(approval?.link).toBe(`/applications/${created.id}`);
    // The approval request is the kind worth an email; no mail server is set in this suite's default, the capture mailer is.
    expect(ctx.mailer.sent.some((m) => m.subject.includes('Platform Engineer'))).toBe(true);
    expect(approval?.emailStatus).toBe('SENT');
  });

  it('shows each person only their own notifications, and only in the organization they are in', async () => {
    const host = await signUp(ctx, 'Host Person');
    const guest = await signUp(ctx, 'Guest Person');
    const recruiter = await joinAs(ctx, host, guest, 'RECRUITER');
    const profile = await myProfile(ctx, host);
    await addSkills(ctx, host, profile.id, ['typescript']);
    const job = await makeJob(ctx, host);
    await readyToApply(host, (await applicationFor(host, job.id)).id);
    await ctx.dispatch();
    // The recruiter hears about the approval too (they may approve), the other workspace's owner sees nothing of it.
    expect((await inbox(recruiter)).items.some((n) => n.kind === 'APPROVAL_NEEDED')).toBe(true);
    const stranger = await signUp(ctx, 'Stranger');
    await ctx.dispatch();
    expect((await inbox(stranger)).items.every((n) => n.kind === 'WELCOME')).toBe(true);
    // Reading one of someone else's notifications looks like it does not exist.
    const hostItem = (await inbox(host)).items[0]!;
    const peek = await ctx
      .http()
      .post(`/api/v1/notifications/${hostItem.id}/read`)
      .set(stranger.auth);
    expect(peek.status).toBe(404);
  });

  it('counts and clears unread notifications', async () => {
    const s = await signUp(ctx, 'Reader');
    await ctx.dispatch();
    expect(
      (await ctx.http().get('/api/v1/notifications/unread-count').set(s.auth)).body.count,
    ).toBe(1);
    const item = (await inbox(s)).items[0]!;
    const read = await ctx.http().post(`/api/v1/notifications/${item.id}/read`).set(s.auth);
    expect(read.status).toBe(204);
    expect((await inbox(s, '?unread=true')).page.total).toBe(0);
    expect((await inbox(s, '?unread=false')).page.total).toBe(1);
    const all = await ctx.http().post('/api/v1/notifications/read-all').set(s.auth);
    expect(all.body).toEqual({ updated: 0 });
  });

  it('keeps the in-app message when the mail server is down, and says the email failed', async () => {
    const s = await signUp(ctx, 'Mail Down');
    const profile = await myProfile(ctx, s);
    await addSkills(ctx, s, profile.id, ['typescript']);
    const job = await makeJob(ctx, s);
    await readyToApply(s, (await applicationFor(s, job.id)).id);
    ctx.mailer.failing = true;
    try {
      await ctx.dispatch();
    } finally {
      ctx.mailer.failing = false;
    }
    const approval = (await inbox(s)).items.find((n) => n.kind === 'APPROVAL_NEEDED');
    expect(approval?.emailStatus).toBe('FAILED');
    expect((await pending(s.organizationId)).every((e) => e.status === 'DISPATCHED')).toBe(true);
  });

  it('retries an event that fails, with its reason, and gives up visibly', async () => {
    const s = await signUp(ctx, 'Retry');
    // An event whose handling throws: its payload points at an application the handler cannot read as one.
    await ctx.owner.query(
      `insert into outbox_events (organization_id, event_type, payload) values ($1, 'application.applied', $2)`,
      [
        s.organizationId,
        JSON.stringify({ applicationId: 'not-a-uuid', to: 'APPLIED', from: 'APPROVED' }),
      ],
    );
    await ctx.dispatch();
    const first = (await pending(s.organizationId)).find((e) => e.last_error);
    expect(first?.status).toBe('PENDING');
    expect(first?.attempts).toBe(1);
    // Backed off: an immediate second pass does not try it again.
    await ctx.dispatch();
    expect((await pending(s.organizationId)).find((e) => e.last_error)?.attempts).toBe(1);
    // After the delay and the allowed attempts it stays FAILED, with the reason kept.
    await ctx.owner.query(
      `update outbox_events set next_attempt_at = now() - interval '1 second', attempts = 4 where organization_id = $1 and last_error is not null`,
      [s.organizationId],
    );
    await ctx.dispatch();
    const failed = (await pending(s.organizationId)).find((e) => e.status === 'FAILED');
    expect(failed?.attempts).toBe(5);
    expect(failed?.last_error).toBeTruthy();
  });

  it('cannot be used to read other tenants: the dispatcher setting opens the outbox and nothing else', async () => {
    const a = await signUp(ctx, 'Tenant A');
    const client = await ctx.runtime.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.dispatcher', 'on', true)`);
      expect(
        (await client.query('select count(*)::int as n from outbox_events')).rows[0].n,
      ).toBeGreaterThan(0);
      for (const table of [
        'candidate_profiles',
        'audit_logs',
        'notifications',
        'jobs',
        'applications',
      ]) {
        expect(
          (await client.query(`select count(*)::int as n from ${table}`)).rows[0].n,
          table,
        ).toBe(0);
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect(a.organizationId).toBeTruthy();
  });
});
