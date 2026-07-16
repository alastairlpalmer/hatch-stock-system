import { describe, it, expect } from 'vitest';
import {
  positionLetter,
  slotCode,
  validateLayout,
  diffSlotAssignments,
  detectStale,
  computeUnplaced,
  buildRestockSheetRows,
  resolveSlotCapacity,
  buildPlanogramScope,
  targetKey,
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
      { shelf: 1, position: 0, slotCode: '1A', targetType: 'sku', sku: 'B', mealType: null, parentId: null, capacity: null },
    ]);
  });

  it('cleared slot closes; new slot creates with generated slotCode', () => {
    const { toCloseIds, toCreate } = diffSlotAssignments(open, [
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
      { shelf: 2, position: 4, targetType: 'sku', sku: 'C' },
    ]);
    expect(toCloseIds).toEqual(['r1']);
    expect(toCreate).toEqual([
      { shelf: 2, position: 4, slotCode: '2E', targetType: 'sku', sku: 'C', mealType: null, parentId: null, capacity: null },
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

  it('capacity change on an unchanged target updates in place, never cycles history', () => {
    const { toCloseIds, toCreate, toUpdateCapacity } = diffSlotAssignments(open, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'A', capacity: 8 }, // was null
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' }, // untouched
    ]);
    expect(toCloseIds).toEqual([]);
    expect(toCreate).toEqual([]);
    expect(toUpdateCapacity).toEqual([{ id: 'r1', capacity: 8 }]);
  });

  it('capacity cleared back to null is an in-place update too', () => {
    const openWithCap = [
      { id: 'r1', shelf: 1, position: 0, targetType: 'sku', sku: 'A', mealType: null, capacity: 8 },
    ];
    const { toUpdateCapacity } = diffSlotAssignments(openWithCap, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'A' },
    ]);
    expect(toUpdateCapacity).toEqual([{ id: 'r1', capacity: null }]);
  });

  it('target change carries the new capacity on the created row without a capacity update', () => {
    const { toCloseIds, toCreate, toUpdateCapacity } = diffSlotAssignments(open, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'B', capacity: 5 },
      { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
    ]);
    expect(toCloseIds).toEqual(['r1']);
    expect(toCreate[0]).toMatchObject({ sku: 'B', capacity: 5 });
    expect(toUpdateCapacity).toEqual([]);
  });
});

describe('validateLayout capacity fields', () => {
  const shelves = [{ shelf: 1, slots: 6, unitsPerSlot: 8 }];

  it('accepts shelf unitsPerSlot and per-slot capacity', () => {
    expect(validateLayout(shelves, [
      { shelf: 1, position: 0, targetType: 'sku', sku: 'A', capacity: 12 },
    ])).toEqual([]);
  });

  it('rejects out-of-range unitsPerSlot and capacity', () => {
    const errors = validateLayout(
      [{ shelf: 1, slots: 6, unitsPerSlot: 0 }, { shelf: 2, slots: 4 }],
      [{ shelf: 2, position: 0, targetType: 'sku', sku: 'A', capacity: 1000 }],
    );
    expect(errors.some((e) => e.includes('unitsPerSlot'))).toBe(true);
    expect(errors.some((e) => e.includes('capacity'))).toBe(true);
  });
});

describe('resolveSlotCapacity / buildPlanogramScope', () => {
  const shelves = [
    { shelf: 1, slots: 6, unitsPerSlot: 8 },
    { shelf: 2, slots: 4 }, // no shelf default
  ];
  const byNumber = new Map(shelves.map((s) => [s.shelf, s]));

  it('per-slot override wins, then shelf default, then null', () => {
    expect(resolveSlotCapacity({ shelf: 1, capacity: 3 }, byNumber)).toBe(3);
    expect(resolveSlotCapacity({ shelf: 1 }, byNumber)).toBe(8);
    expect(resolveSlotCapacity({ shelf: 2 }, byNumber)).toBe(null);
  });

  it('builds sku/mealType sets and sums capacity across a target\'s slots', () => {
    const scope = buildPlanogramScope([
      { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: null },
      { shelf: 1, position: 1, targetType: 'sku', sku: 'COKE', capacity: 10 },
      { shelf: 1, position: 2, targetType: 'mealType', mealType: 'Meat', capacity: null },
    ], shelves);
    expect([...scope.skuSet]).toEqual(['COKE']);
    expect([...scope.mealTypeSet]).toEqual(['Meat']);
    expect(scope.capacityByTarget.get('sku:COKE')).toBe(18); // 8 (shelf) + 10 (override)
    expect(scope.capacityByTarget.get('mealType:Meat')).toBe(8);
    expect(scope.slotCountByTarget.get('sku:COKE')).toBe(2);
  });

  it('any unresolvable slot poisons the target capacity to null (order matters not)', () => {
    const scope = buildPlanogramScope([
      { shelf: 2, position: 0, targetType: 'sku', sku: 'COKE', capacity: null }, // unknown first
      { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: 10 },
      { shelf: 1, position: 1, targetType: 'sku', sku: 'JUICE', capacity: 6 },
      { shelf: 2, position: 1, targetType: 'sku', sku: 'JUICE', capacity: null }, // unknown last
    ], shelves);
    expect(scope.capacityByTarget.get('sku:COKE')).toBe(null);
    expect(scope.capacityByTarget.get('sku:JUICE')).toBe(null);
    expect(scope.skuSet.has('COKE')).toBe(true); // still in scope, just unknown capacity
  });

  it('targetKey distinguishes sku and mealType targets', () => {
    expect(targetKey({ targetType: 'sku', sku: 'A' })).toBe('sku:A');
    expect(targetKey({ targetType: 'mealType', mealType: 'Meat' })).toBe('mealType:Meat');
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
      parents: [],
    });
  });
});

describe('parent (product family) slots', () => {
  it('validateLayout accepts parent targets and requires parentId', () => {
    const shelves = [{ shelf: 1, slots: 4 }];
    expect(validateLayout(shelves, [
      { shelf: 1, position: 0, targetType: 'parent', parentId: 'p1' },
    ])).toEqual([]);
    const errors = validateLayout(shelves, [
      { shelf: 1, position: 0, targetType: 'parent' },
    ]);
    expect(errors.some((e) => e.includes("requires a parentId"))).toBe(true);
  });

  it('targetKey and diffSlotAssignments treat parentId as the identity', () => {
    expect(targetKey({ targetType: 'parent', parentId: 'p1' })).toBe('parent:p1');
    const open = [{ id: 'row1', shelf: 1, position: 0, targetType: 'parent', parentId: 'p1', capacity: null }];
    // same parent — no churn
    const same = diffSlotAssignments(open, [{ shelf: 1, position: 0, targetType: 'parent', parentId: 'p1' }]);
    expect(same.toCloseIds).toEqual([]);
    expect(same.toCreate).toEqual([]);
    // different parent — history cycles and parentId lands on the new row
    const moved = diffSlotAssignments(open, [{ shelf: 1, position: 0, targetType: 'parent', parentId: 'p2' }]);
    expect(moved.toCloseIds).toEqual(['row1']);
    expect(moved.toCreate[0].parentId).toBe('p2');
    expect(moved.toCreate[0].sku).toBeNull();
  });

  it('buildPlanogramScope exposes parentSet and family capacity', () => {
    const scope = buildPlanogramScope(
      [
        { shelf: 1, position: 0, targetType: 'parent', parentId: 'p1', capacity: null },
        { shelf: 1, position: 1, targetType: 'parent', parentId: 'p1', capacity: 10 },
        { shelf: 1, position: 2, targetType: 'sku', sku: 'COKE', capacity: null },
      ],
      [{ shelf: 1, slots: 6, unitsPerSlot: 8 }],
    );
    expect([...scope.parentSet]).toEqual(['p1']);
    expect(scope.capacityByTarget.get('parent:p1')).toBe(18); // 8 + 10
    expect(scope.skuSet.has('COKE')).toBe(true);
  });

  it('detectStale flags a parent slot when the family has no members here', () => {
    const out = detectStale(
      [{ targetType: 'parent', parentId: 'p1' }, { targetType: 'parent', parentId: 'p2' }],
      new Set(),
      new Map(),
      new Map([['p1', 2]]),
    );
    expect(out[0].stale).toBe(false);
    expect(out[1].stale).toBe(true);
  });

  it('computeUnplaced counts family members as placed via own slot OR parent slot', () => {
    const products = [
      { sku: 'BB-CHOC', isFreshMeal: false, parentId: 'p1' },
      { sku: 'BB-CARA', isFreshMeal: false, parentId: 'p1' },
      { sku: 'ED-MOCHA', isFreshMeal: false, parentId: 'p2' },
      { sku: 'COKE', isFreshMeal: false },
    ];
    // p1 covered by parent slot; p2 has nothing; COKE unplaced as before
    const out = computeUnplaced(
      [{ targetType: 'parent', parentId: 'p1' }],
      products,
    );
    expect(out.parents).toEqual(['p2']);
    expect(out.skus).toEqual(['COKE']);
    // p2 covered by a member's own sku slot -> not unplaced
    const covered = computeUnplaced(
      [{ targetType: 'parent', parentId: 'p1' }, { targetType: 'sku', sku: 'ED-MOCHA' }],
      products,
    );
    expect(covered.parents).toEqual([]);
  });

  it('buildRestockSheetRows renders a parent slot as a named group row', () => {
    const { rows, totalAdd } = buildRestockSheetRows(
      [
        { shelf: 1, position: 0, slotCode: '1A', targetType: 'parent', parentId: 'p1' },
        { shelf: 1, position: 1, slotCode: '1B', targetType: 'parent', parentId: 'p1' },
      ],
      {
        qtyBySku: new Map(),
        groupQty: new Map(),
        skuMax: new Map(),
        groupMax: new Map(),
        nameBySku: new Map(),
        parentQty: new Map([['p1', 4]]),
        parentMax: new Map([['p1', 12]]),
        parentName: new Map([['p1', 'Barebells']]),
      },
    );
    expect(rows[0].label).toBe('Barebells');
    expect(rows[0].isGroup).toBe(true);
    expect(rows[0].primary).toBe(true);
    expect(rows[0].add).toBe(8);
    expect(rows[1].primary).toBe(false);
    expect(rows[1].primarySlotCode).toBe('1A');
    expect(totalAdd).toBe(8);
  });
});
