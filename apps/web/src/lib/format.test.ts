import i18n from 'i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { resources } from '@todo/i18n';
import { formatDue, greetingKey } from './format';

beforeAll(async () => {
  await i18n.init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
});

const IST = 'Asia/Kolkata';

describe('formatDue', () => {
  it('labels today, tomorrow, yesterday and other dates in the user time zone', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T06:30:00Z')); // 12:00 IST
    const t = i18n.t.bind(i18n);
    expect(
      formatDue(
        { dueAt: '2026-11-18T09:30:00.000Z', dueHasTime: true, status: 'todo' },
        IST,
        'en-IN',
        t,
      ).label,
    ).toMatch(/^Today, 3:00/);
    expect(
      formatDue(
        { dueAt: '2026-11-19T00:00:00.000Z', dueHasTime: false, status: 'todo' },
        IST,
        'en-IN',
        t,
      ).label,
    ).toBe('Tomorrow');
    const y = formatDue(
      { dueAt: '2026-11-17T00:00:00.000Z', dueHasTime: false, status: 'todo' },
      IST,
      'en-IN',
      t,
    );
    expect(y).toEqual({ label: 'Yesterday', overdue: true });
    expect(
      formatDue(
        { dueAt: '2026-12-25T00:00:00.000Z', dueHasTime: false, status: 'todo' },
        IST,
        'en-IN',
        t,
      ).label,
    ).toBe('25 Dec');
    expect(
      formatDue({ dueAt: null, dueHasTime: false, status: 'todo' }, IST, 'en-IN', t).label,
    ).toBe('No due date');
    vi.useRealTimers();
  });

  it('uses Hindi labels and digits from Intl', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T06:30:00Z'));
    await i18n.changeLanguage('hi');
    const label = formatDue(
      { dueAt: '2026-11-18T00:00:00.000Z', dueHasTime: false, status: 'todo' },
      IST,
      'hi-IN',
      i18n.t.bind(i18n),
    ).label;
    expect(label).toBe('आज');
    await i18n.changeLanguage('en');
    vi.useRealTimers();
  });

  it('picks a greeting by local hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T02:00:00Z')); // 07:30 IST
    expect(greetingKey(IST)).toBe('today.greeting.morning');
    vi.setSystemTime(new Date('2026-11-18T14:00:00Z')); // 19:30 IST
    expect(greetingKey(IST)).toBe('today.greeting.evening');
    vi.useRealTimers();
  });
});
