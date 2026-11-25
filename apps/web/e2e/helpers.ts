import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTBOX = fileURLToPath(new URL('./.outbox', import.meta.url));
export const PASSWORD = 'mango-river-lamp-91';

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
export const uniquePhone = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Polls the file outbox for the newest code sent to an email or phone. */
export async function otpFor(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const files = readdirSync(OUTBOX).sort().reverse();
    for (const f of files) {
      const m = JSON.parse(readFileSync(join(OUTBOX, f), 'utf8')) as {
        to: string;
        text: string;
        code?: string;
      };
      if (m.to === to) {
        const code = m.code ?? m.text.match(/\b(\d{6})\b/)?.[1];
        if (code) return code;
      }
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no OTP for ${to}`);
}

/** WCAG 2.2 AA checks with axe. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(summary, summary.join('\n')).toEqual([]);
}

export async function signUpByEmail(page: Page, email = uniqueEmail('user'), name = 'Asha Verma') {
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify/);
  // The email or phone number never goes in the address (history, error reports, analytics).
  expect(decodeURIComponent(page.url())).not.toMatch(/target=|@|\+91/);
  await page.getByLabel('6-digit code').fill(await otpFor(email));
  await expect(page).toHaveURL(/\/today/);
  return email;
}

/** Sign-up that doesn't assume where the app lands afterwards (e.g. back on an invite). */
export async function signUpAndVerify(page: Page, email: string, name: string) {
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify/);
  // The email or phone number never goes in the address (history, error reports, analytics).
  expect(decodeURIComponent(page.url())).not.toMatch(/target=|@|\+91/);
  await page.getByLabel('6-digit code').fill(await otpFor(email));
}
