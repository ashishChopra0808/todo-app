import { describe, expect, it } from 'vitest';
import { cleanLine, cleanText } from './text';

describe('cleanText', () => {
  it('removes control characters and text-direction overrides', () => {
    expect(cleanText('pay‮evil‬ bill\u0000')).toBe('payevil bill');
    expect(cleanText('⁦a⁩b')).toBe('ab');
  });
  it('keeps what real text needs: Hindi joiners, emoji, newlines, RTL marks', () => {
    const hindi = 'क्‍ष दूध'; // ZWJ inside a conjunct
    expect(cleanText(hindi)).toBe(hindi);
    expect(cleanText('👩‍👩‍👧 family')).toBe('👩‍👩‍👧 family');
    expect(cleanText('line 1\nline 2')).toBe('line 1\nline 2');
    expect(cleanText('שלום‏!')).toBe('שלום‏!');
  });
  it('cleanLine collapses whitespace too', () => {
    expect(cleanLine('  a \n\t b‮ ')).toBe('a b');
  });
});
