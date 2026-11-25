import { expect, test } from '@playwright/test';
import { expectAccessible, signUpByEmail } from './helpers';

test('create a task, complete it, undo, edit, see activity and delete', async ({ page }) => {
  await signUpByEmail(page);
  await page.getByRole('link', { name: 'New task' }).first().click();
  await expect(page).toHaveURL(/\/tasks\/new/);
  await expectAccessible(page);

  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('This is required.')).toBeVisible();

  await page.getByLabel('Task title').fill('Pay electricity bill');
  await page.getByRole('radio', { name: 'Today' }).check();
  await page.getByRole('button', { name: '+ Add a time' }).click();
  await page.getByLabel('Time').fill('23:59');
  await page.getByRole('radio', { name: 'High' }).check();
  await page.getByRole('button', { name: 'Add task' }).click();

  await expect(page).toHaveURL(/\/today/);
  const row = page
    .getByRole('main')
    .getByRole('listitem')
    .filter({ hasText: 'Pay electricity bill' });
  await expect(row).toContainText('Today, 11:59');
  await expect(row).toContainText('High');
  await expectAccessible(page);

  await row.getByRole('button', { name: 'Mark as done: Pay electricity bill' }).click();
  await expect(
    page.getByRole('button', { name: 'Mark as not done: Pay electricity bill' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Done today' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as not done: Pay electricity bill' }).click();
  await expect(
    page.getByRole('button', { name: 'Mark as done: Pay electricity bill' }),
  ).toHaveAttribute('aria-pressed', 'false');

  // Phones open the task page; wide screens open the side panel. Both show the same details.
  await page.getByRole('link', { name: /Pay electricity bill/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Pay electricity bill', exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Task title').fill('Pay electricity bill online');
  await page.getByRole('radio', { name: 'In progress' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Pay electricity bill online', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('You renamed it to “Pay electricity bill online”')).toBeVisible();
  await expect(page.getByText('You marked it In progress')).toBeVisible();

  await page.getByRole('button', { name: 'Delete task' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('No open tasks')).toBeVisible();
});

test('search and filter tasks', async ({ page }) => {
  await signUpByEmail(page);
  for (const [title, prio] of [
    ['Book train tickets', 'High'],
    ['Buy milk', 'Low'],
    ['Call plumber', 'Medium'],
  ] as const) {
    await page.goto('/tasks/new');
    await page.getByLabel('Task title').fill(title);
    await page.getByRole('radio', { name: prio }).check();
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(page).not.toHaveURL(/\/new/);
  }
  await page.goto('/tasks');
  const rows = page.getByRole('main').getByRole('listitem');
  await expect(rows).toHaveCount(3);
  // Ticking a task on the paged Tasks list works and it leaves "My tasks".
  await rows
    .filter({ hasText: 'Call plumber' })
    .getByRole('button', { name: /Mark as done/ })
    .click();
  await expect(page.getByRole('button', { name: 'Mark as not done: Call plumber' })).toBeVisible();
  await page.reload();
  await expect(rows).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('milk');
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/q=milk/);
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('checkbox', { name: 'High' }).check();
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Book train tickets');
  await expectAccessible(page);
});

test('desktop: tasks open in a side panel; Escape closes it and returns focus', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'side panel is a wide-screen layout');
  await signUpByEmail(page);
  await page.goto('/tasks/new');
  await page.getByLabel('Task title').fill('Renew car insurance');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page).not.toHaveURL(/\/new/);
  await page.goto('/tasks');
  const link = page.getByRole('link', { name: /Renew car insurance/ });
  await link.click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
  await expect(page).toHaveURL(/task=/);
  await expectAccessible(page);
  await panel.getByRole('radio', { name: 'In progress' }).check();
  await expect(panel.getByText('You marked it In progress')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(link).toBeFocused();
});

test('editing in two places: the second save keeps its changes and asks to save again', async ({
  page,
  context,
}) => {
  await signUpByEmail(page);
  await page.getByRole('link', { name: 'New task' }).first().click();
  await page.getByLabel('Task title').fill('Plan the trip');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByText('Task added.')).toBeVisible();
  await page.goto('/tasks');
  await page.getByRole('link', { name: /Plan the trip/ }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  const editUrl = page.url();

  const other = await context.newPage();
  await other.goto(editUrl);
  await other.getByLabel('Task title').fill('Plan the trip to Goa');
  await other.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    other.getByRole('heading', { name: 'Plan the trip to Goa', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Task title').fill('Plan the trip to Kerala');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByText('Someone else changed this task while you were editing.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Changes saved.')).toHaveCount(0);
  await expect(page.getByLabel('Task title')).toHaveValue('Plan the trip to Kerala');

  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Plan the trip to Kerala', exact: true }),
  ).toBeVisible();
});
