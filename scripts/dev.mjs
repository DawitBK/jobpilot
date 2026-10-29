// Runs the API (built) and the web app (dev server) together with the settings from .env.
//   pnpm build && pnpm --filter @jobpilot/api db:migrate && node scripts/dev.mjs
// Stops both when either exits or when this process is stopped.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const env = { ...process.env };
try {
  for (const line of readFileSync(fileURLToPath(new URL('.env', root)), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
} catch {
  // no .env: the environment must carry every setting
}

const children = [
  spawn(process.execPath, ['dist/main.js'], {
    cwd: fileURLToPath(new URL('apps/api/', root)),
    env,
    stdio: 'inherit',
    windowsHide: true,
  }),
  spawn(
    process.execPath,
    [
      fileURLToPath(new URL('node_modules/next/dist/bin/next', new URL('apps/web/', root))),
      'dev',
      '--port',
      env.WEB_PORT ?? '3031',
    ],
    {
      cwd: fileURLToPath(new URL('apps/web/', root)),
      env,
      stdio: 'inherit',
      windowsHide: true,
    },
  ),
];

let stopping = false;
const stop = (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
};
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
