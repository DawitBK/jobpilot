// Prepares a local development database: PostgreSQL 18 has uuidv7() built in; on an older server the
// same function is defined here (the integration suite does the same). Safe to run any number of times.
//   node scripts/dev-db.mjs            (reads MIGRATION_DATABASE_URL from .env or the environment)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const require = createRequire(new URL('apps/api/package.json', root));
const pg = require('pg');

try {
  for (const line of readFileSync(fileURLToPath(new URL('.env', root)), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  // no .env: the environment must carry the variable
}

const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error('Set MIGRATION_DATABASE_URL (the schema owner role) in .env or the environment.');

const SHIM = `
create or replace function uuidv7() returns uuid language sql volatile as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$`;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { rows } = await client.query(`select current_setting('server_version_num')::int as v`);
  if (rows[0].v >= 180000) {
    console.log('PostgreSQL 18 or newer: uuidv7() is built in, nothing to do.');
  } else {
    await client.query(SHIM);
    console.log(`PostgreSQL ${rows[0].v}: defined uuidv7() for development.`);
  }
} finally {
  await client.end();
}
