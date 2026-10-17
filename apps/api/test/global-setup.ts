import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

/**
 * PostgreSQL 18 (what CI and production run) has `uuidv7()` built in. On an older local server the
 * same function is defined here so the suite can run.
 */
const UUIDV7_SHIM = `
create or replace function uuidv7() returns uuid language sql volatile as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$`;

const dbName = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

/**
 * The suite needs two roles, exactly as production does: an OWNER that runs the migrations
 * (MIGRATION_DATABASE_URL) and the RUNTIME role the application connects as (DATABASE_URL), which
 * must not be able to bypass row-level security. The tenant-isolation tests are meaningless if the
 * application ran as a superuser, so this refuses to continue when the runtime role could bypass.
 */
export default async function setup(): Promise<void> {
  const owner = process.env['MIGRATION_DATABASE_URL'];
  const runtime = process.env['DATABASE_URL'];
  if (!owner || !runtime) {
    throw new Error(
      'Set MIGRATION_DATABASE_URL (owner) and DATABASE_URL (the jobpilot_app runtime role), e.g.\n' +
        '  MIGRATION_DATABASE_URL=postgres://jobpilot:jobpilot@localhost:5432/jobpilot_test\n' +
        '  DATABASE_URL=postgres://jobpilot_app:jobpilot_app@localhost:5432/jobpilot_test',
    );
  }
  const name = dbName(owner);
  if (!/_test$/.test(name) || dbName(runtime) !== name) {
    throw new Error('Both URLs must point at the same database, and its name must end in _test');
  }
  const appUser = decodeURIComponent(new URL(runtime).username);
  const appPassword = decodeURIComponent(new URL(runtime).password);
  if (appUser !== 'jobpilot_app') throw new Error('The runtime role must be named jobpilot_app');

  const admin = new URL(owner);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query(`select 1 from pg_roles where rolname = $1`, [appUser]);
    const ident = `"${appUser}"`;
    const literal = `'${appPassword.replace(/'/g, "''")}'`;
    if (exists.rowCount === 0) {
      await client.query(
        `create role ${ident} login nosuperuser nocreatedb nocreaterole nobypassrls password ${literal}`,
      );
    } else {
      await client.query(`alter role ${ident} login nosuperuser nobypassrls password ${literal}`);
    }
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`,
      [name],
    );
    await client.query(`drop database if exists "${name}"`);
    await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }

  const db = new pg.Client({ connectionString: owner });
  await db.connect();
  try {
    const { rows } = await db.query<{ v: number }>(
      `select current_setting('server_version_num')::int as v`,
    );
    if ((rows[0]?.v ?? 0) < 180000) await db.query(UUIDV7_SHIM);
  } finally {
    await db.end();
  }
  await runMigrations(owner);

  // The whole point: the runtime role must NOT be able to bypass row-level security.
  const check = new pg.Client({ connectionString: runtime });
  await check.connect();
  try {
    const { rows } = await check.query<{ super: boolean; bypass: boolean }>(
      `select rolsuper as super, rolbypassrls as bypass from pg_roles where rolname = current_user`,
    );
    if (rows[0]?.super || rows[0]?.bypass) {
      throw new Error(
        'The runtime role can bypass row-level security; tenant isolation would not be tested',
      );
    }
  } finally {
    await check.end();
  }
}
