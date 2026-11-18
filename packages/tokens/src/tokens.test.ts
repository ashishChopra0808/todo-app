import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colors, contrastPairs, contrastRatio, toCss } from './index';

describe('design tokens', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [fg, bg, min] of contrastPairs) {
      it(`${theme}: ${fg} on ${bg} has contrast >= ${min}`, () => {
        expect(contrastRatio(colors[theme][fg], colors[theme][bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('tokens.css is in sync with the source (run build:css)', () => {
    const file = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
    expect(file).toBe(toCss());
  });
});
