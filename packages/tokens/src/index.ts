/**
 * Design tokens — single source of truth for web (CSS variables) and, later,
 * the React Native app (theme object). See claude/design-direction.md.
 */
export const colors = {
  light: {
    bg: '#F6F5F1',
    surface: '#FFFFFF',
    border: '#E4E2DC',
    text: '#1D1F1E',
    textMuted: '#5D625F',
    accent: '#2F6B5F',
    accentText: '#FFFFFF',
    accentSoft: '#E3EEEA',
    alert: '#B4472F',
    alertText: '#FFFFFF',
    focus: '#2F6B5F',
    priorityHigh: '#B4472F',
    priorityMedium: '#A0710F',
    priorityLow: '#7A7F7C',
    statusTodoBg: '#EFEEE9',
    statusProgressBg: '#E5EBF2',
    statusDoneBg: '#E3EEEA',
    statusText: '#1D1F1E',
    overlay: 'rgba(20, 22, 21, 0.45)',
  },
  dark: {
    bg: '#141615',
    surface: '#1E2120',
    border: '#2F3432',
    text: '#ECEDEA',
    textMuted: '#A8AEAA',
    accent: '#86C5B5',
    accentText: '#0F2420',
    accentSoft: '#20342F',
    alert: '#EE9479',
    alertText: '#2A0F08',
    focus: '#86C5B5',
    priorityHigh: '#EE9479',
    priorityMedium: '#E0B04A',
    priorityLow: '#8D938F',
    statusTodoBg: '#2A2E2C',
    statusProgressBg: '#2F4865',
    statusDoneBg: '#24554B',
    statusText: '#ECEDEA',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
} as const;

export type ThemeName = keyof typeof colors;
export type ColorToken = keyof (typeof colors)['light'];

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const radius = { input: 12, card: 16, full: 9999 } as const;
export const touchTarget = 44;

/** font-size / line-height in px */
export const type = {
  screenTitle: { size: 26, line: 32, weight: 600 },
  section: { size: 20, line: 28, weight: 600 },
  taskTitle: { size: 15, line: 22, weight: 500 },
  body: { size: 15, line: 22, weight: 400 },
  meta: { size: 12.5, line: 18, weight: 400 },
} as const;

export const fontFamily =
  "Inter, 'Noto Sans Devanagari', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Pairs that must meet WCAG AA contrast (checked in tests). [foreground, background, minRatio] */
export const contrastPairs: Array<[ColorToken, ColorToken, number]> = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['textMuted', 'bg', 4.5],
  ['textMuted', 'surface', 4.5],
  ['accentText', 'accent', 4.5],
  ['accent', 'surface', 4.5],
  ['accent', 'bg', 4.5],
  ['alert', 'surface', 4.5],
  ['alertText', 'alert', 4.5],
  ['statusText', 'statusTodoBg', 4.5],
  ['statusText', 'statusProgressBg', 4.5],
  ['statusText', 'statusDoneBg', 4.5],
  ['priorityHigh', 'surface', 3],
  ['priorityMedium', 'surface', 3],
  ['priorityLow', 'surface', 3],
  ['focus', 'bg', 3],
  ['focus', 'surface', 3],
];

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function themeVars(theme: ThemeName): string {
  return Object.entries(colors[theme])
    .map(([k, v]) => `  --color-${kebab(k)}: ${v};`)
    .join('\n');
}

function staticVars(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(space)) lines.push(`  --space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(radius)) lines.push(`  --radius-${k}: ${v}px;`);
  lines.push(`  --touch-target: ${touchTarget}px;`);
  for (const [k, v] of Object.entries(type)) {
    lines.push(`  --font-${kebab(k)}-size: ${v.size / 16}rem;`);
    lines.push(`  --font-${kebab(k)}-line: ${v.line / 16}rem;`);
    lines.push(`  --font-${kebab(k)}-weight: ${v.weight};`);
  }
  lines.push(`  --font-family: ${fontFamily};`);
  return lines.join('\n');
}

/** Generates the CSS file consumed by the web app. Theme is chosen via [data-theme] on <html>. */
export function toCss(): string {
  return `/* Generated from packages/tokens/src/index.ts — do not edit by hand. Run: pnpm --filter @todo/tokens build:css */
:root {
${staticVars()}
}

:root,
[data-theme='light'] {
  color-scheme: light;
${themeVars('light')}
}

[data-theme='dark'] {
  color-scheme: dark;
${themeVars('dark')}
}

@media (prefers-color-scheme: dark) {
  [data-theme='system'] {
    color-scheme: dark;
${themeVars('dark').replace(/^ {2}/gm, '    ')}
  }
}
`;
}

/** WCAG relative luminance contrast ratio for #RRGGBB colours. */
export function contrastRatio(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
    const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [
      number,
      number,
      number,
    ];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [lum(fg), lum(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
