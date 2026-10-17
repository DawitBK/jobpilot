import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema.js';

export const POOL = 'PG_POOL';
export const DB = 'DRIZZLE_DB';

export type Database = NodePgDatabase<typeof schema>;
/** What a repository function receives: the database or an open transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
