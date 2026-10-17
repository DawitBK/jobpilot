import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database, type Tx } from './tokens.js';

export interface TenantScope {
  organizationId: string;
  userId: string;
}

/**
 * Every query that touches tenant data runs through here. It opens a transaction and sets the
 * tenant (and the user) for that transaction only, and the database does the rest: row-level
 * security policies on every tenant table compare each row's `organization_id` with that setting,
 * and the application connects as a role that cannot bypass them. Forgetting a `where` clause
 * therefore cannot leak another tenant's rows.
 *
 * `set_config(..., true)` is used instead of `SET LOCAL` because it accepts bind parameters.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(DB) readonly db: Database) {}

  /** Work inside one tenant, as one user. */
  inTenant<T>(scope: TenantScope, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.organization_id', ${scope.organizationId}, true), set_config('app.user_id', ${scope.userId}, true)`,
      );
      return work(tx);
    });
  }

  /** Work as a user before any organization is chosen (sign-up, sign-in): sees only what that user may. */
  asUser<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return work(tx);
    });
  }

  /** Work with no tenant and no user: only global tables (users, role templates, companies) are visible. */
  global<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
