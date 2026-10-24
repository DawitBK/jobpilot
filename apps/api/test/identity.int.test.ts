import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../src/auth/auth.service.js';
import { ROLE_PERMISSIONS } from '../src/common/permissions.js';
import {
  closeContext,
  joinAs,
  PASSWORD,
  signIn,
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

describe('registration and sign-in', () => {
  it('creates an account with a personal workspace the person owns', async () => {
    const s = await signUp(ctx, 'Hana Bekele');
    expect(s.role).toBe('OWNER');
    const me = await ctx.http().get('/api/v1/me').set(s.auth);
    expect(me.status).toBe(200);
    expect(me.body.organization.name).toBe("Hana Bekele's Workspace");
    expect(me.body.permissions).toEqual(expect.arrayContaining(['billing:manage', 'audit:read']));
    expect(JSON.stringify(me.body)).not.toMatch(/password|hash/i);
    // In their own workspace the person is also the candidate whose search it manages.
    const profile = await ctx.http().get('/api/v1/candidates/me').set(s.auth);
    expect(profile.body.fullName).toBe('Hana Bekele');
  });

  it('rejects a weak password, a duplicate email and unknown fields', async () => {
    const email = `${randomUUID()}@example.test`;
    const body = { email, password: PASSWORD, fullName: 'A B' };
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/register')
          .send({ ...body, password: 'short' })
      ).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/register')
          .send({ ...body, role: 'OWNER' })
      ).status,
    ).toBe(400);
    expect((await ctx.http().post('/api/v1/auth/register').send(body)).status).toBe(201);
    const dupe = await ctx
      .http()
      .post('/api/v1/auth/register')
      .send({ ...body, email: email.toUpperCase() });
    expect(dupe.status).toBe(409);
    expect(dupe.body.code).toBe('email-taken');
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const s = await signUp(ctx);
    const wrong = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: s.email, password: 'definitely wrong' });
    const unknown = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'definitely wrong' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body.detail).toBe(unknown.body.detail);
  });

  it('guards every private route by default', async () => {
    for (const path of [
      '/api/v1/me',
      '/api/v1/jobs',
      '/api/v1/candidates',
      '/api/v1/applications',
      '/api/v1/audit',
    ]) {
      const res = await ctx.http().get(path);
      expect(res.status, path).toBe(401);
      expect(res.type).toBe('application/problem+json');
    }
    expect((await ctx.http().get('/api/v1/me').set('Authorization', 'Bearer nope')).status).toBe(
      401,
    );
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the whole session when a spent one is replayed', async () => {
    const s = await signUp(ctx);
    const rotated = await ctx
      .http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(s.refreshToken);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: rotated.body.refreshToken })
      ).status,
    ).toBe(401);
  });

  it('logout revokes the session', async () => {
    const s = await signUp(ctx);
    expect(
      (await ctx.http().post('/api/v1/auth/logout').send({ refreshToken: s.refreshToken })).status,
    ).toBe(204);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status,
    ).toBe(401);
  });
});

describe('belonging to several organizations', () => {
  it('asks which one when a person belongs to more than one, and a selection token is not an access token', async () => {
    const host = await signUp(ctx, 'Host Owner');
    const guest = await signUp(ctx, 'Guest Person');
    await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: guest.email, role: 'RECRUITER' });

    const login = await ctx
      .http()
      .post('/api/v1/auth/login')
      .send({ email: guest.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.organizationSelectionRequired).toBe(true);
    expect(login.body.organizations).toHaveLength(2);
    expect(login.body.accessToken).toBeUndefined();

    // The selection token proves a password was checked, nothing more.
    expect(
      (
        await ctx
          .http()
          .get('/api/v1/me')
          .set('Authorization', `Bearer ${login.body.selectionToken}`)
      ).status,
    ).toBe(401);

    const chosen = await ctx
      .http()
      .post('/api/v1/auth/select-organization')
      .send({ selectionToken: login.body.selectionToken, organizationId: host.organizationId });
    expect(chosen.status).toBe(200);
    expect(chosen.body.organization).toMatchObject({ id: host.organizationId, role: 'RECRUITER' });

    // An organization they do not belong to is refused, even with a valid selection token.
    const stranger = await signUp(ctx);
    const refused = await ctx
      .http()
      .post('/api/v1/auth/select-organization')
      .send({ selectionToken: login.body.selectionToken, organizationId: stranger.organizationId });
    expect(refused.status).toBe(401);
  });

  it('carries the role in the token, and a removed member loses access immediately', async () => {
    const host = await signUp(ctx);
    const guest = await joinAs(ctx, host, await signUp(ctx), 'ANALYST');
    expect(guest.role).toBe('ANALYST');
    expect(
      (await ctx.http().post('/api/v1/jobs').set(guest.auth).send({ companyName: 'X', title: 'Y' }))
        .status,
    ).toBe(403);
    expect((await ctx.http().get('/api/v1/jobs').set(guest.auth)).status).toBe(200);

    const members = await ctx.http().get('/api/v1/organization/members').set(host.auth);
    const entry = members.body.find((m: { userId: string }) => m.userId === guest.userId);
    const removed = await ctx
      .http()
      .patch(`/api/v1/organization/members/${entry.id}`)
      .set(host.auth)
      .send({ status: 'REMOVED' });
    expect(removed.status).toBe(200);
    // Their refresh token in this organization is dead now, not at some later expiry.
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: guest.refreshToken }))
        .status,
    ).toBe(401);
    // And they can still sign in to their own workspace.
    expect((await signIn(ctx, guest.email)).role).toBe('OWNER');
  });

  it('never hands out the owner role, and the owner cannot be changed', async () => {
    const host = await signUp(ctx);
    const guest = await signUp(ctx);
    const asOwner = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: guest.email, role: 'OWNER' });
    expect(asOwner.status).toBe(400);
    const unknown = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: 'unregistered@example.test', role: 'RECRUITER' });
    expect(unknown.status).toBe(404);

    const members = (await ctx.http().get('/api/v1/organization/members').set(host.auth)).body;
    const owner = members.find((m: { role: string }) => m.role === 'OWNER');
    const demote = await ctx
      .http()
      .patch(`/api/v1/organization/members/${owner.id}`)
      .set(host.auth)
      .send({ role: 'ANALYST' });
    expect(demote.status).toBe(422);
    expect(demote.body.code).toBe('owner-is-fixed');

    const joined = await joinAs(ctx, host, guest, 'RECRUITER');
    expect(joined.role).toBe('RECRUITER');
    const twice = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: guest.email, role: 'ANALYST' });
    expect(twice.status).toBe(409);
  });
});

describe('roles and permissions', () => {
  it('keeps the role templates in the database in step with the code', async () => {
    const { rows } = await ctx.owner.query(
      `select name, permissions from roles where organization_id is null order by name`,
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      const expected = [...ROLE_PERMISSIONS[row.name as keyof typeof ROLE_PERMISSIONS]].sort();
      expect([...row.permissions].sort(), row.name).toEqual(expected);
    }
  });

  it('lets only the right roles do each thing', async () => {
    const host = await signUp(ctx);
    const recruiter = await joinAs(ctx, host, await signUp(ctx), 'RECRUITER');
    const manager = await joinAs(ctx, host, await signUp(ctx), 'HIRING_MANAGER');
    const admin = await joinAs(ctx, host, await signUp(ctx), 'ADMIN');
    const rename = (s: typeof host) =>
      ctx.http().patch('/api/v1/organization').set(s.auth).send({ name: 'Renamed Co' });
    expect((await rename(host)).status).toBe(200);
    expect((await rename(admin)).status).toBe(200);
    expect((await rename(recruiter)).status).toBe(403);
    expect((await rename(manager)).status).toBe(403);

    const addMember = (s: typeof host) =>
      ctx
        .http()
        .post('/api/v1/organization/members')
        .set(s.auth)
        .send({ email: 'x@example.test', role: 'ANALYST' });
    expect((await addMember(recruiter)).status).toBe(403);
    expect((await addMember(manager)).status).toBe(403);
    expect((await ctx.http().get('/api/v1/organization/members').set(recruiter.auth)).status).toBe(
      200,
    );
    expect((await ctx.http().get('/api/v1/organization/members').set(manager.auth)).status).toBe(
      403,
    );
    expect((await ctx.http().get('/api/v1/audit').set(recruiter.auth)).status).toBe(403);
    expect((await ctx.http().get('/api/v1/audit').set(admin.auth)).status).toBe(200);
  });
});

describe('platform', () => {
  it('reports health and publishes the OpenAPI document without credentials', async () => {
    expect((await ctx.http().get('/health/live')).status).toBe(200);
    expect((await ctx.http().get('/health/ready')).body.checks.database.status).toBe('up');
    const doc = await ctx.http().get('/openapi.json');
    expect(doc.status).toBe(200);
    expect(doc.body.paths['/api/v1/jobs'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.body.paths['/api/v1/auth/login'].post.security).toBeUndefined();
  });
});

describe('the platform administrator', () => {
  it('is in no member list, cannot be added or changed by anyone else, and still sees itself', async () => {
    const host = await signUp(ctx);
    const hidden = await joinAs(ctx, host, await signUp(ctx), 'ANALYST');
    await ctx.owner.query('update users set platform_admin = true where id = $1', [hidden.userId]);

    const members = await ctx.http().get('/api/v1/organization/members').set(host.auth);
    expect(members.status).toBe(200);
    expect(members.body.some((m: { userId: string }) => m.userId === hidden.userId)).toBe(false);

    const memberRow = await ctx.owner.query(
      'select id from organization_members where user_id = $1 and organization_id = $2',
      [hidden.userId, host.organizationId],
    );
    const change = await ctx
      .http()
      .patch(`/api/v1/organization/members/${memberRow.rows[0].id}`)
      .set(host.auth)
      .send({ status: 'REMOVED' });
    const nobody = await ctx
      .http()
      .patch(`/api/v1/organization/members/${randomUUID()}`)
      .set(host.auth)
      .send({ status: 'REMOVED' });
    expect(change.status).toBe(404);
    expect(nobody.status).toBe(404);
    expect(change.body.title).toBe(nobody.body.title); // the same answer as an id that never existed
    expect(
      (
        await ctx.owner.query('select status from organization_members where id = $1', [
          memberRow.rows[0].id,
        ])
      ).rows[0].status,
    ).toBe('ACTIVE');

    // Adding the platform administrator by address answers exactly like an address nobody registered.
    const another = await signUp(ctx);
    await ctx.owner.query('update users set platform_admin = true where id = $1', [another.userId]);
    const added = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: another.email, role: 'RECRUITER' });
    const unknown = await ctx
      .http()
      .post('/api/v1/organization/members')
      .set(host.auth)
      .send({ email: 'unregistered@example.test', role: 'RECRUITER' });
    expect(added.status).toBe(404);
    expect(added.body.title).toBe(unknown.body.title);

    // The platform administrator sees their own row.
    const own = await ctx.http().get('/api/v1/organization/members').set(another.auth);
    expect(own.body.some((m: { userId: string }) => m.userId === another.userId)).toBe(true);
  });
});

describe('single sign-on identity and sign-out', () => {
  it('binds the provider id at the first sign-in, then refuses the same email with another id', async () => {
    const auth = ctx.app.get(AuthService);
    const person = await signUp(ctx);
    const sub = `sub-${randomUUID()}`;
    expect((await auth.loginWithVerifiedEmail(person.email, sub)).user.email).toBe(person.email);
    expect(
      (await ctx.owner.query('select sso_subject from users where id = $1', [person.userId]))
        .rows[0].sso_subject,
    ).toBe(sub);
    expect((await auth.loginWithVerifiedEmail(person.email, sub)).user.id).toBe(person.userId);
    await expect(
      auth.loginWithVerifiedEmail(person.email, `sub-${randomUUID()}`),
    ).rejects.toMatchObject({ status: 401 });
    const other = await signUp(ctx);
    await expect(auth.loginWithVerifiedEmail(other.email, sub)).rejects.toMatchObject({
      status: 401,
    }); // an id belongs to one account
  });

  it("the provider's sign-out ends every session of that person and nobody else's", async () => {
    const auth = ctx.app.get(AuthService);
    const a = await signUp(ctx);
    const b = await signUp(ctx);
    const subA = `sub-${randomUUID()}`;
    const tokensA = await auth.loginWithVerifiedEmail(a.email, subA);
    await auth.loginWithVerifiedEmail(b.email, `sub-${randomUUID()}`);
    expect(await auth.revokeSessionsBySsoSubject(`sub-${randomUUID()}`)).toBe(0); // an id this app never saw: nothing, and no error
    expect(await auth.revokeSessionsBySsoSubject(subA)).toBeGreaterThanOrEqual(2);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: tokensA.refreshToken }))
        .status,
    ).toBe(401);
    expect(
      (await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status,
    ).toBe(200);
  });

  it('the back-channel route is public and refuses a missing or malformed token', async () => {
    expect(
      (await ctx.http().post('/api/v1/auth/backchannel-logout').type('form').send({})).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .post('/api/v1/auth/backchannel-logout')
          .type('form')
          .send({ logout_token: 'x'.repeat(30) })
      ).status,
    ).toBeGreaterThanOrEqual(400);
  });
});

describe('access the identity provider manages for this application', () => {
  const emailOf = () => `${randomUUID()}@example.test`;
  const userOf = async (email: string) =>
    (await ctx.owner.query('select id, status, full_name, sso_subject from users where email = $1', [email])).rows[0];
  const membershipsOf = async (userId: string) =>
    (await ctx.owner.query('select count(*)::int as n from organization_members where user_id = $1', [userId])).rows[0].n as number;

  it('creates the account and its own workspace at the first sign-in, for single sign-on only', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    const tokens = await auth.loginWithVerifiedEmail(email, sub, { roles: ['member'], fullName: 'Abebe Kebede' });
    expect(tokens.user).toMatchObject({ email, fullName: 'Abebe Kebede' });
    const row = await userOf(email);
    expect(row).toMatchObject({ status: 'ACTIVE', full_name: 'Abebe Kebede', sso_subject: sub });
    expect(await membershipsOf(row.id)).toBe(1);
    // Nobody knows its password: the usual sign-in cannot be used with a guessed one.
    expect((await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD })).status).toBe(401);
    // A second sign-in finds the same account and workspace.
    expect((await auth.loginWithVerifiedEmail(email, sub, { roles: ['member'] })).user.id).toBe(row.id);
    expect(await membershipsOf(row.id)).toBe(1);
  });

  it('refuses with 403 when the provider did not give the member role, and creates nothing', async () => {
    const auth = ctx.app.get(AuthService);
    for (const roles of [[], ['wizard'], ['OWNER']]) {
      const email = emailOf();
      await expect(auth.loginWithVerifiedEmail(email, `sub-${randomUUID()}`, { roles })).rejects.toMatchObject({ status: 403 });
      expect(await userOf(email)).toBeUndefined();
    }
  });

  it('a person who held an account and then lost the role is refused, and their account and workspace are kept', async () => {
    const auth = ctx.app.get(AuthService);
    const person = await signUp(ctx);
    await expect(auth.loginWithVerifiedEmail(person.email, `sub-${randomUUID()}`, { roles: [] })).rejects.toMatchObject({ status: 403 });
    const row = await userOf(person.email);
    expect(row.status).toBe('ACTIVE');
    expect(await membershipsOf(row.id)).toBeGreaterThanOrEqual(1);
  });

  it('does not override an account suspended here, and still binds the id to one person', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    await auth.loginWithVerifiedEmail(email, sub, { roles: ['member'] });
    await ctx.owner.query(`update users set status = 'SUSPENDED' where email = $1`, [email]);
    await expect(auth.loginWithVerifiedEmail(email, sub, { roles: ['member'] })).rejects.toMatchObject({ status: 401 });
    await expect(auth.loginWithVerifiedEmail(emailOf(), sub, { roles: ['member'] })).rejects.toMatchObject({ status: 401 }); // an id belongs to one account
  });

  it('two first sign-ins at once create one account and one workspace', async () => {
    const auth = ctx.app.get(AuthService);
    const email = emailOf();
    const sub = `sub-${randomUUID()}`;
    const results = await Promise.allSettled([
      auth.loginWithVerifiedEmail(email, sub, { roles: ['member'] }),
      auth.loginWithVerifiedEmail(email, sub, { roles: ['member'] }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const row = await userOf(email);
    expect((await ctx.owner.query('select count(*)::int as n from users where email = $1', [email])).rows[0].n).toBe(1);
    expect(await membershipsOf(row.id)).toBe(1);
  });

  it('without roles from the provider it still needs an existing account, as before', async () => {
    const auth = ctx.app.get(AuthService);
    await expect(auth.loginWithVerifiedEmail(emailOf(), `sub-${randomUUID()}`)).rejects.toMatchObject({ status: 401 });
  });
});
