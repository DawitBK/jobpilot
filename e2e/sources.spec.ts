import { expect, test } from '@playwright/test';
import { newPerson, open, signInUi, unnamedControls, watchForErrors } from './support.js';

/**
 * The job-sources screens, in a real browser. These journeys need no outside website: what a source
 * brings from the real internet is proven separately by scripts/sources-live-check.mjs.
 */
test.describe('job sources', () => {
  test('the catalog offers every site asked for, says honestly which cannot be read, and filters as you type', async ({
    page,
  }) => {
    const problems = watchForErrors(page);
    const person = await newPerson('Sources Catalog');
    await signInUi(page, person.email);
    await open(page, '/sources');
    await expect(page.getByText('No sources yet', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Add a source' }).first().click();
    await expect(page).toHaveURL(/\/sources\/catalog/);

    for (const name of [
      'LinkedIn',
      'Glassdoor',
      'Google Careers',
      'EthioJobs',
      'Hahu Jobs',
      'Bayt',
    ]) {
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }
    // Honest about each: an open feed is added, a site that forbids robots is added from links.
    const linkedin = page.locator('[data-entry="linkedin"]');
    await expect(linkedin.getByText('Add from links', { exact: true }).first()).toBeVisible();
    await expect(linkedin.getByText(/does not scrape it/)).toBeVisible();
    await expect(linkedin.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-entry="lever"]').getByText('Open feed')).toBeVisible();
    await expect(page.locator('[data-entry="json"]').getByText('You set it up')).toBeVisible();

    await page.getByLabel('Search the catalog').fill('ethiopia');
    await expect(page.getByRole('heading', { name: 'EthioJobs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Remotive' })).toHaveCount(0);
    await page.getByLabel('Search the catalog').fill('zzzz nothing');
    await expect(page.getByText('Nothing matches')).toBeVisible();
    await page.getByLabel('Search the catalog').fill('');
    await page.getByRole('button', { name: 'Remote and global job boards' }).click();
    await expect(page.getByRole('heading', { name: 'Remotive' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'EthioJobs' })).toHaveCount(0);

    expect(await unnamedControls(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('sets up a source, refuses what is missing or private in plain words, then manages it', async ({
    page,
  }) => {
    const problems = watchForErrors(page);
    const person = await newPerson('Sources Setup');
    await signInUi(page, person.email);
    await open(page, '/sources/catalog');

    const lever = page.locator('[data-entry="lever"]');
    await lever.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Lever' });
    await expect(dialog.getByRole('button', { name: 'Test it' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    // An address on a private network is refused, in words, before anything is saved.
    await page
      .locator('[data-entry="rss"]')
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    const rss = page.getByRole('dialog', { name: 'Add Any RSS or Atom feed' });
    await rss.getByLabel(/Feed address/).fill('https://127.0.0.1/feed.xml');
    await rss.getByRole('button', { name: 'Test it' }).click();
    await expect(rss.getByRole('alert')).toBeVisible();

    await rss.getByLabel(/Feed address/).fill('https://feeds.example.test/jobs.xml');
    await rss.getByRole('textbox', { name: /^Name Leave empty/ }).fill('Example feed');
    await rss.getByLabel('Mentions any of').fill('engineer, nurse');
    await rss.getByLabel('Remote jobs only').check();
    await rss.getByRole('button', { name: 'Add source' }).click();
    await expect(page).toHaveURL(/\/sources$/);
    const row = page.getByRole('row', { name: /Example feed/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('only engineer / nurse · remote only')).toBeVisible();
    await expect(row.getByText('Not yet', { exact: true })).toBeVisible();

    // Reading a site that does not exist fails in plain words and is remembered in the history.
    await row.getByRole('button', { name: 'Read now' }).click();
    await expect(row.getByText('Failed', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: 'Reads of Example feed' });
    await expect(history.getByText('Failed', { exact: true })).toBeVisible();
    await expect(history.getByText('By hand', { exact: true })).toBeVisible();
    await history.getByRole('button', { name: 'Close dialog' }).click();
    await expect(row.getByText(/Waiting longer after 1 failed read/)).toBeVisible();

    // Settings change what is kept; Pause stops reading.
    await row.getByRole('button', { name: 'Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings for Example feed' });
    await settings.getByLabel('Mentions any of').fill('accountant');
    await settings.getByLabel('Newer than (days)').fill('14');
    await settings.getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('only accountant · remote only · newer than 14 days')).toBeVisible();
    await row.getByRole('button', { name: 'Pause' }).click();
    await expect(row.getByText('Paused').first()).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('No sources yet', { exact: true })).toBeVisible();
    // A source that cannot be read answers 502 on purpose; anything else broken is a real problem.
    expect(
      problems.filter((p) => !p.startsWith('502 from ') || !p.includes('/bff/sources/')),
    ).toEqual([]);
  });

  test('adds jobs from links: says what it could not open, and asks for links when there are none', async ({
    page,
  }) => {
    const person = await newPerson('Sources Links');
    await signInUi(page, person.email);
    await open(page, '/jobs');
    await page.getByRole('button', { name: 'Add jobs from links' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add jobs from links' });
    await dialog
      .getByLabel('Links or pasted text')
      .fill('Hello, please see the roles below. No links yet.');
    await dialog.getByRole('button', { name: 'Add the jobs' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Paste at least one https link');

    await dialog
      .getByLabel('Links or pasted text')
      .fill('New role for you: https://127.0.0.1/jobs/1 and https://192.168.0.5/careers.');
    await dialog.getByRole('button', { name: 'Add the jobs' }).click();
    await expect(dialog.getByText('Could not be added')).toHaveCount(2);
    await expect(dialog.getByText('https://127.0.0.1/jobs/1', { exact: true })).toBeVisible();
  });

  test('keeps the email typed when a sign-in is refused', async ({ page }) => {
    const person = await newPerson('Typed Email');
    await open(page, '/login');
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill('not the password at all');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'do not match' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(person.email);
  });
});
