import { Module, type DynamicModule } from '@nestjs/common';
import { HealthModule } from '@jobpilot/kit';
import type pg from 'pg';
import { AuditController } from './audit/audit.controller.js';
import { AuthModule } from './auth/auth.module.js';
import type { AuthConfig } from './common/auth.js';
import { DbModule, POOL } from './db/db.module.js';
import type { JobFeedFetcher } from './jobs/feeds.js';
import { JobsModule } from './jobs/jobs.module.js';
import { OpenApiController } from './openapi.js';

@Module({})
export class AppModule {
  static register(databaseUrl: string, auth: AuthConfig, fetcher?: JobFeedFetcher): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DbModule.forRoot(databaseUrl),
        AuthModule.forRoot(auth),
        HealthModule.registerAsync({
          inject: [POOL],
          useFactory: ((pool: pg.Pool) => ({
            database: async () => {
              await pool.query('select 1');
            },
          })) as never,
        }),
        JobsModule.register(fetcher),
      ],
      controllers: [OpenApiController, AuditController],
    };
  }
}
