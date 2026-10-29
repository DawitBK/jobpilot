import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { applyKit } from '@jobpilot/kit';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import type { Env } from './config.js';
import { serverConnection, type AiProviderFactory } from './ai/provider.js';
import type { JobFeedFetcher } from './jobs/feeds.js';
import { NoMailer, SmtpMailer, type Mailer } from './outbox/mailer.js';
import { SecretBox } from './secrets/secret-box.js';

export interface AppOptions {
  logger?: Logger;
  /** Replace the network fetcher the job-source connectors use (tests supply canned feeds). */
  fetcher?: JobFeedFetcher;
  /** Replace outgoing mail (tests capture messages instead of sending them). */
  mailer?: Mailer;
  /** Replace the AI provider (tests answer with canned replies; no suite ever calls out). */
  aiProviderFactory?: AiProviderFactory;
}

/** Build the application. Shared by `main.ts` and the integration tests. */
export async function createApp(env: Env, options: AppOptions = {}): Promise<INestApplication> {
  const mailer: Mailer = options.mailer ?? (env.SMTP_URL ? smtpMailer(env) : new NoMailer());
  const app = await NestFactory.create(
    AppModule.register(
      env.DATABASE_URL,
      {
        jwtSecret: env.JWT_SECRET,
        accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
        oidc:
          env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET
            ? {
                issuer: env.OIDC_ISSUER,
                clientId: env.OIDC_CLIENT_ID,
                clientSecret: env.OIDC_CLIENT_SECRET,
                internalUrl: env.OIDC_INTERNAL_URL,
              }
            : undefined,
      },
      options.fetcher,
      {
        options: { pollMs: env.OUTBOX_POLL_MS, appUrl: env.APP_URL ?? '' },
        mailer,
      },
      new SecretBox(env.SECRETS_KEY, env.SECRETS_KEY_PREVIOUS),
      {
        settings: {
          server: serverConnection(env),
          allowPrivateBaseUrls: env.AI_ALLOW_PRIVATE_URLS,
        },
        factory: options.aiProviderFactory,
      },
    ),
    { logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'] },
  );
  applyKit(app, options.logger);
  await app.init();
  return app;
}

/** SMTP_URL needs the sender and the web address that the links in emails point to; a half-set mail setup fails at boot. */
function smtpMailer(env: Env): Mailer {
  if (!env.MAIL_FROM || !env.APP_URL) {
    throw new Error('SMTP_URL is set, so MAIL_FROM and APP_URL must be set too');
  }
  return new SmtpMailer(env.SMTP_URL!, env.MAIL_FROM);
}
