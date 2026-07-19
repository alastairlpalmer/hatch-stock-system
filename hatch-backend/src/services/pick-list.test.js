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
  computeLocationNeeds,
  remainingBatchPlan,
} from './pick-list.js';
import { buildPlanogramScope } from './planogram-layout.js';

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

describe('remainingBatchPlan', () => {
  const plan = [
    { batchId: 'b1', qty: 10, expiryDate: '2026-07-20' },
    { batchId: 'b2', qty: 5, expiryDate: '2026-08-01' },
  ];

  it('returns the full plan when nothing was consumed before', () => {
    expect(remainingBatchPlan(plan, [])).toEqual(plan);
    expect(remainingBatchPlan(plan, undefined)).toEqual(plan);
  });

  it('reduces a line by a partial prior take, preserving line metadata', () => {
    const result = remainingBatchPlan(plan, [{ batchId: 'b1', take: 4 }]);
    expect(result).toEqual([
      { batchId: 'b1', qty: 6, expiryDate: '2026-07-20' },
      { batchId: 'b2', qty: 5, expiryDate: '2026-08-01' },
    ]);
  });

  it('drops a line fully drained by prior takes', () => {
    const result = remainingBatchPlan(plan, [
      { batchId: 'b1', take: 7 },
      { batchId: 'b1', take: 3 },
    ]);
    expect(result).toEqual([{ batchId: 'b2', qty: 5, expiryDate: '2026-08-01' }]);
  });

  it('ignores prior takes for batches not on the plan', () => {
    const result = remainingBatchPlan(plan, [{ batchId: 'other', take: 99 }]);
    expect(result).toEqual(plan);
  });

  it('handles empty or malformed plans and takes', () => {
    expect(remainingBatchPlan([], [{ batchId: 'b1', take: 1 }])).toEqual([]);
    expect(remainingBatchPlan(undefined, [])).toEqual([]);
    expect(remainingBatchPlan(
      [{ batchId: null, qty: 5 }, { batchId: 'b2', qty: 0 }],
      [{ batchId: 'b2' }],
    )).toEqual([]);
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

describe('computeLocationNeeds', () => {
  const freshSkus = new Set(['FRIVE-1', 'FRIVE-2']);
  const membersByMealType = {
    Meat: [{ sku: 'FRIVE-1', name: 'Chicken' }, { sku: 'FRIVE-2', name: 'Beef' }],
  };
  const availableOf = { 'FRIVE-1': 10, 'FRIVE-2': 10, COKE: 50, JUICE: 50 };
  const noExpiry = () => null;

  const base = {
    freshSkus,
    membersByMealType,
    availableOf,
    earliestExpiryOf: noExpiry,
  };

  it('legacy path (no scope): fills every configured target to config max', () => {
    const { needs, notOnPlanogram } = computeLocationNeeds({
      ...base,
      scope: null,
      configs: [{ sku: 'COKE', maxStock: 12 }, { sku: 'JUICE', maxStock: 6 }],
      mealConfigs: [{ mealType: 'Meat', maxStock: 10 }],
      stockOf: (sku) => ({ COKE: 4, JUICE: 6, 'FRIVE-1': 2 }[sku] || 0),
    });
    expect(notOnPlanogram).toBeNull();
    expect(needs).toContainEqual({ sku: 'COKE', qty: 8 });
    expect(needs.find((n) => n.sku === 'JUICE')).toBeUndefined(); // already full
    // Meat group: max 10 - 2 in machine = 8 split across members
    const meat = needs.filter((n) => freshSkus.has(n.sku));
    expect(meat.reduce((a, n) => a + n.qty, 0)).toBe(8);
  });

  it('scoped: only slotted targets pick, capacity beats config max', () => {
    const scope = buildPlanogramScope(
      [
        { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: null },
        { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat', capacity: 15 },
      ],
      [{ shelf: 1, slots: 6, unitsPerSlot: 9 }],
    );
    const { needs, notOnPlanogram } = computeLocationNeeds({
      ...base,
      scope,
      configs: [{ sku: 'COKE', maxStock: 99 }, { sku: 'JUICE', maxStock: 6 }],
      mealConfigs: [{ mealType: 'Meat', maxStock: 10 }],
      stockOf: (sku) => ({ COKE: 4 }[sku] || 0),
    });
    // COKE: capacity 9 (shelf default) beats config 99 -> need 5
    expect(needs).toContainEqual({ sku: 'COKE', qty: 5 });
    // JUICE configured but not slotted -> excluded, reported
    expect(needs.find((n) => n.sku === 'JUICE')).toBeUndefined();
    expect(notOnPlanogram.skus).toEqual(['JUICE']);
    expect(notOnPlanogram.mealTypes).toEqual([]);
    // Meat group: slot capacity 15 beats config 10 -> 15 split across members
    const meat = needs.filter((n) => freshSkus.has(n.sku));
    expect(meat.reduce((a, n) => a + n.qty, 0)).toBe(15);
  });

  it('scoped: slotted target with no capacity anywhere falls back to config max, else skipped', () => {
    const scope = buildPlanogramScope(
      [
        { shelf: 2, position: 0, targetType: 'sku', sku: 'COKE', capacity: null },
        { shelf: 2, position: 1, targetType: 'sku', sku: 'JUICE', capacity: null },
      ],
      [{ shelf: 2, slots: 4 }], // no unitsPerSlot
    );
    const { needs } = computeLocationNeeds({
      ...base,
      scope,
      configs: [{ sku: 'COKE', maxStock: 12 }], // JUICE has no config either
      mealConfigs: [],
      stockOf: () => 0,
    });
    expect(needs).toContainEqual({ sku: 'COKE', qty: 12 }); // config fallback
    expect(needs.find((n) => n.sku === 'JUICE')).toBeUndefined(); // nothing to fill to
  });

  it('scoped: fresh flavour SKU slotted directly is ignored (fills via its group)', () => {
    const scope = buildPlanogramScope(
      [{ shelf: 1, position: 0, targetType: 'sku', sku: 'FRIVE-1', capacity: 5 }],
      [{ shelf: 1, slots: 6 }],
    );
    const { needs } = computeLocationNeeds({
      ...base,
      scope,
      configs: [],
      mealConfigs: [],
      stockOf: () => 0,
    });
    expect(needs).toEqual([]);
  });

  it('scoped: empty diagram picks nothing and reports all configured targets', () => {
    const scope = buildPlanogramScope([], [{ shelf: 1, slots: 6 }]);
    const { needs, notOnPlanogram } = computeLocationNeeds({
      ...base,
      scope,
      configs: [{ sku: 'COKE', maxStock: 12 }],
      mealConfigs: [{ mealType: 'Meat', maxStock: 10 }],
      stockOf: () => 0,
    });
    expect(needs).toEqual([]);
    expect(notOnPlanogram).toEqual({ skus: ['COKE'], mealTypes: ['Meat'], parents: [] });
  });
});

describe('computeLocationNeeds — product families', () => {
  const base = {
    freshSkus: new Set(),
    membersByMealType: {},
    membersByParent: {
      p1: [{ sku: 'BB-CHOC', name: 'Choc' }, { sku: 'BB-CARA', name: 'Caramel' }],
    },
    availableOf: { 'BB-CHOC': 100, 'BB-CARA': 100 },
    earliestExpiryOf: () => null,
  };

  it('parent slot fills the family split by warehouse availability', () => {
    const scope = {
      skuSet: new Set(),
      mealTypeSet: new Set(),
      parentSet: new Set(['p1']),
      capacityByTarget: new Map([['parent:p1', 12]]),
    };
    const { needs } = computeLocationNeeds({
      ...base,
      scope,
      configs: [],
      mealConfigs: [],
      parentConfigs: [],
      stockOf: (sku) => (sku === 'BB-CHOC' ? 2 : 0), // family stock 2, need 10
    });
    const total = needs.reduce((a, n) => a + n.qty, 0);
    expect(total).toBe(10);
    expect(needs.every((n) => ['BB-CHOC', 'BB-CARA'].includes(n.sku))).toBe(true);
  });

  it('a member with its OWN sku slot fills per-slot and leaves the family split', () => {
    const scope = {
      skuSet: new Set(['BB-CHOC']),
      mealTypeSet: new Set(),
      parentSet: new Set(['p1']),
      capacityByTarget: new Map([['sku:BB-CHOC', 8], ['parent:p1', 6]]),
    };
    const { needs } = computeLocationNeeds({
      ...base,
      scope,
      configs: [],
      mealConfigs: [],
      parentConfigs: [],
      stockOf: () => 0,
    });
    const bySku = Object.fromEntries(needs.map((n) => [n.sku, n.qty]));
    expect(bySku['BB-CHOC']).toBe(8); // own slot, exact
    expect(bySku['BB-CARA']).toBe(6); // family slot entirely on the other flavour
  });

  it('legacy path (no diagram): parent config splits across members without their own config', () => {
    const { needs, notOnPlanogram } = computeLocationNeeds({
      ...base,
      scope: null,
      configs: [{ sku: 'BB-CHOC', maxStock: 5 }],
      mealConfigs: [],
      parentConfigs: [{ parentId: 'p1', maxStock: 10 }],
      stockOf: () => 0,
    });
    const bySku = Object.fromEntries(needs.map((n) => [n.sku, n.qty]));
    expect(bySku['BB-CHOC']).toBe(5); // its own config
    expect(bySku['BB-CARA']).toBe(10); // full family target on the unconfigured member
    expect(notOnPlanogram).toBeNull();
  });

  it('flags a configured family with no coverage on the diagram', () => {
    const scope = {
      skuSet: new Set(),
      mealTypeSet: new Set(),
      parentSet: new Set(),
      capacityByTarget: new Map(),
    };
    const { notOnPlanogram } = computeLocationNeeds({
      ...base,
      scope,
      configs: [],
      mealConfigs: [],
      parentConfigs: [{ parentId: 'p1', maxStock: 10 }],
      stockOf: () => 0,
    });
    expect(notOnPlanogram.parents).toEqual(['p1']);
    // ONE member slotted out of two is NOT coverage — the other flavour would
    // silently go unpicked; the family stays flagged.
    const partial = computeLocationNeeds({
      ...base,
      scope: { ...scope, skuSet: new Set(['BB-CHOC']), capacityByTarget: new Map([['sku:BB-CHOC', 8]]) },
      configs: [],
      mealConfigs: [],
      parentConfigs: [{ parentId: 'p1', maxStock: 10 }],
      stockOf: () => 0,
    });
    expect(partial.notOnPlanogram.parents).toEqual(['p1']);
    // EVERY member with an effective own slot = de-facto placement, no flag.
    const covered = computeLocationNeeds({
      ...base,
      scope: {
        ...scope,
        skuSet: new Set(['BB-CHOC', 'BB-CARA']),
        capacityByTarget: new Map([['sku:BB-CHOC', 8], ['sku:BB-CARA', 8]]),
      },
      configs: [],
      mealConfigs: [],
      parentConfigs: [{ parentId: 'p1', maxStock: 10 }],
      stockOf: () => 0,
    });
    expect(covered.notOnPlanogram.parents).toEqual([]);
  });

  it('an own slot with NO resolvable capacity falls back into the family split', () => {
    // BB-CHOC has a facing but no per-slot capacity, no shelf default, no
    // config row — its slot produces no fill target. It must NOT be excluded
    // from the family split (that was silent starvation of the facing).
    const scope = {
      skuSet: new Set(['BB-CHOC']),
      mealTypeSet: new Set(),
      parentSet: new Set(['p1']),
      capacityByTarget: new Map([['parent:p1', 12]]), // sku:BB-CHOC unresolvable
    };
    const { needs } = computeLocationNeeds({
      ...base,
      scope,
      configs: [],
      mealConfigs: [],
      parentConfigs: [],
      stockOf: () => 0,
    });
    const skus = needs.map((n) => n.sku);
    expect(skus).toContain('BB-CHOC'); // back in the split
    expect(needs.reduce((a, n) => a + n.qty, 0)).toBe(12);
  });
});

describe('computeLocationNeeds — not-on-planogram report for family flavours', () => {
  it('does not list a configured flavour that is served via its family slot', () => {
    const { needs, notOnPlanogram } = computeLocationNeeds({
      freshSkus: new Set(),
      membersByMealType: {},
      membersByParent: { p1: [{ sku: 'BB-CHOC', name: 'Choc' }, { sku: 'BB-CARA', name: 'Caramel' }] },
      availableOf: { 'BB-CHOC': 100, 'BB-CARA': 100 },
      earliestExpiryOf: () => null,
      scope: {
        skuSet: new Set(),
        mealTypeSet: new Set(),
        parentSet: new Set(['p1']),
        capacityByTarget: new Map([['parent:p1', 12]]),
      },
      // BB-CHOC has a per-SKU config but NO own slot — it is picked through
      // the family split, so warning "not on the planogram" is misleading.
      configs: [{ sku: 'BB-CHOC', maxStock: 5 }],
      mealConfigs: [],
      parentConfigs: [],
      stockOf: () => 0,
    });
    expect(needs.map((n) => n.sku)).toContain('BB-CHOC');
    expect(notOnPlanogram.skus).toEqual([]);
  });
});
