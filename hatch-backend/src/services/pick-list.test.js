import { describe, it, expect, vi } from 'vitest';

// pick-list.js pulls in prisma at module load — stub it out; these tests only
// exercise the pure helpers.
vi.mock('../utils/db.js', () => ({ default: {} }));

import { buildReconciliation, findReturnViolations, splitGroupNeed } from './pick-list.js';

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
