import { expect, test } from '@playwright/test';
import {
  PASSWORD,
  expectAccessible,
  otpFor,
  signUpByEmail,
  uniqueEmail,
  uniquePhone,
} from './helpers';

test('sign-up by email with OTP lands on Today', async ({ page }) => {
  await page.goto('/sign-up');
  await expectAccessible(page);
  await signUpByEmail(page, uniqueEmail('signup'), 'Asha Verma');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Asha');
  await expect(page.getByText('Nothing due today')).toBeVisible();
  await expectAccessible(page);
});

test('sign-up by phone with SMS OTP', async ({ page }) => {
  const phone = uniquePhone();
  await page.goto('/sign-up');
  await page.getByRole('radio', { name: 'Phone' }).check();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Ravi Kumar');
  await page.getByRole('textbox', { name: 'Mobile number' }).fill(phone.replace('+91', ''));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify/);
  // The email or phone number never goes in the address (history, error reports, analytics).
  expect(decodeURIComponent(page.url())).not.toMatch(/target=|@|\+91/);
  await expectAccessible(page);
  await page.getByLabel('6-digit code').fill(await otpFor(phone));
  await expect(page).toHaveURL(/\/today/);
});

test('shows friendly errors: consent, wrong password', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Your name' }).fill('X');
  await page.getByRole('textbox', { name: 'Email' }).fill('x@example.com');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Please accept the terms to continue.')).toBeVisible();

  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Email' }).fill('nobody@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password-1');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText("That email or phone and password don't match.")).toBeVisible();
});

test('forgot password by email, then log in with the new one', async ({ page }) => {
  const email = await signUpByEmail(page, uniqueEmail('reset'));
  await page.context().clearCookies();
  await page.goto('/forgot');
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  // The sign-up code was sent moments ago; wait out nothing — reset uses its own code type.
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page).toHaveURL(/\/reset/);
  expect(decodeURIComponent(page.url())).not.toMatch(/target=|@|\+91/);
  const code = await otpFor(email);
  await page.getByLabel('6-digit code').fill(code);
  await page.getByLabel('New password', { exact: true }).fill('tiger-lotus-cloud-77');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Password changed.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('tiger-lotus-cloud-77');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/today/);
});

test('signed-out users are sent to sign in', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});

test('sign-in: an empty submit marks each empty box; short legal addresses work', async ({
  page,
}) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Email' }).fill('a@b.co');
  await expect(page.getByRole('textbox', { name: 'Email' })).not.toHaveAttribute(
    'aria-invalid',
    'true',
  );

  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/legal\/privacy$/);
  await expect(page.getByRole('heading', { name: 'Who can see what' })).toBeVisible();
});
