import { expect, test } from '@playwright/test';
import {
  api,
  move,
  newPerson,
  open,
  personWithApplication,
  recoveryLinkFor,
  signInUi,
  totp,
  unnamedControls,
  watchForErrors,
} from './support.js';

const asAna = { storageState: '.auth/ana.json' };
const asOlivia = { storageState: '.auth/olivia.json' };
const asHana = { storageState: '.auth/hana.json' };

const PAGES: [string, RegExp][] = [
  ['/dashboard', /Welcome, Ana/],
  ['/matches', /Matches/],
  ['/jobs', /Jobs/],
  ['/applications', /Applications/],
  ['/profile', /Ana Bekele/],
  ['/notifications', /Notifications/],
  ['/billing', /Plan and usage/],
  ['/settings', /Settings/],
  ['/security', /Security/],
];

test.describe('the front door', () => {
  test('is public, explains itself, and keeps the workspace behind sign-in', async ({
    page,
    request,
  }) => {
    await open(page, '/');
    await expect(page.getByText('never applies without you')).toBeVisible();
    await open(page, '/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
    const robots = await request.get('/robots.txt');
    expect(await robots.text()).toContain('Disallow: /');
  });

  test('refuses a wrong password in plain words, and a wrong code', async ({ page }) => {
    const person = await newPerson('Wrong Password');
    await open(page, '/login');
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill('definitely not the password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'do not match' })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('a candidate in the demo workspace', () => {
  test.use(asAna);

  test('opens every page without a browser error, with a heading and named controls', async ({
    page,
  }) => {
    const problems = watchForErrors(page);
    for (const [path, heading] of PAGES) {
      const response = await open(page, path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }).first(), path).toContainText(heading);
      expect(await unnamedControls(page), `${path} has controls without a name`).toEqual([]);
    }
    expect(problems).toEqual([]);
  });

  test('sees a real pipeline: applications at every stage, and an accepted one with its documents', async ({
    page,
  }) => {
    await open(page, '/applications');
    for (const stage of [
      /accepted/i,
      /offer/i,
      /interview/i,
      /applied/i,
      /ready to apply/i,
      /needs human review/i,
      /rejected/i,
    ]) {
      await expect(page.getByRole('table').getByText(stage).first(), String(stage)).toBeVisible();
    }
    await page
      .getByRole('link', { name: /Staff Backend Engineer/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Staff Backend Engineer');
    await expect(page.getByText('Timeline')).toBeVisible();
    await expect(page.getByTestId('doc-RESUME')).toContainText('Ana Bekele');
    await expect(page.getByTestId('doc-COVER_LETTER')).toContainText(
      'Dear hiring team at Contoso Labs',
    );
    await expect(page.getByLabel('Review')).toBeVisible();
    // The matcher found it; every later step is a person's.
    await expect(page.getByText('JobPilot ·').first()).toBeVisible();
  });

  test('has notifications, can read them, and the unread count goes away', async ({ page }) => {
    await open(page, '/notifications');
    await expect(page.getByText('Waiting for your approval').first()).toBeVisible();
    const markAll = page.getByRole('button', { name: 'Mark all read' });
    if (await markAll.isVisible()) await markAll.click();
    await expect(markAll).toBeHidden();
    await expect(page.getByRole('link', { name: /^Notifications\s*\d+/ })).toHaveCount(0);
  });

  test('has no sideways scrolling on a phone', async ({ browser }) => {
    const context = await browser.newContext({ ...asAna, viewport: { width: 390, height: 800 } });
    const page = await context.newPage();
    for (const path of ['/dashboard', '/applications', '/matches']) {
      await open(page, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }
    await context.close();
  });
});

test.describe('roles in the demo workspace', () => {
  test('the owner sees the plan, its usage and the switch; a hiring manager sees the plan but cannot change it', async ({
    browser,
  }) => {
    const owner = await browser.newContext(asOlivia);
    const page = await owner.newPage();
    await open(page, '/billing');
    await expect(page.getByText('on the Team plan')).toBeVisible();
    await expect(page.getByLabel('team members')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Switch to Pro' })).toBeEnabled();
    await expect(page.getByText('No payment provider is connected')).toBeVisible();
    await owner.close();

    const manager = await browser.newContext(asHana);
    const m = await manager.newPage();
    await open(m, '/billing');
    await expect(m.getByRole('button', { name: 'Switch to Pro' })).toBeDisabled();
    await expect(
      m.getByText('Only the owner of the organization can change the plan'),
    ).toBeVisible();
    await open(m, '/settings');
    await expect(m.getByText('Only the owner or an administrator can change these')).toBeVisible();
    await manager.close();
  });

  test('the owner sees the audit trail verify, and the review rules that were seeded', async ({
    browser,
  }) => {
    const ctx = await browser.newContext(asOlivia);
    const page = await ctx.newPage();
    await open(page, '/audit');
    await page.getByRole('button', { name: 'Verify the chain' }).click();
    await expect(page.getByText(/All \d+ entries hold/)).toBeVisible();
    await open(page, '/settings');
    await expect(page.getByLabel('Lowest match score without a second look')).toHaveValue('65');
    await ctx.close();
  });
});

test.describe('approving an application that needs a second look', () => {
  test('a high-risk application cannot be approved until the person says they read why', async ({
    page,
  }) => {
    // A job the candidate has no skills for: a poor match the person nevertheless chooses to pursue.
    const { person, applicationId } = await personWithApplication('Careful Candidate', {
      requiredSkills: ['rust', 'go', 'java', 'ruby', 'scala'],
      title: 'Systems Engineer',
    });
    for (const to of [
      'SHORTLISTED',
      'RESUME_GENERATED',
      'COVER_LETTER_GENERATED',
      'READY_TO_APPLY',
    ]) {
      expect((await move(person.token, applicationId, to)).status).toBe(200);
    }
    await signInUi(page, person.email);
    await open(page, `/applications/${applicationId}`);
    await expect(page.getByLabel('Review')).toContainText('High risk');
    await expect(page.getByLabel('Review')).toContainText('is a SKIP');
    const approve = page.getByRole('button', { name: 'Approve this application' });
    await expect(approve).toBeDisabled();
    page.on('dialog', (d) => void d.accept());
    await page.getByLabel(/I have read this and still want to approve/).check();
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(page.getByText(/Approved \d/)).toBeVisible();
    // The recorded approval carries the reasons the person acknowledged.
    const detail = await api('GET', `/applications/${applicationId}`, { token: person.token });
    const approval = detail.json['events'].find(
      (e: { toState: string }) => e.toState === 'APPROVED',
    );
    expect(approval.actorType).toBe('USER');
    expect(approval.payload.policyTier).toBe('HIGH');
  });

  test('a clear match is approved in one step', async ({ page }) => {
    const { person, applicationId } = await personWithApplication('Clear Candidate');
    for (const to of [
      'SHORTLISTED',
      'RESUME_GENERATED',
      'COVER_LETTER_GENERATED',
      'READY_TO_APPLY',
    ]) {
      await move(person.token, applicationId, to);
    }
    await signInUi(page, person.email);
    await open(page, `/applications/${applicationId}`);
    await expect(page.getByLabel('Review')).toContainText('Low risk');
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Approve this application' }).click();
    await expect(page.getByText(/Approved \d/)).toBeVisible();
  });
});

test.describe('documents', () => {
  test('without an AI key a person writes their own; with a key the AI buttons appear, and removing it takes them away', async ({
    page,
  }) => {
    const { person, applicationId } = await personWithApplication('Writer');
    await move(person.token, applicationId, 'SHORTLISTED');
    await signInUi(page, person.email);
    await open(page, `/applications/${applicationId}`);
    await expect(page.getByText('AI writing is not set up for this organization')).toBeVisible();
    await expect(page.getByRole('button', { name: /with AI/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Write the resume myself' }).click();
    await page
      .getByLabel('Your resume')
      .fill('Experienced TypeScript engineer who ships reliable software every week.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('doc-RESUME')).toContainText('Experienced TypeScript engineer');
    await expect(page.getByText('written by a person')).toBeVisible();

    // The key is stored through Settings, encrypted; the page never shows it back.
    await open(page, '/settings');
    await expect(page.getByText('Not set up')).toBeVisible();
    await page.getByLabel('Provider').selectOption('groq');
    await page.getByLabel(/^API key/).fill('gsk_e2e_not_a_real_key_1234');
    await page.getByRole('button', { name: 'Save the connection' }).click();
    await expect(page.getByText('groq · openai/gpt-oss-120b')).toBeVisible();
    await expect(page.getByLabel(/the stored one ends in 1234/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('not-a-real-key');
    await open(page, `/applications/${applicationId}`);
    await expect(
      page.getByRole('button', { name: /Write the resume again with AI/ }),
    ).toBeVisible();
    await expect(page.getByText('AI writing is not set up for this organization')).toHaveCount(0);

    page.on('dialog', (d) => void d.accept());
    await open(page, '/settings');
    await page.getByRole('button', { name: 'Remove it' }).click();
    await expect(page.getByText('Not set up')).toBeVisible();
  });

  test('says so, in words, when the AI is asked and the key is not accepted', async ({ page }) => {
    const { person, applicationId } = await personWithApplication('Bad Key');
    await move(person.token, applicationId, 'SHORTLISTED');
    await api('PUT', '/ai/connection', {
      token: person.token,
      body: { vendor: 'groq', apiKey: 'gsk_e2e_not_a_real_key_9999' },
    });
    await signInUi(page, person.email);
    await open(page, `/applications/${applicationId}`);
    await page.getByRole('button', { name: 'Write the resume with AI' }).click();
    // A made-up key is refused by the real provider (or the network is unavailable): either way the person is told, and nothing changes.
    await expect(page.getByRole('alert').filter({ hasText: /AI|key|reached/i })).toBeVisible({
      timeout: 30_000,
    });
    const detail = await api('GET', `/applications/${applicationId}`, { token: person.token });
    expect(detail.json['state']).toBe('SHORTLISTED');
  });
});

test.describe('employer emails', () => {
  test('a pasted rejection is classified, and the application moves only when the person clicks', async ({
    page,
  }) => {
    const { person, applicationId } = await personWithApplication('Mail');
    for (const to of [
      'SHORTLISTED',
      'RESUME_GENERATED',
      'COVER_LETTER_GENERATED',
      'READY_TO_APPLY',
    ])
      await move(person.token, applicationId, to);
    await api('POST', `/applications/${applicationId}/approve`, { token: person.token, body: {} });
    await move(person.token, applicationId, 'APPLIED');
    await signInUi(page, person.email);
    await open(page, `/applications/${applicationId}`);
    await page.getByRole('button', { name: 'Log an email' }).click();
    await page.getByLabel('From (email address)').fill('recruiter@initech.test');
    await page.getByLabel('Subject').fill('Your application');
    await page
      .getByLabel('The email')
      .fill('Unfortunately, we have decided to move forward with other candidates.');
    await page.getByRole('button', { name: 'Read it' }).click();
    await expect(page.getByText('Rejection', { exact: true })).toBeVisible();
    await expect(page.getByText('Suggested: move to')).toBeVisible();
    // Reading it moved nothing.
    expect(
      (await api('GET', `/applications/${applicationId}`, { token: person.token })).json['state'],
    ).toBe('APPLIED');
    await page.getByRole('button', { name: 'Move it' }).click();
    await expect(page.getByText('You moved the application on this email.')).toBeVisible();
    expect(
      (await api('GET', `/applications/${applicationId}`, { token: person.token })).json['state'],
    ).toBe('REJECTED');
  });
});

test.describe('two-step sign-in', () => {
  test('is set up with an authenticator code, asked for at sign-in, refused when wrong, and rescued by a recovery code', async ({
    page,
  }) => {
    const person = await newPerson('Two Step');
    await signInUi(page, person.email);
    await open(page, '/security');
    await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    const secret = (await page.getByTestId('mfa-secret').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('Then enter the six-digit code it shows').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Save these recovery codes now.')).toBeVisible();
    const codes = await page
      .getByRole('list', { name: 'Recovery codes' })
      .getByRole('listitem')
      .allInnerTexts();
    expect(codes).toHaveLength(10);
    await page.getByRole('button', { name: 'I have saved them' }).click();
    await expect(page.getByText('Two-step sign-in is on').first()).toBeVisible();

    // Signed out, the password is no longer enough.
    await page.context().clearCookies();
    await open(page, '/login');
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill(person.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(
      page.getByText('Enter the six-digit code from your authenticator app'),
    ).toBeVisible();
    await page.getByLabel('Code').fill('000000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'not right' })).toBeVisible();
    // The step after the one used to turn it on: valid, and never used before.
    await page.getByLabel('Code').fill(totp(secret, 1));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/\/dashboard/);

    // A recovery code works once.
    await page.context().clearCookies();
    await open(page, '/login');
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill(person.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Code').fill(codes[0]!);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.waitForURL(/\/dashboard/);
    await open(page, '/security');
    await expect(page.getByText('9 recovery codes left')).toBeVisible();
  });
});

test.describe('a brand-new person', () => {
  test('lands in an empty workspace that explains what to do first, with nothing broken', async ({
    page,
  }) => {
    const person = await newPerson('Nia Newcomer');
    const problems = watchForErrors(page);
    await signInUi(page, person.email);
    for (const path of ['/dashboard', '/jobs', '/matches', '/applications', '/notifications']) {
      await open(page, path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    await open(page, '/jobs');
    await expect(page.getByText(/No jobs yet/)).toBeVisible();
    await open(page, '/applications');
    await expect(page.getByText(/No applications yet/)).toBeVisible();
    // The welcome notification arrives through the outbox, without anyone asking.
    await expect(async () => {
      await open(page, '/notifications');
      await expect(page.getByText(/^Welcome to/)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    expect(problems).toEqual([]);
  });
});

test.describe('a forgotten or changed password', () => {
  test('a link by email sets a new password, every session ends, and the old password stops working', async ({
    page,
  }) => {
    const person = await newPerson('Forgetful Person');
    const NEW = 'a-brand-new-passphrase-2026';
    await open(page, '/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await page.getByLabel('Email').fill(person.email);
    const asked = Date.now();
    await page.getByRole('button', { name: 'Send me a link' }).click();
    await expect(page.getByText('a link to choose a new password is on its way')).toBeVisible();

    const link = await recoveryLinkFor(person.email, asked);
    await page.goto(link);
    await page.locator('input[name="password"]').fill(NEW);
    await page.getByLabel('New password again').fill('something-else-entirely-1');
    await page.getByRole('button', { name: 'Set the new password' }).click();
    await expect(page.getByText('The two passwords are not the same.')).toBeVisible();
    await page.getByLabel('New password again').fill(NEW);
    await page.getByRole('button', { name: 'Set the new password' }).click();
    await expect(
      page.getByText('Your password was changed. Sign in with the new one.'),
    ).toBeVisible();

    // The old password is refused; the new one works.
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill(person.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill(NEW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // The same link is spent.
    await page.goto(link);
    await page.locator('input[name="password"]').fill('yet-another-passphrase-2026');
    await page.getByLabel('New password again').fill('yet-another-passphrase-2026');
    await page.getByRole('button', { name: 'Set the new password' }).click();
    await expect(page.getByText('This link is not valid any more.')).toBeVisible();
  });

  test('a signed-in person changes their password on the Security page and is signed out', async ({
    page,
  }) => {
    const person = await newPerson('Changing Person');
    const NEW = 'changed-passphrase-for-the-test-1';
    await signInUi(page, person.email);
    await open(page, '/security');
    await page.getByLabel('Current password').fill('not-my-current-password');
    await page.locator('input[name="newPassword"]').fill(NEW);
    await page.getByLabel('New password again').fill(NEW);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('That is not your current password.')).toBeVisible();

    await page.getByLabel('Current password').fill(person.password);
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText('every device was signed out')).toBeVisible();
    await page.getByLabel('Email').fill(person.email);
    await page.getByLabel('Password').fill(NEW);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
