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

const billing = async (s: Session) => {
  const res = await ctx.http().get('/api/v1/billing').set(s.auth);
  expect(res.status).toBe(200);
  return res.body as {
    plan: string;
    quotas: { resource: string; used: number; limit: number | null }[];
    payment: { connected: boolean };
  };
};
const setPlan = (s: Session, plan: string) =>
  ctx.http().put('/api/v1/billing/plan').set(s.auth).send({ plan });
const addSource = (s: Session, name: string) =>
  ctx
    .http()
    .post('/api/v1/sources')
    .set(s.auth)
    .send({ type: 'RSS', name, config: { feedUrl: `https://feeds.example.test/${name}.xml` } });

describe('plans and limits', () => {
  it('starts on the free plan and reports what is used against what is allowed', async () => {
    const owner = await signUp(ctx, 'Free Owner');
    const view = await billing(owner);
    expect(view.plan).toBe('FREE');
    expect(view.payment.connected).toBe(false);
    const line = (r: string) => view.quotas.find((q) => q.resource === r)!;
    expect(line('members')).toMatchObject({ used: 1, limit: 3 });
    expect(line('sources')).toMatchObject({ used: 0, limit: 1 });
    expect(line('applications').limit).toBe(25);
  });

  it('refuses a fourth member on the free plan, with the numbers, and rolls the member back', async () => {
    const owner = await signUp(ctx, 'Team Owner');
    for (const name of ['Second', 'Third']) {
      await joinAs(ctx, owner, await signUp(ctx, name), 'RECRUITER', { plan: null });
    }
    const fourth = await signUp(ctx, 'Fourth');
    const refused = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(owner.auth)
      .send({ email: fourth.email, role: 'RECRUITER' });
    expect(refused.status).toBe(402);
    expect(refused.body.type ?? refused.body.title).toBeTruthy();
    expect(refused.body).toMatchObject({ resource: 'members', limit: 3, used: 3, plan: 'FREE' });
    expect((await billing(owner)).quotas.find((q) => q.resource === 'members')?.used).toBe(3);
    // Upgrading lifts it.
    expect((await setPlan(owner, 'PRO')).status).toBe(200);
    const accepted = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(owner.auth)
      .send({ email: fourth.email, role: 'RECRUITER' });
    expect(accepted.status).toBe(201);
  });

  it('limits job sources', async () => {
    const owner = await signUp(ctx, 'Source Owner');
    expect((await addSource(owner, 'first')).status).toBe(201);
    const second = await addSource(owner, 'second');
    expect(second.status).toBe(402);
    expect(second.body).toMatchObject({ resource: 'sources', limit: 1 });
    expect((await setPlan(owner, 'PRO')).status).toBe(200);
    expect((await addSource(owner, 'second')).status).toBe(201);
  });

  it('lets only the owner change the plan, and records it in the audit trail', async () => {
    const owner = await signUp(ctx, 'Plan Owner');
    const admin = await joinAs(ctx, owner, await signUp(ctx, 'Plan Admin'), 'ADMIN', {
      plan: null,
    });
    const denied = await setPlan(admin, 'TEAM');
    expect(denied.status).toBe(403);
    expect((await setPlan(owner, 'TEAM')).status).toBe(200);
    expect((await billing(admin)).plan).toBe('TEAM');
    const trail = await ctx.http().get('/api/v1/audit?limit=100').set(owner.auth);
    expect(
      trail.body.items.some((e: { action: string }) => e.action === 'billing.plan_changed'),
    ).toBe(true);
    const bad = await ctx.http().put('/api/v1/billing/plan').set(owner.auth).send({ plan: 'GOLD' });
    expect(bad.status).toBe(400);
  });

  it('will not move down to a plan that is too small for what is in use', async () => {
    const owner = await signUp(ctx, 'Shrinker');
    expect((await setPlan(owner, 'TEAM')).status).toBe(200);
    for (const name of ['One', 'Two', 'Three']) {
      await joinAs(ctx, owner, await signUp(ctx, name), 'ANALYST', { plan: null });
    }
    const down = await setPlan(owner, 'FREE');
    expect(down.status).toBe(409);
    expect(JSON.stringify(down.body)).toContain('4 team members');
    expect((await billing(owner)).plan).toBe('TEAM');
  });

  it('keeps the match but does not open more applications than the month allows, and tells the owner once', async () => {
    const owner = await signUp(ctx, 'Busy Owner');
    const profile = await myProfile(ctx, owner);
    await addSkills(ctx, owner, profile.id, ['typescript']);
    // 25 applications are allowed on the free plan; the 26th good match is saved but not opened.
    for (let i = 0; i < 26; i += 1) await makeJob(ctx, owner, { title: `Backend Engineer ${i}` });
    const apps = await ctx.http().get('/api/v1/applications?limit=1').set(owner.auth);
    expect(apps.body.page.total).toBe(25);
    const matches = await ctx
      .http()
      .get(`/api/v1/matches?candidateProfileId=${profile.id}&limit=100`)
      .set(owner.auth);
    expect(matches.body.page.total).toBe(26);
    await ctx.dispatch();
    const inbox = await ctx.http().get('/api/v1/notifications?limit=100').set(owner.auth);
    const reached = inbox.body.items.filter((n: { title: string }) =>
      n.title.includes('plan limit'),
    );
    expect(reached).toHaveLength(1);
    // Upgrading and re-scoring opens the held one.
    expect((await setPlan(owner, 'PRO')).status).toBe(200);
    const rescore = await ctx.http().post('/api/v1/matches/rescore').set(owner.auth).send({});
    expect(rescore.status).toBeLessThan(300);
    const after = await ctx.http().get('/api/v1/applications?limit=1').set(owner.auth);
    expect(after.body.page.total).toBe(26);
  });

  it('shows the billing page numbers only to people with analytics access, not to nobody', async () => {
    const anon = await ctx.http().get('/api/v1/billing');
    expect(anon.status).toBe(401);
  });
});
