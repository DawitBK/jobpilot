import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
