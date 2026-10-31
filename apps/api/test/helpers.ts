import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '@jobpilot/kit';
import pg from 'pg';
import request from 'supertest';
import { envSchema } from '../src/config.js';
import { codeAt, stepOf } from '../src/auth/totp.js';
import type { PaymentProviders } from '../src/billing/payments/registry.js';
import { createApp } from '../src/create-app.js';
import type { JobFeedFetcher } from '../src/jobs/feeds.js';
import type { AiConnection, AiProvider, AiRequest } from '../src/ai/provider.js';
import type { Mailer, MailMessage } from '../src/outbox/mailer.js';
import { SourceScheduler } from '../src/jobs/sources.scheduler.js';
import { OutboxDispatcher } from '../src/outbox/outbox.dispatcher.js';

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

/** Collects what would have been emailed; `failNext` makes the next send fail like a mail outage would. */
export class CaptureMailer implements Mailer {
  readonly configured = true;
  readonly sent: MailMessage[] = [];
  failing = false;
  async send(message: MailMessage): Promise<void> {
    if (this.failing) throw new Error('mail server unreachable');
    this.sent.push(message);
  }
}

/**
 * Stands in for the language model. It records the key it was given and every request, and answers with
 * whatever `reply` returns, or throws what `fail` holds. No suite ever calls a real provider.
 */
export class FakeAi {
  readonly keys: string[] = [];
  readonly connections: AiConnection[] = [];
  readonly requests: AiRequest[] = [];
  reply: (request: AiRequest) => string = () =>
    JSON.stringify({ content: 'Nothing to say.', claims: [] });
  fail: Error | null = null;
  readonly factory = (connection: AiConnection): AiProvider => ({
    name: 'fake',
    model: 'fake-model-1',
    complete: async (request) => {
      this.keys.push(connection.apiKey);
      this.connections.push(connection);
      this.requests.push(request);
      if (this.fail) throw this.fail;
      return { text: this.reply(request), model: 'fake-model-1' };
    },
  });
}

export interface TestContext {
  app: INestApplication;
  /** The owner role (superuser in tests): sees everything, for setup and for tampering checks. */
  owner: pg.Pool;
  /** The runtime role: what the application connects as, and subject to row-level security. */
  runtime: pg.Pool;
  fetcher: FakeFetcher;
  mailer: CaptureMailer;
  ai: FakeAi;
  /** Run the outbox dispatcher once, now (the background loop is off in tests). */
  dispatch: () => Promise<number>;
  /** Read every job source that is due, now (the schedule is off in tests). */
  pollSources: () => Promise<number>;
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

export async function startContext(
  options: { paymentProviders?: PaymentProviders } = {},
): Promise<TestContext> {
  const ai = new FakeAi();
  const env = parseEnv(envSchema, {
    ...process.env,
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
    OUTBOX_POLL_MS: '0',
    SOURCES_POLL_MS: '0',
    // A connected payment provider needs to know where buyers return to; the suite never opens it.
    ...(options.paymentProviders ? { APP_URL: 'https://app.example.test' } : {}),
    // 32 bytes, fixed: the suite only needs encryption to work, not to be secret.
    SECRETS_KEY: Buffer.alloc(32, 5).toString('base64'),
    // The suite never inherits a developer's AI vendor keys: "AI is not set up" is a state it tests on purpose.
    AI_PROVIDER: undefined,
    GROQ_API_KEY: undefined,
    GROQ_MODEL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    OPENAI_BASE_URL: undefined,
    AI_BASE_URL: undefined,
    AI_API_KEY: undefined,
    AI_MODEL: undefined,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_MODEL: undefined,
  });
  const fetcher = new FakeFetcher();
  const mailer = new CaptureMailer();
  const app = await createApp(env, {
    fetcher,
    mailer,
    aiProviderFactory: ai.factory,
    ...(options.paymentProviders ? { paymentProviders: options.paymentProviders } : {}),
  });
  return {
    app,
    owner: new pg.Pool({ connectionString: process.env['MIGRATION_DATABASE_URL'], max: 2 }),
    runtime: new pg.Pool({ connectionString: process.env['DATABASE_URL'], max: 2 }),
    fetcher,
    mailer,
    ai,
    dispatch: () => app.get(OutboxDispatcher).tick(),
    pollSources: () => app.get(SourceScheduler).tick(),
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

/**
 * Put `person` into `host`'s organization with a role, and return their session in that organization.
 * Fixtures need room for many people, so the host's organization is put on the TEAM plan first; the
 * billing tests pass `plan: null` to keep the limits that a real free workspace has.
 */
export async function joinAs(
  ctx: TestContext,
  host: Session,
  person: Session,
  role: string,
  options: { plan?: string | null } = {},
): Promise<Session> {
  if (options.plan !== null) {
    await ctx.owner.query(`update organizations set plan = $2 where id = $1`, [
      host.organizationId,
      options.plan ?? 'TEAM',
    ]);
  }
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

/** Turn two-step sign-in on for a new person; returns what they would have in their authenticator app. */
export async function enrolMfa(ctx: TestContext, fullName: string) {
  const s = await signUp(ctx, fullName);
  const setup = await ctx.http().post('/api/v1/me/mfa/setup').set(s.auth);
  if (setup.status !== 200) throw new Error(`mfa setup failed: ${setup.status}`);
  const secret = setup.body.secret as string;
  const enable = await ctx
    .http()
    .post('/api/v1/me/mfa/enable')
    .set(s.auth)
    .send({ code: codeAt(secret, stepOf(Date.now())) });
  if (enable.status !== 200) throw new Error(`mfa enable failed: ${enable.status}`);
  return { s, secret, recoveryCodes: enable.body.recoveryCodes as string[] };
}
