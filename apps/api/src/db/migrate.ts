import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Apply the generated SQL migrations in `drizzle/`. Safe to run repeatedly. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Migrations run as the schema owner, never as the runtime role (which cannot bypass row-level security).
  const url = process.env['MIGRATION_DATABASE_URL'];
  if (!url) {
    process.stderr.write('MIGRATION_DATABASE_URL is required (the owner role, not the app role)\n');
    process.exit(1);
  }
  await runMigrations(url);
  process.stdout.write('migrations applied\n');
}
