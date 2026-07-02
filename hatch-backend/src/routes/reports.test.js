import { describe, it, expect, vi } from 'vitest';

// reports.js pulls in prisma and the client-report service at module load —
// stub them out; these tests only exercise the pure waste-report helpers.
vi.mock('../utils/db.js', () => ({ default: {} }));
vi.mock('../services/client-report.js', () => ({
  generateAndStoreReport: vi.fn(),
  previousCalendarMonth: vi.fn(),
  REPORT_LIST_SELECT: {},
}));

import { lastMonthKeys, lossOrientedVariance, bucketWasteByMonth } from './reports.js';

const NOW = new Date('2026-07-02T10:00:00Z');

describe('lastMonthKeys', () => {
  it('returns the window oldest first, ending with the current month', () => {
    expect(lastMonthKeys(3, NOW)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('crosses year boundaries', () => {
    expect(lastMonthKeys(3, new Date('2026-01-15T00:00:00Z'))).toEqual([
      '2025-11', '2025-12', '2026-01',
    ]);
  });

  it('handles a single-month window', () => {
    expect(lastMonthKeys(1, NOW)).toEqual(['2026-07']);
  });
});

describe('lossOrientedVariance', () => {
  it('keeps vendlive variance as-is (positive = loss)', () => {
    expect(lossOrientedVariance({ source: 'vendlive' }, { variance: 3 })).toBe(3);
    expect(lossOrientedVariance({ source: 'vendlive' }, { variance: -2 })).toBe(-2);
  });

  it('negates manual variance (counted − expected, negative = loss)', () => {
    expect(lossOrientedVariance({ source: 'manual' }, { variance: -3 })).toBe(3);
    expect(lossOrientedVariance({ source: 'manual' }, { variance: 2 })).toBe(-2);
  });

  it('falls back to expected − counted when variance is missing', () => {
    expect(lossOrientedVariance({ source: 'manual' }, { expected: 10, counted: 7 })).toBe(3);
    expect(lossOrientedVariance({ source: 'vendlive' }, {})).toBe(0);
  });
});

describe('bucketWasteByMonth', () => {
  const unitCostBySku = new Map([['COKE', 0.5], ['MEAL-1', 2.5]]);

  it('zero-fills every month in the window, oldest first', () => {
    const months = bucketWasteByMonth({
      writeOffs: [], stockChecks: [], unitCostBySku, months: 3, now: NOW,
    });
    expect(months).toEqual([
      { month: '2026-05', writeOffUnits: 0, writeOffCost: 0, shrinkageExpiredUnits: 0, shrinkageDamagedUnits: 0 },
      { month: '2026-06', writeOffUnits: 0, writeOffCost: 0, shrinkageExpiredUnits: 0, shrinkageDamagedUnits: 0 },
      { month: '2026-07', writeOffUnits: 0, writeOffCost: 0, shrinkageExpiredUnits: 0, shrinkageDamagedUnits: 0 },
    ]);
  });

  it('sums write-off units and costs into the removal month', () => {
    const months = bucketWasteByMonth({
      writeOffs: [
        {
          createdAt: '2026-06-10T09:00:00Z',
          items: [{ sku: 'COKE', quantity: 4 }, { sku: 'MEAL-1', quantity: 2 }],
        },
        { createdAt: '2026-06-20T09:00:00Z', items: [{ sku: 'COKE', quantity: 6 }] },
      ],
      stockChecks: [],
      unitCostBySku,
      months: 3,
      now: NOW,
    });
    const june = months.find((m) => m.month === '2026-06');
    expect(june.writeOffUnits).toBe(12);
    expect(june.writeOffCost).toBeCloseTo(4 * 0.5 + 2 * 2.5 + 6 * 0.5); // 10
    expect(months.find((m) => m.month === '2026-05').writeOffUnits).toBe(0);
  });

  it('costs unknown SKUs at 0 and ignores removals outside the window', () => {
    const months = bucketWasteByMonth({
      writeOffs: [
        { createdAt: '2026-07-01T09:00:00Z', items: [{ sku: 'GHOST', quantity: 3 }] },
        { createdAt: '2025-12-01T09:00:00Z', items: [{ sku: 'COKE', quantity: 99 }] },
      ],
      stockChecks: [],
      unitCostBySku,
      months: 3,
      now: NOW,
    });
    const july = months.find((m) => m.month === '2026-07');
    expect(july.writeOffUnits).toBe(3);
    expect(july.writeOffCost).toBe(0);
    expect(months.reduce((sum, m) => sum + m.writeOffUnits, 0)).toBe(3);
  });

  it('splits shrinkage into expired/damaged with loss orientation per source', () => {
    const months = bucketWasteByMonth({
      writeOffs: [],
      stockChecks: [
        {
          createdAt: '2026-07-01T08:00:00Z',
          source: 'vendlive',
          items: [
            { sku: 'COKE', variance: 3, reason: 'expired' },   // vendlive: positive = loss
            { sku: 'MEAL-1', variance: 2, reason: 'damaged' },
            { sku: 'COKE', variance: -1, reason: 'expired' },  // overage — ignored
          ],
        },
        {
          createdAt: '2026-07-01T09:00:00Z',
          source: 'manual',
          items: [
            { sku: 'COKE', variance: -4, reason: 'expired' }, // manual: negative = loss
            { sku: 'COKE', variance: 4, reason: 'damaged' },  // overage — ignored
          ],
        },
      ],
      unitCostBySku,
      months: 1,
      now: NOW,
    });
    expect(months[0].shrinkageExpiredUnits).toBe(7); // 3 (vendlive) + 4 (manual)
    expect(months[0].shrinkageDamagedUnits).toBe(2);
  });

  it('ignores stock-check items with other (or no) reasons', () => {
    const months = bucketWasteByMonth({
      writeOffs: [],
      stockChecks: [
        {
          createdAt: '2026-07-01T08:00:00Z',
          source: 'vendlive',
          items: [
            { sku: 'COKE', variance: 5, reason: 'theft' },
            { sku: 'COKE', variance: 5, reason: 'unknown' },
            { sku: 'COKE', variance: 5 },
          ],
        },
      ],
      unitCostBySku,
      months: 1,
      now: NOW,
    });
    expect(months[0].shrinkageExpiredUnits).toBe(0);
    expect(months[0].shrinkageDamagedUnits).toBe(0);
  });

  it('tolerates null inputs and non-array items JSON', () => {
    const months = bucketWasteByMonth({
      writeOffs: [{ createdAt: '2026-07-01T08:00:00Z', items: null }],
      stockChecks: null,
      unitCostBySku,
      months: 1,
      now: NOW,
    });
    expect(months).toHaveLength(1);
    expect(months[0].writeOffUnits).toBe(0);
  });
});
