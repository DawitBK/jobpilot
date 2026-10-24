import {
  Global,
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { TenantDb } from './tenant.js';
import { DB, POOL } from './tokens.js';

export { DB, POOL, type Database, type Tx } from './tokens.js';

/**
 * The connection pool. When PostgreSQL restarts or the network drops, pg reports the broken idle
 * connection as an 'error' event on the pool, and with no listener Node treats that as fatal and the
 * whole API exits. The listener logs it instead: the pool discards the connection and opens a new one
 * on the next query.
 */
export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const logger = new Logger('Database');
  pool.on('error', (err) => {
    logger.error(`An idle database connection failed and was discarded: ${err.message}`);
  });
  return pool;
}

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
          useFactory: () => createPool(databaseUrl),
        },
        { provide: DB, useFactory: (pool: pg.Pool) => drizzle(pool, { schema }), inject: [POOL] },
        PoolLifecycle,
        TenantDb,
      ],
      exports: [POOL, DB, TenantDb],
    };
  }
}
