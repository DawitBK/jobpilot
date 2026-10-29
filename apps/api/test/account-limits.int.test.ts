import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeContext, PASSWORD, signUp, startContext, type TestContext } from './helpers.js';

// Rate limiting is off under tests unless asked for; this file asks, and runs in its own process.
process.env['RATE_LIMIT'] = 'on';

/** Each test gets its own application, and so its own request counter: the limits count requests per address per minute. */
describe('recovery and the limits that protect it', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await startContext();
  });
  afterEach(async () => {
    await closeContext(ctx);
  });

  const login = (email: string, password: string) =>
    ctx.http().post('/api/v1/auth/login').send({ email, password });
  const forgot = (email: string) => ctx.http().post('/api/v1/auth/forgot-password').send({ email });
  const mailsTo = (email: string) =>
    ctx.mailer.sent.filter((m) => m.to === email && /Reset your/.test(m.subject));

  it('sends at most three links an hour to one address, and says nothing different', async () => {
    const s = await signUp(ctx, 'Eager');
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await forgot(s.email)).status);
    expect(new Set(answers)).toEqual(new Set([202]));
    expect(mailsTo(s.email)).toHaveLength(3);
  });

  it('lets a person back in after the sign-in lock that guessing caused', async () => {
    // Registered directly (not through the helper that also signs in): the sign-in limit counts every request from this address.
    const email = `${randomUUID()}@example.test`;
    await ctx
      .http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD, fullName: 'Locked' });
    const s = { email };
    for (let i = 0; i < 5; i += 1) await login(s.email, 'not-the-password-at-all');
    expect((await login(s.email, PASSWORD)).status).toBe(429);
    await forgot(s.email);
    const token = mailsTo(s.email)[0]!.text.match(/token=([\w-]+)/)![1]!;
    const fresh = 'a-brand-new-passphrase-2026';
    expect(
      (await ctx.http().post('/api/v1/auth/reset-password').send({ token, password: fresh }))
        .status,
    ).toBe(204);
    expect((await login(s.email, fresh)).body.accessToken).toBeTruthy();
  });

  it('holds the recovery routes to the same strict limit as sign-in', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push(
        (
          await ctx
            .http()
            .post('/api/v1/auth/reset-password')
            .send({ token: 'x'.repeat(40), password: 'whatever-passphrase-1' })
        ).status,
      );
    }
    expect(statuses).toContain(429);
  });
});
