import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { expectAccessible, signUpByEmail, uniqueEmail } from './helpers';

/** Same-origin API calls with the page's cookies (for quick setup; the UI is tested elsewhere). */
async function api(page: Page, method: 'POST' | 'PATCH' | 'GET', url: string, data?: unknown) {
  const res = await page.request.fetch(url, {
    method,
    data,
    headers: { origin: 'http://localhost:5180' },
  });
  expect(res.ok(), `${method} ${url}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.status() === 204 ? null : res.json();
}

async function twoPeople(page: Page, browser: Browser, info: TestInfo) {
  await signUpByEmail(page, uniqueEmail('asha'), 'Asha Verma');
  const u = info.project.use;
  const ravi = await (
    await browser.newContext({
      baseURL: u.baseURL,
      viewport: u.viewport,
      isMobile: u.isMobile,
      hasTouch: u.hasTouch,
      locale: u.locale,
      timezoneId: u.timezoneId,
      permissions: ['microphone'],
    })
  ).newPage();
  await signUpByEmail(ravi, uniqueEmail('ravi'), 'Ravi Kumar');
  const g = await api(page, 'POST', '/api/v1/groups', { name: 'Home', icon: '🏠' });
  const inv = await api(page, 'POST', `/api/v1/groups/${g.id}/invites`, { channel: 'link' });
  await api(ravi, 'POST', `/api/v1/invites/${inv.code}/accept`);
  const raviId = (await api(ravi, 'GET', '/api/v1/me')).id as string;
  return { ravi, groupId: g.id as string, raviId };
}

test('voice task: record, listen, keep the title, save, play it back', async ({ page }) => {
  await signUpByEmail(page);
  await page.goto('/tasks/voice');
  await expect(page.getByRole('heading', { name: 'Voice task' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('audio')).toHaveCount(1);
  await page.getByRole('button', { name: 'Use this recording' }).click();
  const title = page.getByLabel('Title');
  await expect(title).toHaveValue(/^Voice task · /);
  await title.fill('Call the electrician');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save voice task' }).click();
  await expect(page).not.toHaveURL(/\/tasks\/voice/);

  await page.goto('/tasks');
  await page
    .getByRole('link', { name: /Call the electrician/ })
    .first()
    .click();
  const audio = page.locator('audio');
  await expect(audio).toHaveCount(1);
  expect(await audio.getAttribute('src')).toMatch(/\/api\//);
  await expect(page.getByText(/^Voice note/)).toBeVisible();
});

test('notifications: assign → bell badge → inbox → open task; settings toggles stick', async ({
  page,
  browser,
}, info) => {
  const { ravi, groupId, raviId } = await twoPeople(page, browser, info);
  await api(page, 'POST', '/api/v1/tasks', { title: 'Buy diyas', groupId, assigneeId: raviId });

  await ravi.goto('/today');
  await expect(ravi.getByRole('link', { name: /Inbox/ }).first()).toContainText('1');
  await ravi.goto('/inbox');
  await expect(ravi.getByText('Asha Verma gave you “Buy diyas”')).toBeVisible();
  await expectAccessible(ravi);
  await ravi.getByRole('link', { name: /gave you “Buy diyas”/ }).click();
  await expect(ravi.getByRole('heading', { name: 'Buy diyas' })).toBeVisible();
  await ravi.goto('/inbox');
  await expect(ravi.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);

  await ravi.goto('/settings');
  const box = ravi.getByRole('checkbox', { name: 'I’m given a task: Email' });
  await expect(box).toBeChecked();
  await box.click();
  await expect(box).not.toBeChecked();
  await expectAccessible(ravi);
  await ravi.reload();
  await expect(ravi.getByRole('checkbox', { name: 'I’m given a task: Email' })).not.toBeChecked();
});

test('offline: tick done and add a task offline, see "waiting to sync", then it syncs', async ({
  page,
  context,
}) => {
  await signUpByEmail(page);
  await api(page, 'POST', '/api/v1/tasks', { title: 'Water plants' });
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /Water plants/ })).toBeVisible();
  // Offline screens come from the service worker's cache: wait until it's in charge.
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
  );

  await context.setOffline(true);
  await expect(page.getByText('You’re offline.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as done: Water plants' }).click();
  await expect(page.getByText('Waiting to sync')).toBeVisible();
  await expect(page.getByText(/1 change will sync/)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('link', { name: 'New task' }).first().click();
  await page.getByLabel('Task title').fill('Buy bulbs');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Saved on this device.', { exact: false })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText('Waiting to sync')).toHaveCount(0, { timeout: 15_000 });
  const done = await api(page, 'GET', '/api/v1/tasks?view=completed');
  expect(done.items.map((t: { title: string }) => t.title)).toContain('Water plants');
  const open = await api(page, 'GET', '/api/v1/tasks?view=mine');
  expect(open.items.map((t: { title: string }) => t.title)).toContain('Buy bulbs');
});

test('simple mode: big home, speak to someone, they get it as a task', async ({
  page,
  browser,
}, info) => {
  const { ravi } = await twoPeople(page, browser, info);
  await ravi.goto('/settings');
  await ravi.getByRole('button', { name: 'Turn on Simple mode' }).click();
  await expect(ravi).toHaveURL(/\/simple$/);
  await expect(ravi.getByRole('heading', { name: 'Hello, Ravi' })).toBeVisible();
  await expect(ravi.getByRole('button', { name: 'Hear' })).toBeVisible();
  await expect(ravi.getByRole('navigation')).toHaveCount(0); // no bottom nav or sidebar
  await expectAccessible(ravi);

  await ravi.getByRole('link', { name: /Asha Verma/ }).click();
  await ravi.getByRole('button', { name: 'Speak to Asha Verma' }).click();
  await expect(ravi.getByRole('button', { name: 'Stop' })).toBeVisible(); // starts by itself
  await ravi.waitForTimeout(1200);
  await ravi.getByRole('button', { name: 'Stop' }).click();
  await ravi.getByRole('button', { name: 'Send' }).click();
  await expect(ravi.getByText('Sent to Asha Verma')).toBeVisible();
  await expectAccessible(ravi);

  // Asha (full app) gets it as a voice task assigned to her.
  await page.goto('/inbox');
  await expect(page.getByText(/Ravi Kumar gave you “Voice message/)).toBeVisible();
  // Any other page sends a Simple mode user back to Simple mode.
  await ravi.goto('/tasks');
  await expect(ravi).toHaveURL(/\/simple$/);
});

test('offline: reopening the app with no connection shows the saved tasks, not an error', async ({
  page,
  context,
}) => {
  await signUpByEmail(page);
  await api(page, 'POST', '/api/v1/tasks', { title: 'Seen while online' });
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /Seen while online/ })).toBeVisible();
  // Let the service worker take over and the list be saved on the device.
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
  );
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  for (const path of ['/tasks', '/today', '/']) {
    await page.goto(path);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.getByText('You’re offline.', { exact: false })).toBeVisible();
  }
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /Seen while online/ })).toBeVisible();
  await context.setOffline(false);
});
