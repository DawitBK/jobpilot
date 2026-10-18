import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { applyKit } from '@jobpilot/kit';
import type { Logger } from 'pino';
import { AppModule } from './app.module.js';
import type { Env } from './config.js';
import type { JobFeedFetcher } from './jobs/feeds.js';

export interface AppOptions {
  logger?: Logger;
  /** Replace the network fetcher the job-source connectors use (tests supply canned feeds). */
  fetcher?: JobFeedFetcher;
}

/** Build the application. Shared by `main.ts` and the integration tests. */
export async function createApp(env: Env, options: AppOptions = {}): Promise<INestApplication> {
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
              }
            : undefined,
      },
      options.fetcher,
    ),
    { logger: env.NODE_ENV === 'test' ? false : ['error', 'warn'] },
  );
  applyKit(app, options.logger);
  await app.init();
  return app;
}
