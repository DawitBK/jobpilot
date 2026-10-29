import { mkdirSync } from 'node:fs';
import { chromium, type FullConfig } from '@playwright/test';
import { AGENCY, seeded, signInUi } from './support.js';

/** Personas of the seeded demo world, signed in once; each journey reuses the saved session instead of signing in again. */
export const PERSONAS = {
  ana: 'ana.bekele',
  olivia: 'olivia.owner',
  hana: 'hana.manager',
} as const;

export default async function globalSetup(config: FullConfig) {
  mkdirSync('.auth', { recursive: true });
  const browser = await chromium.launch();
  for (const [name, key] of Object.entries(PERSONAS)) {
    const context = await browser.newContext({ baseURL: config.projects[0]!.use.baseURL! });
    const page = await context.newPage();
    await signInUi(page, seeded(key), undefined, AGENCY);
    await context.storageState({ path: `.auth/${name}.json` });
    await context.close();
  }
  await browser.close();
}
