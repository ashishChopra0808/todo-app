import type { Theme } from '@todo/shared';

/** Sets [data-theme] on <html>; tokens.css switches the CSS variables. Saved per device, and per user via the API. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#141615' : '#F6F5F1'));
  try {
    localStorage.setItem('todo.theme', theme);
  } catch {
    /* ignore */
  }
}
