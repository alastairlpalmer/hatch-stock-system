import { describe, it, expect } from 'vitest';
import {
  resolveModeMeta,
  computeSuggestion,
  computeNetNeed,
  computeOrderQty,
} from './order-suggestions.js';

// 2026-06-29 was a Monday.
const TUESDAY = new Date('2026-06-30T10:00:00Z');
const WEDNESDAY = new Date('2026-07-01T10:00:00Z');
const FRIDAY = new Date('2026-07-03T10:00:00Z');

describe('resolveModeMeta — weekly', () => {
  it('targets next Monday with the remaining trading days from a Wednesday', () => {
    const meta = resolveModeMeta(WEDNESDAY, { mode: 'weekly', coverDays: 5 });
    expect(meta.mode).toBe('weekly');
    expect(meta.restockDate.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(meta.sellingDaysBeforeRestock).toBe(2); // Thu + Fri
    expect(meta.coverTradingDays).toBe(5);
  });

  it('has no selling days left on a Friday (stock frozen over the weekend)', () => {
    const meta = resolveModeMeta(FRIDAY, { mode: 'weekly' });
    expect(meta.restockDate.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(meta.sellingDaysBeforeRestock).toBe(0);
  });

  it('defaults mode to weekly and cover to 5 trading days', () => {
    const meta = resolveModeMeta(WEDNESDAY);
    expect(meta.mode).toBe('weekly');
    expect(meta.coverTradingDays).toBe(5);
  });
});

describe('resolveModeMeta — topup', () => {
  it('from a Tuesday restocks Wednesday and covers Wed–Fri', () => {
    const meta = resolveModeMeta(TUESDAY, { mode: 'topup' });
    expect(meta.mode).toBe('topup');
    expect(meta.restockDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(meta.sellingDaysBeforeRestock).toBe(0);
    expect(meta.coverTradingDays).toBe(3); // Wed, Thu, Fri
  });

  it('from a Friday restocks Monday and covers the full week', () => {
    const meta = resolveModeMeta(FRIDAY, { mode: 'topup' });
    expect(meta.restockDate.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(meta.coverTradingDays).toBe(5);
  });

  it('never returns less than 1 cover day (Thursday → Friday only)', () => {
    const meta = resolveModeMeta(new Date('2026-07-02T10:00:00Z'), { mode: 'topup' });
    expect(meta.restockDate.toISOString()).toBe('2026-07-03T00:00:00.000Z');
    expect(meta.coverTradingDays).toBe(1);
  });
});

describe('computeSuggestion — weekly projection from a Wednesday', () => {
  // Wednesday, 2 trading days (Thu, Fri) left before the Monday restock.
  const base = { sellingDaysBeforeRestock: 2, coverTradingDays: 5 };

  it('burns machine stock down over the remaining selling days', () => {
    const s = computeSuggestion({ ...base, machineStock: 20, velocityTd: 3 });
    // projected = 20 - ceil(3 * 2) = 14; targetFill = ceil(3 * 5) = 15
    expect(s.projectedStock).toBe(14);
    expect(s.targetFill).toBe(15);
    expect(s.grossNeed).toBe(1);
    expect(s.priority).toBe('warning');
    expect(s.basis).toBe('velocity');
    expect(s.daysOfCover).toBeCloseTo(6.67, 2);
  });

  it('clamps projected stock at zero and flags critical', () => {
    const s = computeSuggestion({ ...base, machineStock: 4, velocityTd: 3 });
    expect(s.projectedStock).toBe(0);
    expect(s.grossNeed).toBe(15);
    expect(s.priority).toBe('critical');
  });

  it('caps the target fill at maxStock', () => {
    const s = computeSuggestion({ ...base, machineStock: 0, velocityTd: 10, maxStock: 30 });
    expect(s.targetFill).toBe(30); // ceil(10*5)=50, capped
    expect(s.grossNeed).toBe(30);
  });

  it('flags critical when projected at/below minStock', () => {
    const s = computeSuggestion({ ...base, machineStock: 20, velocityTd: 3, minStock: 14 });
    expect(s.projectedStock).toBe(14);
    expect(s.priority).toBe('critical');
  });
});

describe('computeSuggestion — par fallback with no demand', () => {
  it('tops up to min when ONLY minStock is configured (old engine required both)', () => {
    const s = computeSuggestion({
      machineStock: 2,
      velocityTd: 0,
      sellingDaysBeforeRestock: 2,
      coverTradingDays: 5,
      minStock: 5,
      maxStock: null,
    });
    expect(s.basis).toBe('par_fallback');
    expect(s.targetFill).toBe(5);
    expect(s.grossNeed).toBe(3);
    expect(s.priority).toBe('critical');
  });

  it('prefers maxStock as the fill target when both are set', () => {
    const s = computeSuggestion({
      machineStock: 2, velocityTd: 0, minStock: 5, maxStock: 12,
    });
    expect(s.targetFill).toBe(12);
    expect(s.grossNeed).toBe(10);
  });

  it('returns null with no demand and stock above min', () => {
    const s = computeSuggestion({ machineStock: 9, velocityTd: 0, minStock: 5, maxStock: 12 });
    expect(s).toBeNull();
  });

  it('returns null with no demand and no min configured', () => {
    expect(computeSuggestion({ machineStock: 0, velocityTd: 0, maxStock: 20 })).toBeNull();
  });
});

describe('computeNetNeed — netting arithmetic', () => {
  it('subtracts warehouse pool and pending POs from gross need', () => {
    expect(computeNetNeed(50, 20, 10)).toBe(20);
  });

  it('clamps at zero when fully covered', () => {
    expect(computeNetNeed(25, 20, 10)).toBe(0);
  });

  it('treats missing figures as zero', () => {
    expect(computeNetNeed(7)).toBe(7);
  });
});

describe('computeOrderQty — box rounding capped by machine capacity', () => {
  it('rounds up to whole boxes', () => {
    expect(computeOrderQty({ netNeed: 10, unitsPerBox: 6 })).toBe(12);
  });

  it('rounds DOWN when rounding up would exceed the summed maxStock', () => {
    // ceil(10/6)*6 = 12; 30 + 12 = 42 > 40 -> floor((40-30)/6)*6 = 6
    expect(computeOrderQty({ netNeed: 10, unitsPerBox: 6, projectedStock: 30, maxStock: 40 })).toBe(6);
  });

  it('can drop to zero when not even one box fits', () => {
    expect(computeOrderQty({ netNeed: 10, unitsPerBox: 12, projectedStock: 30, maxStock: 36 })).toBe(0);
  });

  it('ignores the cap when maxStock is unknown', () => {
    expect(computeOrderQty({ netNeed: 10, unitsPerBox: 12, projectedStock: 30, maxStock: null })).toBe(12);
  });

  it('returns 0 for zero or negative net need', () => {
    expect(computeOrderQty({ netNeed: 0, unitsPerBox: 6 })).toBe(0);
  });

  it('treats a missing/zero unitsPerBox as 1', () => {
    expect(computeOrderQty({ netNeed: 5, unitsPerBox: 0 })).toBe(5);
  });
});
