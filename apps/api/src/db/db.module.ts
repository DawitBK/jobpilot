import { Global, Inject, Module, type DynamicModule, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { TenantDb } from './tenant.js';
import { DB, POOL } from './tokens.js';

export { DB, POOL, type Database, type Tx } from './tokens.js';

class PoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({})
export class DbModule {
  static forRoot(databaseUrl: string): DynamicModule {
    return {
      module: DbModule,
      providers: [
        {
          provide: POOL,
          useFactory: () => new pg.Pool({ connectionString: databaseUrl, max: 10 }),
        },
        { provide: DB, useFactory: (pool: pg.Pool) => drizzle(pool, { schema }), inject: [POOL] },
        PoolLifecycle,
        TenantDb,
      ],
      exports: [POOL, DB, TenantDb],
    };
  }
}
