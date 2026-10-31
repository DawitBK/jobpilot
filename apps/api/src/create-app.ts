import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { applyKit } from '@jobpilot/kit';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import type { Env } from './config.js';
import { serverConnection, type AiProviderFactory } from './ai/provider.js';
import type { JobFeedFetcher } from './jobs/feeds.js';
import { PaymentProviders } from './billing/payments/registry.js';
import { FileMailer, NoMailer, SmtpMailer, type Mailer } from './outbox/mailer.js';
import { SecretBox } from './secrets/secret-box.js';

export interface AppOptions {
  logger?: Logger;
  /** Replace the network fetcher the job-source connectors use (tests supply canned feeds). */
  fetcher?: JobFeedFetcher;
  /** Replace outgoing mail (tests capture messages instead of sending them). */
  mailer?: Mailer;
  /** Replace the AI provider (tests answer with canned replies; no suite ever calls out). */
  aiProviderFactory?: AiProviderFactory;
  /** Replace the payment providers (tests use a fake one; no suite ever calls a real provider). */
  paymentProviders?: PaymentProviders;
}

/** Build the application. Shared by `main.ts` and the integration tests. */
export async function createApp(env: Env, options: AppOptions = {}): Promise<INestApplication> {
  const mailer: Mailer = options.mailer ?? chooseMailer(env);
  const payments = options.paymentProviders ?? PaymentProviders.fromSettings(env);
  if (payments.connected && !env.APP_URL) {
    throw new Error(
      'A payment provider is configured, so APP_URL must be set: it is where buyers return to',
    );
  }
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
      { providers: payments, appUrl: env.APP_URL ?? '' },
      { pollMs: env.SOURCES_POLL_MS },
    ),
    { rawBody: true, logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'] },
  );
  applyKit(app, options.logger);
  await app.init();
  return app;
}

/** SMTP when it is configured; a folder of text files for development; otherwise nothing is sent and notifications stay in the app. */
function chooseMailer(env: Env): Mailer {
  if (env.SMTP_URL) return smtpMailer(env);
  if (env.MAIL_OUTBOX_DIR) {
    if (env.NODE_ENV === 'production') {
      throw new Error('MAIL_OUTBOX_DIR is for development only; production needs SMTP_URL');
    }
    return new FileMailer(env.MAIL_OUTBOX_DIR);
  }
  return new NoMailer();
}

/** SMTP_URL needs the sender and the web address that the links in emails point to; a half-set mail setup fails at boot. */
function smtpMailer(env: Env): Mailer {
  if (!env.MAIL_FROM || !env.APP_URL) {
    throw new Error('SMTP_URL is set, so MAIL_FROM and APP_URL must be set too');
  }
  return new SmtpMailer(env.SMTP_URL!, env.MAIL_FROM);
}
