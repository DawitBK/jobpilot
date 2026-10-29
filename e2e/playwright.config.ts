import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a RUNNING stack (see docs/RUNBOOK.md): the API, the web app and a seeded
 * database. They create their own people through the API, so they can be run again and again against
 * the same database, and they never touch the seeded accounts' passwords or data in a way a second
 * run would trip over.
 *
 *   WEB_URL=http://127.0.0.1:3031 API_URL=http://127.0.0.1:3000 pnpm test:e2e
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // One at a time: sign-in is rate limited per address, and the journeys share a database.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env['WEB_URL'] ?? 'http://127.0.0.1:3031',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
