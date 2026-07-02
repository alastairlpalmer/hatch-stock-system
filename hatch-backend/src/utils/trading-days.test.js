import { describe, it, expect } from 'vitest';
import {
  isTradingDay,
  countTradingDaysBetween,
  countTradingDaysInWindow,
  nextMonday,
  nextTradingDay,
} from './trading-days.js';

// 2026-06-29 was a Monday.
const MON = new Date('2026-06-29T09:00:00Z');
const TUE = new Date('2026-06-30T09:00:00Z');
const WED = new Date('2026-07-01T09:00:00Z');
const FRI = new Date('2026-07-03T09:00:00Z');
const SAT = new Date('2026-07-04T09:00:00Z');
const SUN = new Date('2026-07-05T09:00:00Z');

describe('isTradingDay', () => {
  it('is true Monday through Friday', () => {
    expect(isTradingDay(MON)).toBe(true);
    expect(isTradingDay(WED)).toBe(true);
    expect(isTradingDay(FRI)).toBe(true);
  });

  it('is false on the weekend', () => {
    expect(isTradingDay(SAT)).toBe(false);
    expect(isTradingDay(SUN)).toBe(false);
  });

  it('uses the UTC calendar day, not local time', () => {
    // 23:59 UTC Friday is still Friday regardless of server locale
    expect(isTradingDay(new Date('2026-07-03T23:59:59Z'))).toBe(true);
    expect(isTradingDay(new Date('2026-07-04T00:00:00Z'))).toBe(false);
  });
});

describe('countTradingDaysBetween', () => {
  it('excludes both endpoints', () => {
    // Wed -> next Mon: strictly between are Thu, Fri (Sat/Sun skipped)
    expect(countTradingDaysBetween(WED, new Date('2026-07-06T00:00:00Z'))).toBe(2);
  });

  it('is 0 for adjacent or same days', () => {
    expect(countTradingDaysBetween(WED, WED)).toBe(0);
    expect(countTradingDaysBetween(WED, new Date('2026-07-02T09:00:00Z'))).toBe(0);
  });

  it('Fri -> Mon has no trading days between (only the weekend)', () => {
    expect(countTradingDaysBetween(FRI, new Date('2026-07-06T09:00:00Z'))).toBe(0);
  });

  it('counts a full week span', () => {
    // Mon 29 Jun -> Mon 6 Jul: Tue..Fri = 4
    expect(countTradingDaysBetween(MON, new Date('2026-07-06T09:00:00Z'))).toBe(4);
  });
});

describe('countTradingDaysInWindow', () => {
  it('includes both endpoints', () => {
    expect(countTradingDaysInWindow(MON, FRI)).toBe(5);
  });

  it('skips weekends inside the window', () => {
    // Mon 29 Jun .. Fri 10 Jul inclusive = 10 trading days
    expect(countTradingDaysInWindow(MON, new Date('2026-07-10T09:00:00Z'))).toBe(10);
  });

  it('handles a weekend-only window', () => {
    expect(countTradingDaysInWindow(SAT, SUN)).toBe(0);
  });

  it('counts a single trading day', () => {
    expect(countTradingDaysInWindow(WED, WED)).toBe(1);
  });

  it('returns 0 when end precedes start', () => {
    expect(countTradingDaysInWindow(FRI, WED)).toBe(0);
  });
});

describe('nextMonday', () => {
  it('is strictly after: a Monday maps to the following Monday', () => {
    expect(nextMonday(MON).toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('midweek maps to the coming Monday', () => {
    expect(nextMonday(WED).toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(nextMonday(FRI).toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(nextMonday(SUN).toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });

  it('returns UTC midnight', () => {
    const m = nextMonday(new Date('2026-07-01T18:30:00Z'));
    expect(m.getUTCHours()).toBe(0);
    expect(m.getUTCDay()).toBe(1);
  });
});

describe('nextTradingDay', () => {
  it('midweek maps to tomorrow', () => {
    expect(nextTradingDay(TUE).toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('Friday, Saturday and Sunday all map to Monday', () => {
    expect(nextTradingDay(FRI).toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(nextTradingDay(SAT).toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(nextTradingDay(SUN).toISOString()).toBe('2026-07-06T00:00:00.000Z');
  });
});
