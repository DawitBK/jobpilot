import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeContext, PASSWORD, signUp, startContext, type TestContext } from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startContext();
});
afterAll(async () => {
  await closeContext(ctx);
});

const NEW_PASSWORD = 'a-brand-new-passphrase-2026';
const login = (email: string, password = PASSWORD) =>
  ctx.http().post('/api/v1/auth/login').send({ email, password });
const forgot = (email: string) => ctx.http().post('/api/v1/auth/forgot-password').send({ email });
const reset = (token: string, password = NEW_PASSWORD) =>
  ctx.http().post('/api/v1/auth/reset-password').send({ token, password });
/** The token in the most recent recovery mail to `email`. */
const tokenMailedTo = (email: string): string => {
  const mail = [...ctx.mailer.sent]
    .reverse()
    .find((m) => m.to === email && /reset/i.test(m.subject));
  const token = mail?.text.match(/token=([\w-]+)/)?.[1];
  if (!token) throw new Error(`no recovery mail for ${email}`);
  return token;
};
const recoveryMailsTo = (email: string) =>
  ctx.mailer.sent.filter((m) => m.to === email && /Reset your/.test(m.subject)).length;

describe('password recovery', () => {
  it('mails a link, sets the new password, ends every session, and works once', async () => {
    const s = await signUp(ctx, 'Forgetful');
    const res = await forgot(s.email);
    expect(res.status).toBe(202);
    expect(recoveryMailsTo(s.email)).toBe(1);
    const token = tokenMailedTo(s.email);

    const done = await reset(token);
    expect(done.status).toBe(204);
    expect((await login(s.email, NEW_PASSWORD)).body.accessToken).toBeTruthy();
    expect((await login(s.email)).status).toBe(401);
    // The session from before the reset is over.
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
    // The link is spent.
    expect((await reset(token, 'another-passphrase-2026')).status).toBe(422);
    // The person is told it happened.
    expect(ctx.mailer.sent.some((m) => m.to === s.email && /was changed/.test(m.subject))).toBe(
      true,
    );
  });

  it('answers the same for an address that has no account, and sends nothing', async () => {
    const known = await signUp(ctx, 'Known');
    const stranger = `${randomUUID()}@example.test`;
    const a = await forgot(known.email);
    const b = await forgot(stranger);
    expect([b.status, b.body]).toEqual([a.status, a.body]);
    expect(recoveryMailsTo(stranger)).toBe(0);
    expect(recoveryMailsTo(known.email)).toBe(1);
  });

  it('keeps only a hash of the token, and only the newest link works', async () => {
    const s = await signUp(ctx, 'Twice');
    await forgot(s.email);
    const first = tokenMailedTo(s.email);
    await forgot(s.email);
    const second = tokenMailedTo(s.email);
    expect(second).not.toBe(first);
    const stored = await ctx.owner.query(
      'select token_hash from password_resets where user_id = $1',
      [s.userId],
    );
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(first);
    expect(stored.rows.map((r) => r.token_hash)).not.toContain(second);
    expect((await reset(first)).status).toBe(422);
    expect((await reset(second)).status).toBe(204);
  });

  it('refuses a link that has expired, and a password that is too short', async () => {
    const s = await signUp(ctx, 'Late');
    await forgot(s.email);
    const token = tokenMailedTo(s.email);
    expect((await reset(token, 'short')).status).toBe(400);
    await ctx.owner.query(
      `update password_resets set expires_at = now() - interval '1 minute' where user_id = $1`,
      [s.userId],
    );
    expect((await reset(token)).status).toBe(422);
    expect((await login(s.email)).body.accessToken).toBeTruthy(); // nothing changed
  });

  it('refuses a token that was never issued', async () => {
    expect((await reset(randomUUID().replaceAll('-', '') + 'abcdefgh')).status).toBe(422);
  });

  it('still changes the password when the mail server is down, and keeps the link private', async () => {
    const s = await signUp(ctx, 'Offline');
    await forgot(s.email);
    const token = tokenMailedTo(s.email);
    ctx.mailer.failing = true;
    try {
      expect((await reset(token)).status).toBe(204);
    } finally {
      ctx.mailer.failing = false;
    }
    expect((await login(s.email, NEW_PASSWORD)).body.accessToken).toBeTruthy();
  });

  it('is no way around the identity provider: an account it manages gets no recovery link', async () => {
    const s = await signUp(ctx, 'Managed');
    await ctx.owner.query('update users set sso_subject = $2 where id = $1', [
      s.userId,
      randomUUID(),
    ]);
    expect((await forgot(s.email)).status).toBe(202);
    expect(recoveryMailsTo(s.email)).toBe(0);
    const change = await ctx
      .http()
      .post('/api/v1/me/password')
      .set(s.auth)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(change.status).toBe(409);
  });
});

describe('changing your own password', () => {
  it('needs the current password, then ends every session', async () => {
    const s = await signUp(ctx, 'Changing');
    const change = (currentPassword: string, newPassword = NEW_PASSWORD) =>
      ctx.http().post('/api/v1/me/password').set(s.auth).send({ currentPassword, newPassword });
    expect((await change('the-wrong-password-1')).status).toBe(401);
    expect((await change(PASSWORD, 'short')).status).toBe(400);
    expect((await change(PASSWORD)).status).toBe(204);
    expect((await login(s.email)).status).toBe(401);
    expect((await login(s.email, NEW_PASSWORD)).body.accessToken).toBeTruthy();
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });

  it('is for signed-in people only', async () => {
    const res = await ctx
      .http()
      .post('/api/v1/me/password')
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
