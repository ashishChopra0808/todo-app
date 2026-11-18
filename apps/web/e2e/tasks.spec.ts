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
  const row = page.getByRole('listitem').filter({ hasText: 'Pay electricity bill' });
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

  await page.getByRole('link', { name: /Pay electricity bill/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay electricity bill');
  await expectAccessible(page);
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Task title').fill('Pay electricity bill online');
  await page.getByRole('radio', { name: 'In progress' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pay electricity bill online');
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
  await expect(page.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('milk');
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page).toHaveURL(/q=milk/);
  await page.getByRole('searchbox', { name: 'Search tasks' }).fill('');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('checkbox', { name: 'High' }).check();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('listitem')).toContainText('Book train tickets');
  await expectAccessible(page);
});
