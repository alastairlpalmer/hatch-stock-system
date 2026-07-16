import { describe, it, expect } from 'vitest';
import {
  resolveModeMeta,
  computeSuggestion,
  computeNetNeed,
  computeOrderQty,
  effectiveMaxStock,
  mergeNotOnPlanogram,
  splitParentNeed,
} from './order-suggestions.js';
import { buildPlanogramScope } from './planogram-layout.js';

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

describe('effectiveMaxStock — planogram capacity as the fill cap', () => {
  const scope = buildPlanogramScope(
    [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: null },
      { shelf: 1, position: 1, targetType: 'sku', sku: 'COKE', capacity: null },
      { shelf: 2, position: 0, targetType: 'sku', sku: 'JUICE', capacity: null }, // no capacity anywhere
      { shelf: 1, position: 2, targetType: 'mealType', mealType: 'Meat', capacity: 20 },
    ],
    [{ shelf: 1, slots: 6, unitsPerSlot: 8 }, { shelf: 2, slots: 4 }],
  );

  it('uses summed slot capacity when resolvable', () => {
    expect(effectiveMaxStock(scope, 'sku:COKE', 99)).toBe(16); // 2 slots × 8, config ignored
    expect(effectiveMaxStock(scope, 'mealType:Meat', null)).toBe(20);
  });

  it('falls back to config maxStock when capacity is unknown', () => {
    expect(effectiveMaxStock(scope, 'sku:JUICE', 30)).toBe(30);
    expect(effectiveMaxStock(scope, 'sku:JUICE', null)).toBe(null);
  });

  it('no scope (no diagram) -> config maxStock, legacy behaviour', () => {
    expect(effectiveMaxStock(null, 'sku:COKE', 12)).toBe(12);
    expect(effectiveMaxStock(null, 'sku:COKE', undefined)).toBe(null);
  });

  it('capacity flows through computeSuggestion as the fill cap', () => {
    const s = computeSuggestion({
      machineStock: 0,
      velocityTd: 10,
      sellingDaysBeforeRestock: 0,
      coverTradingDays: 5,
      maxStock: effectiveMaxStock(scope, 'sku:COKE', 99),
    });
    expect(s.targetFill).toBe(16); // ceil(10×5)=50 capped at 16 slots-worth
  });
});

describe('mergeNotOnPlanogram — deduped warning list across locations', () => {
  it('merges per-location exclusions with the locations affected', () => {
    const merged = mergeNotOnPlanogram([
      {
        locationName: 'Office A', applied: true,
        excluded: { skus: [{ sku: 'COKE', name: 'Coca-Cola' }], mealTypes: ['Meat'] },
      },
      {
        locationName: 'Office B', applied: true,
        excluded: { skus: [{ sku: 'COKE', name: 'Coca-Cola' }, { sku: 'JUICE', name: 'Ginger Shot' }], mealTypes: [] },
      },
      // no diagram -> contributes nothing even if excluded is present
      { locationName: 'Office C', applied: false, excluded: { skus: [{ sku: 'X', name: 'X' }], mealTypes: [] } },
    ]);
    expect(merged.skus).toEqual([
      { sku: 'COKE', name: 'Coca-Cola', locations: ['Office A', 'Office B'] },
      { sku: 'JUICE', name: 'Ginger Shot', locations: ['Office B'] },
    ]);
    expect(merged.mealTypes).toEqual([{ mealType: 'Meat', locations: ['Office A'] }]);
    expect(merged.parents).toEqual([]);
  });

  it('merges excluded product families', () => {
    const merged = mergeNotOnPlanogram([
      {
        locationName: 'Office A', applied: true,
        excluded: { skus: [], mealTypes: [], parents: [{ parentId: 'p1', name: 'Barebells' }] },
      },
      {
        locationName: 'Office B', applied: true,
        excluded: { skus: [], mealTypes: [], parents: [{ parentId: 'p1', name: 'Barebells' }] },
      },
    ]);
    expect(merged.parents).toEqual([
      { parentId: 'p1', name: 'Barebells', locations: ['Office A', 'Office B'] },
    ]);
  });

  it('handles empty/missing input', () => {
    expect(mergeNotOnPlanogram([])).toEqual({ skus: [], mealTypes: [], parents: [] });
    expect(mergeNotOnPlanogram(undefined)).toEqual({ skus: [], mealTypes: [], parents: [] });
  });
});

describe('splitParentNeed', () => {
  const members = [
    { sku: 'BB-CHOC', name: 'Choc', unitsPerBox: 12, velocityLong: 6 },
    { sku: 'BB-CARA', name: 'Caramel', unitsPerBox: 12, velocityLong: 3 },
    { sku: 'BB-COOK', name: 'Cookies', unitsPerBox: 12, velocityLong: 1 },
  ];

  it('splits by velocity share and always covers the need', () => {
    const out = splitParentNeed({ netNeed: 72, members }); // 6 boxes of 12
    const bySku = Object.fromEntries(out.map((m) => [m.sku, m]));
    // shares 60/30/10 → ideal boxes 3.6/1.8/0.6 → floors 3/1/0, remainders hand
    // out the last two boxes to choc (.6) and caramel (.8)... caramel first.
    expect(bySku['BB-CHOC'].boxes + bySku['BB-CARA'].boxes + bySku['BB-COOK'].boxes).toBe(6);
    expect(out.reduce((a, m) => a + m.units, 0)).toBeGreaterThanOrEqual(72);
    expect(bySku['BB-CHOC'].boxes).toBeGreaterThanOrEqual(bySku['BB-CARA'].boxes);
    expect(bySku['BB-CHOC'].sharePct).toBe(60);
  });

  it('is deterministic and ordered by velocity', () => {
    const a = splitParentNeed({ netNeed: 50, members });
    const b = splitParentNeed({ netNeed: 50, members });
    expect(a).toEqual(b);
    expect(a.map((m) => m.sku)).toEqual(['BB-CHOC', 'BB-CARA', 'BB-COOK']);
  });

  it('handles mixed box sizes without stranding the need', () => {
    const mixed = [
      { sku: 'ED-MOCHA', unitsPerBox: 6, velocityLong: 2 },
      { sku: 'ED-LATTE', unitsPerBox: 10, velocityLong: 2 },
    ];
    const out = splitParentNeed({ netNeed: 20, members: mixed });
    expect(out.reduce((a, m) => a + m.units, 0)).toBeGreaterThanOrEqual(20);
    // overshoot bounded: never more than the largest box beyond the need + floor boxes
    expect(out.reduce((a, m) => a + m.units, 0)).toBeLessThanOrEqual(20 + 10);
  });

  it('equal-shares a cold start (no sales history at all)', () => {
    const cold = members.map((m) => ({ ...m, velocityLong: 0 }));
    const out = splitParentNeed({ netNeed: 36, members: cold });
    expect(out.every((m) => m.boxes === 1)).toBe(true); // 3 boxes of 12 = 36
    expect(out[0].sharePct).toBeCloseTo(33.33);
  });

  it('floors a meaningful seller that rounding starved to zero', () => {
    // Cookies at exactly 20% share; small need rounds it to zero boxes.
    const m2 = [
      { sku: 'A', unitsPerBox: 12, velocityLong: 8 },
      { sku: 'B', unitsPerBox: 12, velocityLong: 2 }, // 20% share
    ];
    const out = splitParentNeed({ netNeed: 12, members: m2 });
    const b = out.find((m) => m.sku === 'B');
    expect(b.boxes).toBe(1); // floored up, even though rounding gave it 0
    expect(out.find((m) => m.sku === 'A').boxes).toBe(1);
  });

  it('does not floor a negligible seller and ignores need below one box', () => {
    const m2 = [
      { sku: 'A', unitsPerBox: 12, velocityLong: 9.5 },
      { sku: 'B', unitsPerBox: 12, velocityLong: 0.5 }, // 5% share — no floor
    ];
    const out = splitParentNeed({ netNeed: 12, members: m2 });
    expect(out.find((m) => m.sku === 'B').boxes).toBe(0);
    // need smaller than the flavour's box: floor must not trigger either
    const tiny = splitParentNeed({ netNeed: 6, members: m2 });
    expect(tiny.reduce((a, m) => a + m.units, 0)).toBeGreaterThanOrEqual(6);
  });

  it('returns zeroed members for zero/negative need and empty members safely', () => {
    const out = splitParentNeed({ netNeed: 0, members });
    expect(out.every((m) => m.units === 0 && m.boxes === 0)).toBe(true);
    expect(splitParentNeed({ netNeed: 10, members: [] })).toEqual([]);
  });

  it('treats missing unitsPerBox as 1', () => {
    const out = splitParentNeed({ netNeed: 5, members: [{ sku: 'X', velocityLong: 1 }] });
    expect(out[0].units).toBe(5);
    expect(out[0].boxes).toBe(5);
  });
});
