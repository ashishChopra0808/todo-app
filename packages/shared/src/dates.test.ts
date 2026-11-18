import { describe, expect, it } from 'vitest';
import {
  canonicalTimeZone,
  fromDueAt,
  isDueToday,
  isOverdue,
  localDayRange,
  toDueAt,
} from './dates';

const IST = 'Asia/Kolkata';

describe('due dates', () => {
  it('stores a timed due date as the exact UTC instant', () => {
    expect(toDueAt('2026-11-20', '09:30', IST)).toBe('2026-11-20T04:00:00.000Z');
    expect(fromDueAt('2026-11-20T04:00:00.000Z', true, IST)).toEqual({
      date: '2026-11-20',
      time: '09:30',
    });
  });

  it('stores a date-only due date as midnight UTC of that date', () => {
    expect(toDueAt('2026-11-20', null, IST)).toBe('2026-11-20T00:00:00.000Z');
    expect(fromDueAt('2026-11-20T00:00:00.000Z', false, IST)).toEqual({
      date: '2026-11-20',
      time: null,
    });
  });

  it('computes today range in the user time zone', () => {
    // 20 Nov 01:00 IST = 19 Nov 19:30 UTC
    const r = localDayRange(IST, new Date('2026-11-19T19:30:00Z'));
    expect(r.localDate).toBe('2026-11-20');
    expect(r.startUtc.toISOString()).toBe('2026-11-19T18:30:00.000Z');
    expect(r.endUtc.toISOString()).toBe('2026-11-20T18:30:00.000Z');
  });

  it('date-only task is due today and becomes overdue after local midnight', () => {
    const task = { dueAt: '2026-11-20T00:00:00.000Z', dueHasTime: false, status: 'todo' };
    const lateOn20th = new Date('2026-11-20T18:00:00Z'); // 23:30 IST on 20th
    const after = new Date('2026-11-20T18:31:00Z'); // 00:01 IST on 21st
    expect(isDueToday(task, IST, lateOn20th)).toBe(true);
    expect(isOverdue(task, IST, lateOn20th)).toBe(false);
    expect(isOverdue(task, IST, after)).toBe(true);
  });

  it('timed task is overdue after its instant; done tasks are never overdue', () => {
    const task = { dueAt: '2026-11-20T04:00:00.000Z', dueHasTime: true, status: 'todo' };
    expect(isOverdue(task, IST, new Date('2026-11-20T04:01:00Z'))).toBe(true);
    expect(isOverdue({ ...task, status: 'done' }, IST, new Date('2026-11-21T00:00:00Z'))).toBe(
      false,
    );
  });

  it('maps old time zone names (Chrome reports Asia/Calcutta) to current ones', () => {
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Europe/London')).toBe('Europe/London');
  });

  it('rejects bad input', () => {
    expect(() => toDueAt('20-11-2026', null, IST)).toThrow();
    expect(() => toDueAt('2026-11-20', '9am', IST)).toThrow();
  });
});
