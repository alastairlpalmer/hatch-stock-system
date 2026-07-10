import { describe, it, expect } from 'vitest';
import {
  positionLetter,
  slotCode,
  validateLayout,
  diffSlotAssignments,
  detectStale,
  computeUnplaced,
  buildRestockSheetRows,
} from './planogram-layout.js';

describe('positionLetter / slotCode', () => {
  it('letters positions A..Z', () => {
    expect(positionLetter(0)).toBe('A');
    expect(positionLetter(4)).toBe('E');
    expect(positionLetter(25)).toBe('Z');
  });

  it('returns ? for out-of-range positions', () => {
    expect(positionLetter(-1)).toBe('?');
    expect(positionLetter(26)).toBe('?');
    expect(positionLetter(1.5)).toBe('?');
  });

  it('builds slot codes', () => {
    expect(slotCode(1, 0)).toBe('1A');
    expect(slotCode(8, 5)).toBe('8F');
  });
});

describe('validateLayout', () => {
  const shelves = [
    { shelf: 1, slots: 6 },
    { shelf: 2, slots: 4 },
  ];

  it('accepts a valid layout with assignments', () => {
    const errors = validateLayout(shelves, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'ABC' },
      { shelf: 2, position: 3, targetType: 'mealType', mealType: 'Meat' },
    ]);
    expect(errors).toEqual([]);
  });

  it('rejects empty or missing shelves', () => {
    expect(validateLayout([])).toEqual(['Layout must have at least one shelf']);
    expect(validateLayout(undefined)).toEqual(['Layout must have at least one shelf']);
  });

  it('rejects duplicate shelf numbers and bad slot counts', () => {
    const errors = validateLayout([
      { shelf: 1, slots: 6 },
      { shelf: 1, slots: 4 },
      { shelf: 2, slots: 0 },
      { shelf: 3, slots: 27 },
    ]);
    expect(errors).toContain('Duplicate shelf number: 1');
    expect(errors.some((e) => e.startsWith('Shelf 2:'))).toBe(true);
    expect(errors.some((e) => e.startsWith('Shelf 3:'))).toBe(true);
  });

  it('rejects assignments outside the layout', () => {
    const errors = validateLayout(shelves, [
      { shelf: 3, position: 0, targetType: 'sku', sku: 'A' }, // no shelf 3
      { shelf: 2, position: 4, targetType: 'sku', sku: 'B' }, // shelf 2 has 4 slots (0..3)
    ]);
    expect(errors).toHaveLength(2);
  });

  it('rejects duplicate slots and inconsistent targets', () => {
    const errors = validateLayout(shelves, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'A' },
      { shelf: 1, position: 0, targetType: 'sku', sku: 'B' },
      { shelf: 1, position: 1, targetType: 'sku' }, // missing sku
      { shelf: 1, position: 2, targetType: 'mealType' }, // missing mealType
      { shelf: 1, position: 3, targetType: 'other', sku: 'C' },
    ]);
    expect(errors).toContain('Duplicate assignment for slot 1A');
    expect(errors.some((e) => e.includes("targetType 'sku' requires"))).toBe(true);
    expect(errors.some((e) => e.includes("targetType 'mealType' requires"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown targetType"))).toBe(true);
  });
});

describe('diffSlotAssignments', () => {
  const open = [
    { id: 'r1', shelf: 1, position: 0, targetType: 'sku', sku: 'A', mealType: null },
    { id: 'r2', shelf: 1, position: 1, targetType: 'mealType', sku: null, mealType: 'Meat' },
  ];

  it('no changes -> nothing closed or created', () => {
    const { toCloseIds, toCreate } = diffSlotAssignments(open, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'A' },
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
    ]);
    expect(toCloseIds).toEqual([]);
    expect(toCreate).toEqual([]);
  });

  it('changed target on the same slot closes the old row and creates a new one', () => {
    const { toCloseIds, toCreate } = diffSlotAssignments(open, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'B' }, // A -> B
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' }, // unchanged
    ]);
    expect(toCloseIds).toEqual(['r1']);
    expect(toCreate).toEqual([
      { shelf: 1, position: 0, slotCode: '1A', targetType: 'sku', sku: 'B', mealType: null },
    ]);
  });

  it('cleared slot closes; new slot creates with generated slotCode', () => {
    const { toCloseIds, toCreate } = diffSlotAssignments(open, [
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
      { shelf: 2, position: 4, targetType: 'sku', sku: 'C' },
    ]);
    expect(toCloseIds).toEqual(['r1']);
    expect(toCreate).toEqual([
      { shelf: 2, position: 4, slotCode: '2E', targetType: 'sku', sku: 'C', mealType: null },
    ]);
  });

  it('sku -> mealType on the same slot counts as a change', () => {
    const { toCloseIds, toCreate } = diffSlotAssignments(open, [
      { shelf: 1, position: 0, targetType: 'mealType', mealType: 'Veg/Vegan' },
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
    ]);
    expect(toCloseIds).toEqual(['r1']);
    expect(toCreate[0]).toMatchObject({ targetType: 'mealType', mealType: 'Veg/Vegan', sku: null });
  });
});

describe('detectStale', () => {
  it('flags sku slots whose sku left the location and empty meal groups', () => {
    const out = detectStale(
      [
        { slotCode: '1A', targetType: 'sku', sku: 'GONE' },
        { slotCode: '1B', targetType: 'sku', sku: 'HERE' },
        { slotCode: '2A', targetType: 'mealType', mealType: 'Meat' },
        { slotCode: '2B', targetType: 'mealType', mealType: 'Veg/Vegan' },
      ],
      new Set(['HERE']),
      new Map([['Meat', 3], ['Veg/Vegan', 0]])
    );
    expect(out.map((a) => a.stale)).toEqual([true, false, false, true]);
  });
});

describe('buildRestockSheetRows', () => {
  const ctx = {
    qtyBySku: new Map([['COKE', 2], ['JUICE', 6]]),
    groupQty: new Map([['Meat', 3]]),
    skuMax: new Map([['COKE', 6]]), // JUICE has no max configured
    groupMax: new Map([['Meat', 20]]),
    nameBySku: new Map([['COKE', 'Coca-Cola 330ml'], ['JUICE', 'Ginger Shot']]),
  };

  it('walks shelves top-down, left-to-right and computes target-level adds', () => {
    const { rows, totalAdd } = buildRestockSheetRows(
      [
        { shelf: 2, position: 0, slotCode: '2A', targetType: 'sku', sku: 'JUICE', mealType: null },
        { shelf: 1, position: 1, slotCode: '1B', targetType: 'mealType', sku: null, mealType: 'Meat' },
        { shelf: 1, position: 0, slotCode: '1A', targetType: 'sku', sku: 'COKE', mealType: null },
      ],
      ctx
    );
    expect(rows.map((r) => r.slotCode)).toEqual(['1A', '1B', '2A']);
    const coke = rows[0];
    expect(coke).toMatchObject({ label: 'Coca-Cola 330ml', current: 2, target: 6, add: 4, primary: true });
    const meat = rows[1];
    expect(meat).toMatchObject({ label: 'Meat', isGroup: true, current: 3, target: 20, add: 17 });
    const juice = rows[2];
    expect(juice).toMatchObject({ current: 6, target: null, add: null }); // no max -> "fill" guidance
    expect(totalAdd).toBe(21);
  });

  it('multi-slot targets: first slot is primary, repeats reference it and add is not double-counted', () => {
    const { rows, totalAdd } = buildRestockSheetRows(
      [
        { shelf: 1, position: 0, slotCode: '1A', targetType: 'sku', sku: 'COKE', mealType: null },
        { shelf: 1, position: 1, slotCode: '1B', targetType: 'sku', sku: 'COKE', mealType: null },
      ],
      ctx
    );
    expect(rows[0]).toMatchObject({ primary: true, add: 4, slotCount: 2, primarySlotCode: null });
    expect(rows[1]).toMatchObject({ primary: false, add: null, current: null, primarySlotCode: '1A', slotCount: 2 });
    expect(totalAdd).toBe(4);
  });

  it('never returns a negative add when overstocked', () => {
    const { rows } = buildRestockSheetRows(
      [{ shelf: 1, position: 0, slotCode: '1A', targetType: 'sku', sku: 'COKE', mealType: null }],
      { ...ctx, qtyBySku: new Map([['COKE', 10]]) }
    );
    expect(rows[0].add).toBe(0);
  });
});

describe('computeUnplaced', () => {
  it('returns unslotted skus and meal groups; fresh meals resolve to their group', () => {
    const assignments = [
      { targetType: 'sku', sku: 'PLACED' },
      { targetType: 'mealType', mealType: 'Meat' },
    ];
    const products = [
      { sku: 'PLACED', isFreshMeal: false },
      { sku: 'LOOSE', isFreshMeal: false },
      { sku: 'FRIVE-1', isFreshMeal: true, mealType: 'Meat' }, // group placed
      { sku: 'FRIVE-2', isFreshMeal: true, mealType: 'Veg/Vegan' }, // group not placed
      { sku: 'FRIVE-3', isFreshMeal: true, mealType: null }, // -> Unclassified
    ];
    expect(computeUnplaced(assignments, products)).toEqual({
      skus: ['LOOSE'],
      mealTypes: ['Veg/Vegan', 'Unclassified'],
    });
  });
});
