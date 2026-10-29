import { createHmac, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

export const API = (process.env['API_URL'] ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
export const PASSWORD = process.env['SEED_PASSWORD'] ?? 'JobPilot-Demo-2026';
export const AGENCY = 'Northwind Talent Partners';
export const seeded = (key: string) => `${key}@northwind-talent.test`;

/** A call to the API as someone (or as nobody), for setting up state the browser journeys then look at. */
// The tests read arbitrary response bodies; the API's own schemas are what the integration suite pins down.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = Record<string, any>>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}/api/v1${path}`, {
    method,
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
}

export interface Person {
  email: string;
  password: string;
  token: string;
  userId: string;
}

/** A brand-new person with their own workspace, made through the API. */
export async function newPerson(name: string): Promise<Person> {
  const email = `e2e.${randomUUID().slice(0, 8)}@example.test`;
  const reg = await api('POST', '/auth/register', {
    body: { email, password: PASSWORD, fullName: name },
  });
  expect(reg.status).toBe(201);
  const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
  expect(login.status).toBe(200);
  return {
    email,
    password: PASSWORD,
    token: login.json['accessToken'],
    userId: login.json['user'].id,
  };
}

/** A person with the skill a job asks for, an application opened by the matcher, and the job's id. */
export async function personWithApplication(
  name: string,
  jobOverrides: Record<string, unknown> = {},
) {
  const person = await newPerson(name);
  const me = await api('GET', '/candidates/me', { token: person.token });
  await api('POST', `/candidates/${me.json['id']}/skills`, {
    token: person.token,
    body: { skillName: 'typescript', proficiency: 'ADVANCED', yearsExperience: 5 },
  });
  const job = await api('POST', '/jobs', {
    token: person.token,
    body: {
      companyName: 'Initech',
      title: 'Platform Engineer',
      remoteType: 'REMOTE',
      requiredSkills: ['typescript'],
      description: 'Build the platform.',
      ...jobOverrides,
    },
  });
  expect(job.status).toBe(201);
  const list = await api('GET', `/applications?jobId=${job.json['id']}`, { token: person.token });
  const application =
    list.json['items'][0] ??
    (await api('POST', '/applications', { token: person.token, body: { jobId: job.json['id'] } }))
      .json;
  return { person, applicationId: application.id as string, jobId: job.json['id'] as string };
}

export const move = (token: string, id: string, to: string) =>
  api('POST', `/applications/${id}/transition`, { token, body: { to } });

/** Sign in through the real form; chooses the workspace when the person belongs to several. */
export async function signInUi(page: Page, email: string, password = PASSWORD, workspace?: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const choose = page.getByText('Which organization?');
  const arrived = page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => undefined);
  await Promise.race([arrived, choose.waitFor({ timeout: 15_000 }).catch(() => undefined)]);
  if (await choose.isVisible().catch(() => false)) {
    await page.getByRole('radio', { name: new RegExp(workspace ?? AGENCY) }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await page.waitForURL(/\/dashboard/);
}

/** Go to a page and wait until it has hydrated: a click before that does nothing, which is not what a person sees. */
export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForLoadState('networkidle');
  return response;
}

/** Collects what the browser reports as broken, so a journey can insist on none of it. */
export function watchForErrors(page: Page) {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(m.text()))
      problems.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} from ${r.url()}`);
  });
  return problems;
}

/** Every form control on the page has a name a screen reader can say. */
export async function unnamedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach((el) => {
      const input = el as HTMLInputElement;
      const named =
        input.getAttribute('aria-label') ||
        input.getAttribute('aria-labelledby') ||
        (input.labels && input.labels.length > 0) ||
        input.closest('label');
      if (!named) bad.push(`${input.tagName.toLowerCase()}[name=${input.name}]`);
    });
    return bad;
  });
}

// ------------------------------------------------------------ an authenticator app, written independently of the server

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The code an authenticator app would show `stepsAhead` 30-second steps from now. */
export function totp(secret: string, stepsAhead = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepsAhead));
  const mac = createHmac('sha1', base32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const code =
    ((mac[offset]! & 127) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, '0');
}

/**
 * The recovery link mailed to `email`. The API under test writes its mail to a folder (MAIL_OUTBOX_DIR, development and CI only);
 * this waits for the newest message to that address and returns the link in it.
 */
export async function recoveryLinkFor(email: string, since = Date.now() - 1000): Promise<string> {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = process.env['MAIL_OUTBOX_DIR'] ?? join(process.cwd(), '.dev-mail');
  const safe = email.replace(/[^a-z0-9@._-]/gi, '_');
  for (let i = 0; i < 40; i += 1) {
    const files = (() => {
      try {
        return readdirSync(dir).filter((f) => f.endsWith(`-${safe}.txt`));
      } catch {
        return [];
      }
    })()
      .map((f) => join(dir, f))
      .filter((f) => statSync(f).mtimeMs >= since)
      .sort();
    for (const file of files.reverse()) {
      const link = readFileSync(file, 'utf8').match(
        /https?:\/\/\S+\/reset-password\?token=[\w-]+/,
      )?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no recovery mail arrived for ${email} (is MAIL_OUTBOX_DIR set for the API?)`);
}
