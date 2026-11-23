import { expect, test } from '@playwright/test';
import { PASSWORD, expectAccessible, signUpByEmail } from './helpers';

test('Hindi, dark theme, and both stay accessible', async ({ page }) => {
  await signUpByEmail(page);
  await page.goto('/settings');
  await expectAccessible(page);
  await page.getByRole('button', { name: /Language/ }).click();
  await page.getByRole('option', { name: 'हिन्दी' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('सेटिंग्स');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.getByRole('radio', { name: 'गहरी' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectAccessible(page);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('सेटिंग्स');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/today');
  await expect(page.getByText('आज कुछ बाकी नहीं')).toBeVisible();
  await expectAccessible(page);
});

test('legal pages are reachable and accessible', async ({ page }) => {
  for (const p of ['terms', 'privacy', 'grievance']) {
    await page.goto(`/legal/${p}`);
    await expect(page.getByRole('note')).toContainText('Draft');
    await expectAccessible(page);
  }
});

test('export data and delete account', async ({ page }) => {
  const email = await signUpByEmail(page);
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  expect((await download).suggestedFilename()).toMatch(/^todo-export-.*\.json$/);

  await page.getByRole('button', { name: 'Delete my account' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByLabel('Your password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByText('Your account has been deleted.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText("That email or phone and password don't match.")).toBeVisible();
});
