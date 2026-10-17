import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '@jobpilot/kit';
import pg from 'pg';
import request from 'supertest';
import { envSchema } from '../src/config.js';
import { createApp } from '../src/create-app.js';
import type { JobFeedFetcher } from '../src/jobs/feeds.js';

export const PASSWORD = 'correct horse battery staple';

/** Canned feeds: a URL either has a body or the fetch fails like a real outage would. */
export class FakeFetcher implements JobFeedFetcher {
  readonly feeds = new Map<string, string>();
  readonly requested: string[] = [];

  async fetchText(url: string): Promise<string> {
    this.requested.push(url);
    const body = this.feeds.get(url);
    if (body === undefined) throw new Error(`No feed at ${url}`);
    return body;
  }
}

export interface TestContext {
  app: INestApplication;
  /** The owner role (superuser in tests): sees everything, for setup and for tampering checks. */
  owner: pg.Pool;
  /** The runtime role: what the application connects as, and subject to row-level security. */
  runtime: pg.Pool;
  fetcher: FakeFetcher;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export interface Session {
  userId: string;
  email: string;
  organizationId: string;
  role: string;
  token: string;
  refreshToken: string;
  auth: { Authorization: string };
}

export async function startContext(): Promise<TestContext> {
  const env = parseEnv(envSchema, {
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
  });
  const fetcher = new FakeFetcher();
  const app = await createApp(env, { fetcher });
  return {
    app,
    owner: new pg.Pool({ connectionString: process.env['MIGRATION_DATABASE_URL'], max: 2 }),
    runtime: new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 }),
    fetcher,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

export async function closeContext(ctx: TestContext): Promise<void> {
  await ctx.close();
  await ctx.owner.end();
  await ctx.runtime.end();
}

export function sessionFrom(body: {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
  organization: { id: string; role: string };
}): Session {
  return {
    userId: body.user.id,
    email: body.user.email,
    organizationId: body.organization.id,
    role: body.organization.role,
    token: body.accessToken,
    refreshToken: body.refreshToken,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

/** Register a person (which gives them a personal workspace they own) and sign them in. */
export async function signUp(ctx: TestContext, fullName = 'Test Person'): Promise<Session> {
  const email = `${randomUUID()}@example.test`;
  const reg = await ctx
    .http()
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, fullName });
  if (reg.status !== 201)
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
  return signIn(ctx, email);
}

export async function signIn(ctx: TestContext, email: string): Promise<Session> {
  const res = await ctx.http().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`login did not return tokens: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return sessionFrom(res.body);
}

/** Put `person` into `host`'s organization with a role, and return their session in that organization. */
export async function joinAs(
  ctx: TestContext,
  host: Session,
  person: Session,
  role: string,
): Promise<Session> {
  const added = await ctx
    .http()
    .post('/api/v1/organization/members')
    .set(host.auth)
    .send({ email: person.email, role });
  if (added.status !== 201)
    throw new Error(`add member failed: ${added.status} ${JSON.stringify(added.body)}`);
  const login = await ctx
    .http()
    .post('/api/v1/auth/login')
    .send({ email: person.email, password: PASSWORD });
  if (login.status !== 200) throw new Error('login after join failed');
  const chosen = await ctx
    .http()
    .post('/api/v1/auth/select-organization')
    .send({ selectionToken: login.body.selectionToken, organizationId: host.organizationId });
  if (chosen.status !== 200)
    throw new Error(`select failed: ${chosen.status} ${JSON.stringify(chosen.body)}`);
  return sessionFrom(chosen.body);
}

export async function makeJob(
  ctx: TestContext,
  who: Session,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number; title: string }> {
  const tag = randomUUID().slice(0, 8);
  const res = await ctx
    .http()
    .post('/api/v1/jobs')
    .set(who.auth)
    .send({
      companyName: `Acme ${tag}`,
      title: `Engineer ${tag}`,
      remoteType: 'REMOTE',
      requiredSkills: ['typescript'],
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`job failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function addSkills(
  ctx: TestContext,
  who: Session,
  profileId: string,
  names: string[],
) {
  for (const skillName of names) {
    const res = await ctx
      .http()
      .post(`/api/v1/candidates/${profileId}/skills`)
      .set(who.auth)
      .send({ skillName });
    if (res.status !== 201)
      throw new Error(`skill failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export async function myProfile(ctx: TestContext, who: Session) {
  const res = await ctx.http().get('/api/v1/candidates/me').set(who.auth);
  return res.body as { id: string; version: number; yearsExperience: number };
}
