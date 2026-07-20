import { describe, it, expect } from 'vitest';
import {
  periodDays,
  previousPeriod,
  pctChange,
  marginPct,
  percentile,
  shapeTiming,
  computeSuggestions,
  aggregateFamilies,
  SUGGESTION_THRESHOLDS,
} from './analytics-math.js';

describe('periodDays', () => {
  it('counts whole days, inclusive of both endpoints', () => {
    expect(periodDays('2026-06-01', '2026-06-08')).toBe(8);
    expect(periodDays('2026-06-01', '2026-06-01')).toBe(1); // same-day range is 1 day
    expect(periodDays('2026-06-01T00:00:00', '2026-06-01T06:00:00')).toBe(1); // sub-day floors to 1
    expect(periodDays('2026-06-08', '2026-06-01')).toBe(1); // inverted floors to 1
  });
});

describe('previousPeriod', () => {
  it('returns the equal-length, non-overlapping prior period in whole days', () => {
    // Jun 8–15 is 8 days inclusive; previous is the 8 days ending Jun 7.
    const { start, end } = previousPeriod('2026-06-08T00:00:00.000Z', '2026-06-15T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-07T00:00:00.000Z');
    expect(start.toISOString()).toBe('2026-05-31T00:00:00.000Z');
  });

  it('handles a same-day range (previous is the single prior day)', () => {
    const { start, end } = previousPeriod('2026-07-20', '2026-07-20');
    expect(end.toISOString()).toBe('2026-07-19T00:00:00.000Z');
    expect(start.toISOString()).toBe('2026-07-19T00:00:00.000Z');
  });
});

describe('pctChange', () => {
  it('computes percentage change', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(80, 100)).toBeCloseTo(-20);
  });
  it('returns null when there is no baseline (insufficient data)', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, null)).toBeNull();
  });
});

describe('marginPct', () => {
  it('computes margin percentage', () => {
    expect(marginPct(100, 60)).toBeCloseTo(40);
  });
  it('returns null when undefined (no revenue or unknown cost)', () => {
    expect(marginPct(0, 0)).toBeNull();
    expect(marginPct(100, null)).toBeNull();
    expect(marginPct(-5, 1)).toBeNull();
  });
});

describe('percentile', () => {
  it('linearly interpolates', () => {
    expect(percentile([1, 2, 3, 4], 0.75)).toBeCloseTo(3.25);
    expect(percentile([10], 0.75)).toBe(10);
    expect(percentile([], 0.5)).toBeNull();
  });
});

describe('shapeTiming', () => {
  it('aggregates rows into day/hour grids and finds the peaks', () => {
    const rows = [
      { dow: 1, hour: 9, transactions: 5, units: 5 }, // Mon 09:00
      { dow: 1, hour: 12, transactions: 10, units: 12 }, // Mon 12:00 (peak hour)
      { dow: 3, hour: 9, transactions: 2, units: 2 }, // Wed 09:00
    ];
    const t = shapeTiming(rows);
    expect(t.byDayOfWeek[1].transactions).toBe(15); // Monday total
    expect(t.byHour[12].transactions).toBe(10);
    expect(t.byDowHour[1][12]).toBe(10);
    expect(t.busiestDay.label).toBe('Monday');
    expect(t.busiestHour.hour).toBe(12);
  });
  it('returns null peaks when there is no data', () => {
    const t = shapeTiming([]);
    expect(t.busiestDay).toBeNull();
    expect(t.busiestHour).toBeNull();
    expect(t.byHour).toHaveLength(24);
  });
});

describe('computeSuggestions', () => {
  const days = 10;

  it('Rule A: flags high-velocity, below-average-margin products for a price increase', () => {
    const products = [
      // velocity 3/day, margin 20% < portfolio 40% → fires
      { sku: 'A', name: 'Fast Low-Margin', units: 30, revenue: 100, cost: 80, marginPct: 20, stockOnHand: 5 },
      // velocity 3/day but margin 50% > portfolio → no fire
      { sku: 'B', name: 'Fast High-Margin', units: 30, revenue: 100, cost: 50, marginPct: 50, stockOnHand: 5 },
    ];
    const out = computeSuggestions(products, { portfolioMarginPct: 40, periodDays: days });
    const a = out.find((s) => s.sku === 'A');
    expect(a).toBeTruthy();
    expect(a.rule).toBe('price-increase');
    expect(a.calc).toContain('velocity'); // (i) tooltip text explains the maths
    expect(out.find((s) => s.sku === 'B')).toBeUndefined();
  });

  it('Rule B: flags zero-sales products that still have stock on hand', () => {
    const products = [{ sku: 'C', name: 'Dead Stock', units: 0, revenue: 0, cost: 0, marginPct: null, stockOnHand: 8 }];
    const out = computeSuggestions(products, { portfolioMarginPct: 40, periodDays: days });
    expect(out[0].rule).toBe('delist-relocate');
    expect(out[0].metrics.stockOnHand).toBe(8);
  });

  it('Rule B: does NOT fire when stock is unknown (null), only when known > 0', () => {
    const products = [{ sku: 'C', name: 'No Stock Data', units: 0, revenue: 0, cost: 0, marginPct: null, stockOnHand: null }];
    expect(computeSuggestions(products, { portfolioMarginPct: 40, periodDays: days })).toHaveLength(0);
  });

  it('Rule C: flags top-quartile sellers that are out of stock as possible lost sales', () => {
    const products = [
      { sku: 'H', name: 'Hot', units: 50, revenue: 200, cost: 100, marginPct: 50, stockOnHand: 0 }, // top seller, OOS → fires
      { sku: 'L1', name: 'Slow1', units: 2, revenue: 10, cost: 5, marginPct: 50, stockOnHand: 3 },
      { sku: 'L2', name: 'Slow2', units: 1, revenue: 5, cost: 2, marginPct: 60, stockOnHand: 3 },
    ];
    const out = computeSuggestions(products, { portfolioMarginPct: 40, periodDays: days });
    const lost = out.find((s) => s.rule === 'lost-sales');
    expect(lost).toBeTruthy();
    expect(lost.sku).toBe('H');
    expect(lost.metrics.stockOnHand).toBe(0);
  });

  it('uses the documented default thresholds and returns [] without a period', () => {
    expect(SUGGESTION_THRESHOLDS.priceIncreaseMinVelocity).toBe(2);
    expect(computeSuggestions([{ sku: 'X', units: 100, revenue: 1, cost: 0, stockOnHand: 0 }], { periodDays: 0 })).toEqual([]);
  });
});

describe('aggregateFamilies', () => {
  const parents = [
    { id: 'f1', name: 'Barebells', products: [{ sku: 'BB-CHOC', name: 'Barebells Chocolate' }, { sku: 'BB-CARA', name: 'Barebells Caramel' }, { sku: 'BB-NEW', name: 'Barebells Cookies' }] },
    { id: 'f2', name: 'Estate Dairy', products: [{ sku: 'ED-MOCHA', name: 'Estate Dairy Mocha' }] },
  ];
  const stats = [
    { sku: 'BB-CHOC', name: 'Barebells Chocolate', units: 30, revenue: 75, transactions: 30, paidRevenue: 75, paidCost: 45, marginPct: 40, stockOnHand: 5 },
    { sku: 'BB-CARA', name: 'Barebells Caramel', units: 10, revenue: 25, transactions: 10, paidRevenue: 25, paidCost: 20, marginPct: 20, stockOnHand: 8 },
    { sku: 'ED-MOCHA', name: 'Estate Dairy Mocha', units: 12, revenue: 36, transactions: 12, paidRevenue: 36, paidCost: 18, marginPct: 50, stockOnHand: 2 },
    { sku: 'UNRELATED', name: 'Coke', units: 99, revenue: 99, transactions: 99, paidRevenue: 99, paidCost: 50, marginPct: 49.5, stockOnHand: 1 },
  ];

  it('sums members, recomputes margin on the summed paid basis, sorts by units', () => {
    const fams = aggregateFamilies(parents, stats);
    expect(fams.map((f) => f.name)).toEqual(['Barebells', 'Estate Dairy']);
    const bb = fams[0];
    expect(bb.units).toBe(40);
    expect(bb.revenue).toBe(100);
    expect(bb.stockOnHand).toBe(13);
    // (100 - 65) / 100 — NOT the average of 40% and 20%
    expect(bb.marginPct).toBeCloseTo(35);
  });

  it('keeps zero-sales flavours visible and computes units share', () => {
    const bb = aggregateFamilies(parents, stats)[0];
    expect(bb.members.map((m) => m.sku)).toEqual(['BB-CHOC', 'BB-CARA', 'BB-NEW']);
    expect(bb.members[0].unitsSharePct).toBeCloseTo(75);
    expect(bb.members[2].units).toBe(0);
    expect(bb.members[2].name).toBe('Barebells Cookies'); // falls back to the catalog name
  });

  it('ignores products outside any family and handles empty inputs', () => {
    const fams = aggregateFamilies(parents, stats);
    expect(fams.flatMap((f) => f.members.map((m) => m.sku))).not.toContain('UNRELATED');
    expect(aggregateFamilies([], stats)).toEqual([]);
    expect(aggregateFamilies(null, null)).toEqual([]);
  });

  it('nulls stock fields when the scope stock is unresolved', () => {
    const fams = aggregateFamilies(parents, stats, { stockResolved: false });
    expect(fams[0].stockOnHand).toBeNull();
    expect(fams[0].members[0].stockOnHand).toBeNull();
    // zero-units family: share is null, not NaN
    const empty = aggregateFamilies([{ id: 'f3', name: 'Ghost', products: [{ sku: 'G1', name: 'Ghost One' }] }], []);
    expect(empty[0].members[0].unitsSharePct).toBeNull();
  });
});
