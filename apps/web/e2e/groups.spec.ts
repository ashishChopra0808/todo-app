import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, expectAccessible, signUpAndVerify, signUpByEmail, uniqueEmail } from './helpers';

const isWide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 900;

/** Opens a task from a list: the side panel on wide screens, the task page on phones. */
async function openTask(page: Page, title: string) {
  await page
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('group → invite by link → second person joins → assign → done + comment → report → owner removes', async ({
  page: asha,
  browser,
}, testInfo) => {
  const suffix = testInfo.project.name;
  // Separate browser contexts = separate people (own cookies), same device settings as the project.
  const u = testInfo.project.use;
  const ctxOpts = {
    baseURL: u.baseURL,
    viewport: u.viewport,
    userAgent: u.userAgent,
    deviceScaleFactor: u.deviceScaleFactor,
    isMobile: u.isMobile,
    hasTouch: u.hasTouch,
    locale: u.locale,
    timezoneId: u.timezoneId,
  };
  const ravi = await (await browser.newContext(ctxOpts)).newPage();
  const owner = await (await browser.newContext(ctxOpts)).newPage();

  // 1. Asha creates a group.
  await signUpByEmail(asha, uniqueEmail('asha'), 'Asha Verma');
  await asha.goto('/groups');
  await expect(asha.getByText('No groups yet')).toBeVisible();
  await expectAccessible(asha);
  await asha.getByRole('button', { name: 'Create a group' }).click();
  const dialog = asha.getByRole('dialog');
  await dialog.getByLabel('Group name').fill(`Sharma family ${suffix} weekend chores`);
  await dialog.getByRole('radio', { name: '🏠' }).check();
  await expectAccessible(asha);
  await dialog.getByRole('button', { name: 'Create group' }).click();

  // 2. The invite sheet opens with a fresh link and code.
  const invite = asha.getByRole('dialog', { name: /Invite to Sharma family/ });
  await expect(invite.locator('.invite-code__value')).toHaveText(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  await expectAccessible(asha);
  const code = (await invite.locator('.invite-code__value').textContent())!.replace('-', '');
  await invite.getByRole('button', { name: 'Done' }).click();
  await expect(invite).toBeHidden();
  await expect(asha.getByText('No tasks in this group yet.')).toBeVisible();
  await expectAccessible(asha);

  // 3. Ravi opens the link signed out, creates an account and comes back to join.
  await ravi.goto(`/join/${code}`);
  await expect(ravi.getByText('Asha invited you to join')).toBeVisible();
  await expectAccessible(ravi);
  await ravi.getByRole('link', { name: 'Create an account' }).click();
  await signUpAndVerify(ravi, uniqueEmail('ravi'), 'Ravi Kumar');
  await expect(ravi).toHaveURL(new RegExp(`/join/${code}`));
  await ravi.getByRole('button', { name: 'Join group' }).click();
  await expect(ravi).toHaveURL(/\/groups\/[0-9a-f-]+/);
  await expect(ravi.getByText('2 members')).toBeVisible();

  // 4. Asha adds a task in the group and assigns it to Ravi.
  await asha.reload();
  await asha.getByRole('link', { name: 'Add task' }).first().click();
  await asha.getByLabel('Task title').fill('Buy diyas');
  await expect(asha.getByRole('radio', { name: /Sharma family/ })).toBeChecked();
  await asha.getByRole('radio', { name: 'Ravi Kumar' }).check();
  await expectAccessible(asha);
  await asha.getByRole('button', { name: 'Add task' }).click();
  await expect(asha.getByRole('listitem').filter({ hasText: 'Buy diyas' })).toContainText('');
  await expect(asha.getByRole('img', { name: 'Assigned to Ravi Kumar' })).toBeVisible();

  // 5. Ravi sees it as his, marks it done and comments.
  await ravi.goto('/tasks');
  const row = ravi.getByRole('listitem').filter({ hasText: 'Buy diyas' });
  await expect(row).toContainText(`Sharma family ${suffix}`);
  await expect(ravi.getByRole('img', { name: 'Assigned to you' })).toBeVisible();
  await row.getByRole('button', { name: 'Mark as done: Buy diyas' }).click();
  await expect(row.getByRole('button', { name: 'Mark as not done: Buy diyas' })).toBeVisible();
  await ravi.goto('/tasks?tab=completed');
  await openTask(ravi, 'Buy diyas');
  await ravi.getByLabel('Write a comment').fill('Got 24 of them');
  await ravi.getByRole('button', { name: 'Send' }).click();
  await expect(ravi.getByText('Got 24 of them')).toBeVisible();
  await expectAccessible(ravi);

  // 6. Asha sees it done with the comment, and reports the comment.
  await asha.reload();
  await asha.getByRole('button', { name: /Show done/ }).click();
  await openTask(asha, 'Buy diyas');
  await expect(asha.getByText('Ravi Kumar marked it Done')).toBeVisible();
  await expect(asha.getByText('Got 24 of them')).toBeVisible();
  await asha.getByRole('button', { name: /^Report.*Ravi Kumar/ }).click();
  const report = asha.getByRole('dialog', { name: 'Report this comment' });
  await report.getByRole('button', { name: 'Send report' }).click();
  await expect(report.getByText('Choose a reason.')).toBeVisible();
  await report.getByRole('radio', { name: 'Spam or scam' }).check();
  await expectAccessible(asha);
  await report.getByRole('button', { name: 'Send report' }).click();
  await expect(asha.getByText("Thanks. We'll review it.")).toBeVisible();

  // 7. The owner removes it from the review page; Asha sees the placeholder.
  await signUpByEmail(owner, 'owner@e2e.test', 'App Owner').catch(async () => {
    // Already exists from the other project run: log in instead.
    await owner.goto('/sign-in');
    await owner.getByRole('textbox', { name: 'Email' }).fill('owner@e2e.test');
    await owner.getByLabel('Password', { exact: true }).fill('mango-river-lamp-91');
    await owner.getByRole('button', { name: 'Log in' }).click();
    await expect(owner).toHaveURL(/\/today/);
  });
  await owner.goto('/admin');
  await owner
    .getByRole('link', { name: /Comment · Spam or scam/ })
    .first()
    .click();
  await expect(owner.getByText('body: Got 24 of them').first()).toBeVisible();
  await expectAccessible(owner);
  await owner.getByRole('button', { name: 'Remove content' }).click();
  await expect(owner.getByText('Report closed.')).toBeVisible();

  await asha.reload();
  if (!isWide(asha)) await expect(asha.getByRole('heading', { name: 'Buy diyas' })).toBeVisible();
  await expect(asha.getByText('Removed by a moderator')).toBeVisible();
  await expect(asha.getByText('Got 24 of them')).toHaveCount(0);

  // 8. Group settings: members and roles.
  await asha.goto('/groups');
  await asha
    .getByRole('link', { name: /Sharma family/ })
    .first()
    .click();
  // Nothing on the group page may be wider than the screen (a long name once pushed the
  // settings button off the edge on phones).
  expect(
    await asha.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  await asha.getByRole('link', { name: 'Group settings' }).click();
  await expect(asha.getByText('Ravi Kumar', { exact: true })).toBeVisible();
  await expectAccessible(asha);
  await asha.getByRole('button', { name: 'Make admin: Ravi Kumar' }).click();
  await expect(asha.getByText('Role updated.')).toBeVisible();
});

test('a non-owner sees "page not found" on /admin', async ({ page }) => {
  await signUpByEmail(page);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('an invalid invite code explains what to do', async ({ page }) => {
  await page.goto('/join/ZZZZZZZZZZ');
  await expect(page.getByText("We couldn't find it. Check the link or code.")).toBeVisible();
  await expectAccessible(page);
});

test('group screens in Hindi and the dark theme stay accessible', async ({ page }) => {
  await signUpByEmail(page);
  await page.goto('/settings');
  await page.getByRole('button', { name: /Language/ }).click();
  await page.getByRole('option', { name: 'हिन्दी' }).click();
  await page.getByRole('radio', { name: 'गहरी' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/groups');
  await expect(page.getByText('अभी कोई समूह नहीं')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'समूह बनाएँ' }).click();
  await page.getByRole('dialog').getByLabel('समूह का नाम').fill('शर्मा परिवार');
  await page.getByRole('dialog').getByRole('button', { name: 'समूह बनाएँ' }).click();
  await expect(page.getByRole('dialog', { name: /शर्मा परिवार में बुलाएँ/ })).toBeVisible();
  await expect(page.locator('.invite-code__value')).toHaveText(/-/);
  await expectAccessible(page);
  await page.getByRole('dialog').getByRole('button', { name: 'हो गया' }).click();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'समूह की सेटिंग्स' }).click();
  await expect(page.getByRole('heading', { name: 'समूह की सेटिंग्स' })).toBeVisible();
  await expectAccessible(page);
});

test('existing account logs in from an invite, even when the browser autofills the boxes', async ({
  page,
  browser,
}, testInfo) => {
  await signUpByEmail(page, uniqueEmail('a'), 'Asha Verma');
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Create a group' }).click();
  await page.getByRole('dialog').getByLabel('Group name').fill('Home');
  await page.getByRole('dialog').getByRole('button', { name: 'Create group' }).click();
  const code = (await page.locator('.invite-code__value').textContent())!.replace('-', '');

  const u = testInfo.project.use;
  const ravi = await (
    await browser.newContext({ baseURL: u.baseURL, viewport: u.viewport, isMobile: u.isMobile })
  ).newPage();
  const email = uniqueEmail('ravi');
  await signUpByEmail(ravi, email, 'Ravi Kumar');
  await ravi.context().clearCookies();

  await ravi.goto(`/join/${code}`);
  await ravi.getByRole('link', { name: 'Log in' }).click();
  // Like iPhone Keychain/Chrome autofill: the values appear without input events.
  await ravi.evaluate(
    ({ e, p }) => {
      (document.querySelector('input[name="email"]') as HTMLInputElement).value = e;
      (document.querySelector('input[name="password"]') as HTMLInputElement).value = p;
    },
    { e: email, p: PASSWORD },
  );
  await ravi.getByRole('button', { name: 'Log in' }).click();
  await expect(ravi).toHaveURL(new RegExp(`/join/${code}`));
  await expect(ravi.getByRole('link', { name: 'Log in' })).toHaveCount(0);
  await ravi.getByRole('button', { name: 'Join group' }).click();
  await expect(ravi).toHaveURL(/\/groups\/[0-9a-f-]+$/);
  await expect(ravi.getByText('2 members')).toBeVisible();
});
