import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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

/**
 * A realistic start: the candidate has the skill the job asks for, so the matcher scores it APPLY and opens the
 * application itself (the review policy would ask for an acknowledgement on a poor match, which other tests cover).
 */
async function startApplication(s: Session) {
  const profile = await myProfile(ctx, s);
  await ctx
    .http()
    .post(`/api/v1/candidates/${profile.id}/skills`)
    .set(s.auth)
    .send({ skillName: 'typescript' });
  const job = await makeJob(ctx, s);
  const list = await ctx.http().get(`/api/v1/applications?jobId=${job.id}`).set(s.auth);
  expect(list.body.items).toHaveLength(1);
  const res = await ctx.http().get(`/api/v1/applications/${list.body.items[0].id}`).set(s.auth);
  expect(res.status).toBe(200);
  return res.body as { id: string; state: string; allowedNext: string[] };
}
const move = (s: Session, id: string, to: string, note?: string) =>
  ctx.http().post(`/api/v1/applications/${id}/transition`).set(s.auth).send({ to, note });

async function walkTo(s: Session, id: string, states: string[]) {
  for (const to of states) {
    const res = await move(s, id, to);
    expect(res.status, `to ${to}: ${JSON.stringify(res.body)}`).toBe(200);
  }
}

const READY = ['SHORTLISTED', 'RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'READY_TO_APPLY'];

describe('the application state machine', () => {
  it('walks an application from first match to an offer, recording every step', async () => {
    const s = await signUp(ctx);
    const app = await startApplication(s);
    expect(app.state).toBe('MATCHED');
    await walkTo(s, app.id, READY);
    const approved = await ctx.http().post(`/api/v1/applications/${app.id}/approve`).set(s.auth);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ state: 'APPROVED', approvedBy: s.userId });
    expect(approved.body.approvedAt).not.toBeNull();
    await walkTo(s, app.id, [
      'APPLIED',
      'SCREENING',
      'INTERVIEW',
      'FINAL_INTERVIEW',
      'OFFER',
      'ACCEPTED',
    ]);

    const done = (await ctx.http().get(`/api/v1/applications/${app.id}`).set(s.auth)).body;
    expect(done.state).toBe('ACCEPTED');
    expect(done.allowedNext).toEqual([]);
    expect(done.appliedAt).not.toBeNull();
    expect(done.events.map((e: { toState: string }) => e.toState)).toEqual([
      'DISCOVERED',
      'MATCHED',
      ...READY,
      'APPROVED',
      'APPLIED',
      'SCREENING',
      'INTERVIEW',
      'FINAL_INTERVIEW',
      'OFFER',
      'ACCEPTED',
    ]);
    // The matcher found it (SYSTEM); every step after that was the person's own.
    const actors = done.events.map((e: { actorType: string }) => e.actorType);
    expect(actors.slice(0, 2)).toEqual(['SYSTEM', 'SYSTEM']);
    expect(actors.slice(2).every((a: string) => a === 'USER')).toBe(true);

    // Every step announced itself for the asynchronous side and is in the tamper-evident trail.
    const outbox = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where payload->>'applicationId' = $1`,
      [app.id],
    );
    expect(outbox.rows[0].n).toBe(13); // one for the discovery and one for each of the 12 moves
    expect((await ctx.http().get('/api/v1/audit/verify').set(s.auth)).body.valid).toBe(true);
  });

  it('refuses moves the table does not allow, and says what is allowed', async () => {
    const s = await signUp(ctx);
    const app = await startApplication(s);
    const skip = await move(s, app.id, 'APPLIED');
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('invalid-transition');
    expect(skip.body.allowed).toEqual(['SHORTLISTED', 'REJECTED', 'EXPIRED']);
    expect((await move(s, app.id, 'OFFER')).status).toBe(409);
    expect((await move(s, app.id, 'NOT_A_STATE')).status).toBe(400);
    await walkTo(s, app.id, ['REJECTED']);
    const dead = await move(s, app.id, 'SHORTLISTED');
    expect(dead.status).toBe(409);
    expect(dead.body.detail).toMatch(/cannot change any more/);
  });

  it('makes approval its own action, only from READY_TO_APPLY', async () => {
    const s = await signUp(ctx);
    const app = await startApplication(s);
    const notYet = await ctx.http().post(`/api/v1/applications/${app.id}/approve`).set(s.auth);
    expect(notYet.status).toBe(409);
    expect(notYet.body.code).toBe('not-ready-to-approve');
    await walkTo(s, app.id, READY);
    const viaTransition = await move(s, app.id, 'APPROVED');
    expect(viaTransition.status).toBe(422);
    expect(viaTransition.body.code).toBe('use-approve');
    expect(
      (await ctx.http().post(`/api/v1/applications/${app.id}/approve`).set(s.auth)).status,
    ).toBe(200);
    expect(
      (await ctx.http().post(`/api/v1/applications/${app.id}/approve`).set(s.auth)).status,
    ).toBe(409);
  });

  it('sends an application to human review and brings it back only to where it came from', async () => {
    const s = await signUp(ctx);
    const app = await startApplication(s);
    await walkTo(s, app.id, ['SHORTLISTED', 'RESUME_GENERATED', 'NEEDS_HUMAN_REVIEW']);
    const wrong = await move(s, app.id, 'SHORTLISTED');
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe('wrong-return-state');
    expect(wrong.body.returnTo).toBe('RESUME_GENERATED');
    const back = await move(s, app.id, 'RESUME_GENERATED', 'checked, fine');
    expect(back.status).toBe(200);
    expect(back.body.events.at(-1).payload).toEqual({ note: 'checked, fine' });
    await walkTo(s, app.id, ['NEEDS_HUMAN_REVIEW', 'WITHDRAWN']); // withdrawing is always possible from review
  });

  it('cannot be started twice for the same job, or for a closed one', async () => {
    const s = await signUp(ctx);
    const job = await makeJob(ctx, s);
    expect(
      (await ctx.http().post('/api/v1/applications').set(s.auth).send({ jobId: job.id })).status,
    ).toBe(201);
    const twice = await ctx.http().post('/api/v1/applications').set(s.auth).send({ jobId: job.id });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('application-exists');
    const closed = await makeJob(ctx, s);
    await ctx
      .http()
      .patch(`/api/v1/jobs/${closed.id}`)
      .set(s.auth)
      .send({ version: closed.version, status: 'CLOSED' });
    expect(
      (await ctx.http().post('/api/v1/applications').set(s.auth).send({ jobId: closed.id })).status,
    ).toBe(409);
    expect(
      (await ctx.http().post('/api/v1/applications').set(s.auth).send({ jobId: randomUUID() }))
        .status,
    ).toBe(422);
  });
});

describe('only a person can approve (the browser worker and the AI cannot)', () => {
  it('rejects approval by any non-person actor at the engine, and at the database', async () => {
    const { validateTransition } = await import('../src/applications/engine.js');
    for (const actor of ['SYSTEM', 'AI_AGENT', 'BROWSER_WORKER'] as const) {
      expect(() => validateTransition('READY_TO_APPLY', 'APPROVED', actor), actor).toThrow(
        /cannot move an application to APPROVED/,
      );
    }
    expect(() => validateTransition('READY_TO_APPLY', 'APPROVED', 'USER')).not.toThrow();

    // Even code that bypassed the engine could not record it: a CHECK constraint refuses the event.
    const s = await signUp(ctx);
    const app = await startApplication(s);
    for (const actor of ['SYSTEM', 'AI_AGENT', 'BROWSER_WORKER']) {
      await expect(
        ctx.owner.query(
          `insert into application_events (organization_id, application_id, from_state, to_state, actor_type, event_type)
           values ($1, $2, 'READY_TO_APPLY', 'APPROVED', $3, 'forged')`,
          [s.organizationId, app.id, actor],
        ),
      ).rejects.toThrow(/application_events_approval_by_user/);
    }
    // ...and an application cannot sit in an approved state with nobody recorded as approving it.
    await expect(
      ctx.owner.query(`update applications set state = 'APPROVED' where id = $1`, [app.id]),
    ).rejects.toThrow(/applications_approval_recorded/);
  });
});

describe('who sees which applications', () => {
  it('shows a candidate only their own, and lets a recruiter see and move all of them', async () => {
    const host = await signUp(ctx);
    const alice = await joinAs(ctx, host, await signUp(ctx), 'CANDIDATE');
    const bob = await joinAs(ctx, host, await signUp(ctx), 'CANDIDATE');
    const recruiter = await joinAs(ctx, host, await signUp(ctx), 'RECRUITER');
    const analyst = await joinAs(ctx, host, await signUp(ctx), 'ANALYST');
    const job = await makeJob(ctx, host);

    const a = await ctx.http().post('/api/v1/applications').set(alice.auth).send({ jobId: job.id });
    const b = await ctx.http().post('/api/v1/applications').set(bob.auth).send({ jobId: job.id });
    expect([a.status, b.status]).toEqual([201, 201]);

    expect((await ctx.http().get(`/api/v1/applications/${a.body.id}`).set(bob.auth)).status).toBe(
      404,
    );
    expect((await move(bob, a.body.id, 'SHORTLISTED')).status).toBe(404);
    expect(
      (await ctx.http().post(`/api/v1/applications/${a.body.id}/approve`).set(bob.auth)).status,
    ).toBe(404);
    const mine = await ctx.http().get('/api/v1/applications').set(alice.auth);
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([a.body.id]);

    // A candidate cannot start an application for someone else's profile.
    const theirProfile = (await ctx.http().get('/api/v1/candidates/me').set(bob.auth)).body.id;
    const other = await makeJob(ctx, host);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/applications')
          .set(alice.auth)
          .send({ jobId: other.id, candidateProfileId: theirProfile })
      ).status,
    ).toBe(404);

    expect((await ctx.http().get('/api/v1/applications').set(recruiter.auth)).body.page.total).toBe(
      2,
    );
    expect((await move(recruiter, a.body.id, 'SHORTLISTED')).status).toBe(200);
    expect((await ctx.http().get('/api/v1/applications').set(analyst.auth)).status).toBe(200);
    expect((await move(analyst, b.body.id, 'SHORTLISTED')).status).toBe(403);
    const forOne = await ctx
      .http()
      .post('/api/v1/applications')
      .set(recruiter.auth)
      .send({ jobId: other.id, candidateProfileId: theirProfile });
    expect(forOne.status).toBe(201);
  });
});
