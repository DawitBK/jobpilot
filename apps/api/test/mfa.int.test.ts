import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeAt, stepOf } from '../src/auth/totp.js';
import {
  closeContext,
  enrolMfa,
  joinAs,
  PASSWORD,
  signUp,
  startContext,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startContext();
});
afterAll(async () => {
  await closeContext(ctx);
});

const login = (email: string, password = PASSWORD) =>
  ctx.http().post('/api/v1/auth/login').send({ email, password });
const mfaStep = (mfaToken: string, body: Record<string, string>) =>
  ctx
    .http()
    .post('/api/v1/auth/mfa')
    .send({ mfaToken, ...body });
/** A code from the step after the current one: valid (one step of drift is allowed) and never the step the enrolment used. */
const nextCode = (secret: string, ahead = 1) => codeAt(secret, stepOf(Date.now()) + ahead);

const enrol = (name: string) => enrolMfa(ctx, name);

describe('two-step sign-in', () => {
  it('walks through enrolment, and keeps the secret encrypted in the database', async () => {
    const s = await signUp(ctx, 'Enrolling');
    expect((await ctx.http().get('/api/v1/me/mfa').set(s.auth)).body).toEqual({
      available: true,
      enabled: false,
      recoveryCodesLeft: 0,
    });
    const setup = await ctx.http().post('/api/v1/me/mfa/setup').set(s.auth);
    expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
    // Not on until the person proves the app works.
    expect((await login(s.email)).body.accessToken).toBeTruthy();
    const wrong = await ctx
      .http()
      .post('/api/v1/me/mfa/enable')
      .set(s.auth)
      .send({ code: '000000' });
    expect(wrong.status).toBe(422);
    const ok = await ctx
      .http()
      .post('/api/v1/me/mfa/enable')
      .set(s.auth)
      .send({ code: codeAt(setup.body.secret, stepOf(Date.now())) });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect((await ctx.http().get('/api/v1/me/mfa').set(s.auth)).body).toMatchObject({
      enabled: true,
      recoveryCodesLeft: 10,
    });
    const row = (
      await ctx.owner.query('select totp_secret_enc from users where id = $1', [s.userId])
    ).rows[0];
    expect(row.totp_secret_enc).not.toContain(setup.body.secret);
    const codes = (
      await ctx.owner.query('select code_hash from mfa_recovery_codes where user_id = $1', [
        s.userId,
      ])
    ).rows;
    expect(JSON.stringify(codes)).not.toContain(ok.body.recoveryCodes[0].replace(/-/g, ''));
    // And it cannot be started again while on.
    expect((await ctx.http().post('/api/v1/me/mfa/setup').set(s.auth)).status).toBe(409);
  });

  it('asks for a code after the password, and issues tokens only for a right, unused code', async () => {
    const { s, secret } = await enrol('Second Step');
    const first = await login(s.email);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ mfaRequired: true });
    expect(first.body.accessToken).toBeUndefined();
    const bad = await mfaStep(first.body.mfaToken, { code: '123456' });
    expect(bad.status).toBe(401);
    const code = nextCode(secret);
    const good = await mfaStep(first.body.mfaToken, { code });
    expect(good.status).toBe(200);
    expect(good.body.accessToken).toBeTruthy();
    const me = await ctx
      .http()
      .get('/api/v1/me')
      .set({ Authorization: `Bearer ${good.body.accessToken}` });
    expect(me.status).toBe(200);
    // The same code is refused the second time (replay), even though it is still inside its window.
    const again = await login(s.email);
    expect((await mfaStep(again.body.mfaToken, { code })).status).toBe(401);
    // Nothing older than the step just used works either: the next valid code is one that does not exist yet.
    expect((await mfaStep(again.body.mfaToken, { code: nextCode(secret, 0) })).status).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    const { s, recoveryCodes } = await enrol('Lost Phone');
    const first = await login(s.email);
    const used = await mfaStep(first.body.mfaToken, { recoveryCode: recoveryCodes[0]! });
    expect(used.status).toBe(200);
    const second = await login(s.email);
    expect((await mfaStep(second.body.mfaToken, { recoveryCode: recoveryCodes[0]! })).status).toBe(
      401,
    );
    expect(
      (await mfaStep(second.body.mfaToken, { recoveryCode: recoveryCodes[1]!.toUpperCase() }))
        .status,
    ).toBe(200);
    const signedIn = { Authorization: `Bearer ${used.body.accessToken}` };
    expect((await ctx.http().get('/api/v1/me/mfa').set(signedIn)).body.recoveryCodesLeft).toBe(8);
  });

  it('does not let one kind of token stand in for another', async () => {
    const { s } = await enrol('Token Types');
    const challenge = await login(s.email);
    const asAccess = await ctx
      .http()
      .get('/api/v1/me')
      .set({ Authorization: `Bearer ${challenge.body.mfaToken}` });
    expect(asAccess.status).toBe(401);
    const other = await signUp(ctx, 'Two Orgs Host');
    const guest = await signUp(ctx, 'Two Orgs Guest');
    await joinAs(ctx, other, guest, 'ANALYST');
    const multi = await login(guest.email);
    expect(multi.body.selectionToken).toBeTruthy();
    expect((await mfaStep(multi.body.selectionToken, { code: '123456' })).status).toBe(401);
    expect((await mfaStep('x'.repeat(30), { code: '123456' })).status).toBe(401);
    expect((await mfaStep(challenge.body.mfaToken, {})).status).toBe(400);
  });

  it('turns off only with the password and a code, then asks for nothing more', async () => {
    const { s, secret } = await enrol('Switching Off');
    const wrongPassword = await ctx
      .http()
      .post('/api/v1/me/mfa/disable')
      .set(s.auth)
      .send({ password: 'not the password', code: nextCode(secret) });
    expect(wrongPassword.status).toBe(422);
    const noCode = await ctx
      .http()
      .post('/api/v1/me/mfa/disable')
      .set(s.auth)
      .send({ password: PASSWORD, code: '000000' });
    expect(noCode.status).toBe(422);
    const off = await ctx
      .http()
      .post('/api/v1/me/mfa/disable')
      .set(s.auth)
      .send({ password: PASSWORD, code: nextCode(secret) });
    expect(off.status).toBe(204);
    expect((await login(s.email)).body.accessToken).toBeTruthy();
    expect((await ctx.http().get('/api/v1/me/mfa').set(s.auth)).body.enabled).toBe(false);
    const trail = await ctx.http().get('/api/v1/audit?limit=50').set(s.auth);
    const actions = trail.body.items.map((e: { action: string }) => e.action);
    expect(actions).toContain('mfa.enabled');
    expect(actions).toContain('mfa.disabled');
  });

  it('replaces recovery codes only when shown a current code, and the old ones stop working', async () => {
    const { s, secret, recoveryCodes } = await enrol('New Codes');
    expect(
      (await ctx.http().post('/api/v1/me/mfa/recovery-codes').set(s.auth).send({ code: '000000' }))
        .status,
    ).toBe(422);
    const fresh = await ctx
      .http()
      .post('/api/v1/me/mfa/recovery-codes')
      .set(s.auth)
      .send({ code: nextCode(secret) });
    expect(fresh.status).toBe(200);
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    const attempt = await login(s.email);
    expect((await mfaStep(attempt.body.mfaToken, { recoveryCode: recoveryCodes[0]! })).status).toBe(
      401,
    );
    expect(
      (await mfaStep(attempt.body.mfaToken, { recoveryCode: fresh.body.recoveryCodes[0] })).status,
    ).toBe(200);
  });

  it('tells the person by notification when it is turned on', async () => {
    const { s } = await enrol('Notified');
    await ctx.dispatch();
    const inbox = await ctx.http().get('/api/v1/notifications').set(s.auth);
    expect(inbox.body.items.some((n: { kind: string }) => n.kind === 'SECURITY')).toBe(true);
  });
});
