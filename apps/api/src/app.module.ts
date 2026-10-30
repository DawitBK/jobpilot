import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from '@jobpilot/kit';
import type pg from 'pg';
import { AuditController } from './audit/audit.controller.js';
import { BillingController } from './billing/billing.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { PaymentsModule } from './billing/payments/payments.module.js';
import type { PaymentProviders } from './billing/payments/registry.js';
import type { AuthConfig } from './common/auth.js';
import { DbModule, POOL } from './db/db.module.js';
import type { AiProviderFactory, AiSettings } from './ai/provider.js';
import type { JobFeedFetcher } from './jobs/feeds.js';
import { JobsModule } from './jobs/jobs.module.js';
import type { Mailer } from './outbox/mailer.js';
import type { OutboxOptions } from './outbox/outbox.dispatcher.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { OpenApiController } from './openapi.js';
import { SecretsModule } from './secrets/secrets.module.js';
import type { SecretBox } from './secrets/secret-box.js';

@Module({})
export class AppModule {
  static register(
    databaseUrl: string,
    auth: AuthConfig,
    fetcher: JobFeedFetcher | undefined,
    outbox: { options: OutboxOptions; mailer?: Mailer },
    secretBox: SecretBox,
    ai: { settings: AiSettings; factory?: AiProviderFactory },
    payments: { providers: PaymentProviders; appUrl: string },
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DbModule.forRoot(databaseUrl),
        SecretsModule.register(secretBox),
        AuthModule.forRoot(auth, {
          options: { appUrl: outbox.options.appUrl },
          mailer: outbox.mailer,
        }),
        HealthModule.registerAsync({
          inject: [POOL],
          useFactory: ((pool: pg.Pool) => ({
            database: async () => {
              await pool.query('select 1');
            },
          })) as never,
        }),
        JobsModule.register(fetcher, ai),
        OutboxModule.register(outbox.options, outbox.mailer),
        PaymentsModule.register(payments.providers, { appUrl: payments.appUrl }),
      ],
      controllers: [OpenApiController, AuditController, BillingController],
    };
  }
}
