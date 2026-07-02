import { describe, it, expect, vi } from 'vitest';

// pick-list.js pulls in prisma at module load — stub it out; these tests only
// exercise the pure helpers.
vi.mock('../utils/db.js', () => ({ default: {} }));

import {
  buildReconciliation,
  findReturnViolations,
  splitGroupNeed,
  expiresBeforeNextRestock,
  buildExpiryWarnings,
} from './pick-list.js';

describe('buildReconciliation', () => {
  const items = [
    { sku: 'COKE', name: 'Coca-Cola', totalQty: 24 },
    { sku: 'WATER', name: 'Still Water', totalQty: 12, packedQty: 10 },
    { sku: 'CRISPS', name: 'Salted Crisps', totalQty: 6 },
  ];

  it('uses packedQty when set, falling back to totalQty', () => {
    const { perSku } = buildReconciliation(items, [], null);
    expect(perSku.find((r) => r.sku === 'COKE').packed).toBe(24);
    expect(perSku.find((r) => r.sku === 'WATER').packed).toBe(10);
  });

  it('sums loaded across multiple restocks (including repeat visits to one location)', () => {
    const restocks = [
      { items: [{ sku: 'COKE', quantity: 8 }, { sku: 'WATER', quantity: 4 }] },
      { items: [{ sku: 'COKE', quantity: 6 }] },
      { items: [{ sku: 'COKE', quantity: 2 }] }, // second visit, same stop
    ];
    const { perSku, loadedUnits } = buildReconciliation(items, restocks, null);
    expect(perSku.find((r) => r.sku === 'COKE').loaded).toBe(16);
    expect(perSku.find((r) => r.sku === 'WATER').loaded).toBe(4);
    expect(loadedUnits).toBe(20);
  });

  it('sums returned across multiple return journal entries', () => {
    const returned = [
      { sku: 'COKE', quantity: 3, returnedAt: '2026-07-01T18:00:00Z' },
      { sku: 'COKE', quantity: 2, returnedAt: '2026-07-01T19:00:00Z' },
    ];
    const { perSku, returnedUnits } = buildReconciliation(items, [], returned);
    expect(perSku.find((r) => r.sku === 'COKE').returned).toBe(5);
    expect(returnedUnits).toBe(5);
  });

  it('computes remaining = packed - loaded - returned, floored at 0', () => {
    const restocks = [{ items: [{ sku: 'COKE', quantity: 20 }, { sku: 'WATER', quantity: 12 }] }];
    const returned = [{ sku: 'COKE', quantity: 2 }];
    const { perSku } = buildReconciliation(items, restocks, returned);
    expect(perSku.find((r) => r.sku === 'COKE').remaining).toBe(2); // 24 - 20 - 2
    // WATER packed 10 but 12 loaded (over-load) — remaining clamps at 0
    expect(perSku.find((r) => r.sku === 'WATER').remaining).toBe(0);
    expect(perSku.find((r) => r.sku === 'CRISPS').remaining).toBe(6); // untouched
  });

  it('totals the unit columns', () => {
    const restocks = [{ items: [{ sku: 'COKE', quantity: 10 }] }];
    const returned = [{ sku: 'WATER', quantity: 4 }];
    const recon = buildReconciliation(items, restocks, returned);
    expect(recon.packedUnits).toBe(40); // 24 + 10 + 6
    expect(recon.loadedUnits).toBe(10);
    expect(recon.returnedUnits).toBe(4);
    expect(recon.remainingUnits).toBe(26); // 14 + 6 + 6
  });

  it('ignores loaded quantities for SKUs not on the list and handles empty inputs', () => {
    const restocks = [{ items: [{ sku: 'GHOST', quantity: 5 }] }];
    const recon = buildReconciliation(items, restocks, undefined);
    expect(recon.perSku.map((r) => r.sku)).toEqual(['COKE', 'WATER', 'CRISPS']);
    expect(recon.loadedUnits).toBe(0);

    const empty = buildReconciliation(null, [], null);
    expect(empty.perSku).toEqual([]);
    expect(empty.packedUnits).toBe(0);
    expect(empty.remainingUnits).toBe(0);
  });
});

describe('findReturnViolations', () => {
  const perSku = [
    { sku: 'COKE', remaining: 5 },
    { sku: 'WATER', remaining: 0 },
  ];

  it('accepts returns within remaining', () => {
    expect(findReturnViolations(perSku, [{ sku: 'COKE', quantity: 5 }])).toEqual([]);
  });

  it('rejects a return exceeding remaining', () => {
    expect(findReturnViolations(perSku, [{ sku: 'COKE', quantity: 6 }])).toEqual([
      { sku: 'COKE', requested: 6, remaining: 5 },
    ]);
  });

  it('rejects any return of a SKU with nothing left on the van', () => {
    expect(findReturnViolations(perSku, [{ sku: 'WATER', quantity: 1 }])).toEqual([
      { sku: 'WATER', requested: 1, remaining: 0 },
    ]);
  });

  it('rejects SKUs that are not on the pick list', () => {
    expect(findReturnViolations(perSku, [{ sku: 'GHOST', quantity: 1 }])).toEqual([
      { sku: 'GHOST', requested: 1, remaining: 0 },
    ]);
  });

  it('sums duplicate request lines for the same SKU before checking', () => {
    expect(findReturnViolations(perSku, [
      { sku: 'COKE', quantity: 3 },
      { sku: 'COKE', quantity: 3 },
    ])).toEqual([{ sku: 'COKE', requested: 6, remaining: 5 }]);
  });
});

describe('expiresBeforeNextRestock', () => {
  const targetDate = '2026-07-06'; // restock Monday

  it('flags a batch expiring during the week (before target + 7 days)', () => {
    expect(expiresBeforeNextRestock('2026-07-08', targetDate)).toBe(true);
    expect(expiresBeforeNextRestock('2026-07-12', targetDate)).toBe(true); // day before next restock
  });

  it('does not flag a batch surviving to the next restock day or beyond', () => {
    expect(expiresBeforeNextRestock('2026-07-13', targetDate)).toBe(false); // next Monday itself
    expect(expiresBeforeNextRestock('2026-08-01', targetDate)).toBe(false);
  });

  it('flags a batch already expired on the target date', () => {
    expect(expiresBeforeNextRestock('2026-07-01', targetDate)).toBe(true);
  });

  it('compares UTC calendar date parts, ignoring time of day', () => {
    expect(expiresBeforeNextRestock('2026-07-13T02:00:00Z', '2026-07-06T23:59:00Z')).toBe(false);
    expect(expiresBeforeNextRestock('2026-07-12T23:00:00Z', targetDate)).toBe(true);
  });

  it('never flags a batch without an expiry date', () => {
    expect(expiresBeforeNextRestock(null, targetDate)).toBe(false);
    expect(expiresBeforeNextRestock(undefined, targetDate)).toBe(false);
  });

  it('accepts Date objects for both arguments', () => {
    expect(expiresBeforeNextRestock(new Date('2026-07-10'), new Date(targetDate))).toBe(true);
  });
});

describe('buildExpiryWarnings', () => {
  it('summarises flagged units per SKU with the earliest flagged expiry', () => {
    const items = [
      {
        sku: 'MEAL-1',
        name: 'Chicken Katsu',
        totalQty: 10,
        batches: [
          { batchId: 'b1', qty: 4, expiryDate: '2026-07-10T00:00:00.000Z', expiresBeforeNextRestock: true },
          { batchId: 'b2', qty: 3, expiryDate: '2026-07-08T00:00:00.000Z', expiresBeforeNextRestock: true },
          { batchId: 'b3', qty: 3, expiryDate: '2026-07-20T00:00:00.000Z' }, // unflagged — excluded
        ],
      },
      {
        sku: 'COKE',
        name: 'Coca-Cola',
        totalQty: 24,
        batches: [{ batchId: 'b4', qty: 24, expiryDate: '2027-01-01T00:00:00.000Z' }],
      },
    ];
    expect(buildExpiryWarnings(items)).toEqual([
      { sku: 'MEAL-1', name: 'Chicken Katsu', qty: 7, expiryDate: '2026-07-08T00:00:00.000Z' },
    ]);
  });

  it('produces one warning per SKU with flagged batches', () => {
    const items = [
      { sku: 'A', name: 'A', batches: [{ qty: 2, expiryDate: '2026-07-09', expiresBeforeNextRestock: true }] },
      { sku: 'B', name: 'B', batches: [{ qty: 5, expiryDate: '2026-07-10', expiresBeforeNextRestock: true }] },
    ];
    expect(buildExpiryWarnings(items)).toEqual([
      { sku: 'A', name: 'A', qty: 2, expiryDate: '2026-07-09' },
      { sku: 'B', name: 'B', qty: 5, expiryDate: '2026-07-10' },
    ]);
  });

  it('returns [] for items without flags, missing batches, or non-array input', () => {
    expect(buildExpiryWarnings([{ sku: 'A', name: 'A', batches: [] }])).toEqual([]);
    expect(buildExpiryWarnings([{ sku: 'A', name: 'A' }])).toEqual([]);
    expect(buildExpiryWarnings([])).toEqual([]);
    expect(buildExpiryWarnings(null)).toEqual([]);
  });
});

describe('splitGroupNeed', () => {
  it('splits proportionally to availability with remainder to soonest expiry', () => {
    const split = splitGroupNeed(10, [
      { sku: 'A', available: 6, earliestExpiry: '2026-07-05' },
      { sku: 'B', available: 3, earliestExpiry: '2026-07-10' },
    ]);
    expect(split.A + split.B).toBe(10);
    expect(split.A).toBeGreaterThan(split.B);
  });

  it('dumps the whole need on the first member when nothing is available', () => {
    const split = splitGroupNeed(4, [
      { sku: 'A', available: 0, earliestExpiry: null },
      { sku: 'B', available: 0, earliestExpiry: null },
    ]);
    expect(split).toEqual({ A: 4, B: 0 });
  });
});
