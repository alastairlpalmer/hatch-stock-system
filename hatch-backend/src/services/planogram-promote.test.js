import { describe, it, expect, vi } from 'vitest';

// planogram-promote.js pulls in prisma at module load — stub it out; these
// tests only exercise the pure promotion plan.
vi.mock('../utils/db.js', () => ({ default: {} }));

import { buildPromotionPlan } from './planogram-promote.js';

const currentOpen = [
  { id: 'c1', shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', mealType: null, capacity: null },
  { id: 'c2', shelf: 1, position: 1, targetType: 'sku', sku: 'JUICE', mealType: null, capacity: 6 },
  { id: 'c3', shelf: 2, position: 0, targetType: 'mealType', sku: null, mealType: 'Meat', capacity: null },
];

describe('buildPromotionPlan', () => {
  it('identical draft promotes as a no-op (history untouched)', () => {
    const plan = buildPromotionPlan(currentOpen, {
      shelves: [{ shelf: 1, slots: 6 }, { shelf: 2, slots: 4 }],
      assignments: [
        { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: null },
        { shelf: 1, position: 1, targetType: 'sku', sku: 'JUICE', capacity: 6 },
        { shelf: 2, position: 0, targetType: 'mealType', mealType: 'Meat', capacity: null },
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.toCloseIds).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdateCapacity).toEqual([]);
  });

  it('moved and removed slots cycle exactly those history rows', () => {
    const plan = buildPromotionPlan(currentOpen, {
      shelves: [{ shelf: 1, slots: 6 }, { shelf: 2, slots: 4 }],
      assignments: [
        // COKE moved 1A -> 1C; JUICE unchanged; Meat slot dropped
        { shelf: 1, position: 2, targetType: 'sku', sku: 'COKE', capacity: null },
        { shelf: 1, position: 1, targetType: 'sku', sku: 'JUICE', capacity: 6 },
      ],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.toCloseIds.sort()).toEqual(['c1', 'c3']);
    expect(plan.toCreate).toEqual([
      { shelf: 1, position: 2, slotCode: '1C', targetType: 'sku', sku: 'COKE', mealType: null, capacity: null },
    ]);
  });

  it('capacity-only changes update in place during promotion too', () => {
    const plan = buildPromotionPlan(currentOpen, {
      shelves: [{ shelf: 1, slots: 6 }, { shelf: 2, slots: 4 }],
      assignments: [
        { shelf: 1, position: 0, targetType: 'sku', sku: 'COKE', capacity: 10 }, // was null
        { shelf: 1, position: 1, targetType: 'sku', sku: 'JUICE', capacity: 6 },
        { shelf: 2, position: 0, targetType: 'mealType', mealType: 'Meat', capacity: null },
      ],
    });
    expect(plan.toCloseIds).toEqual([]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toUpdateCapacity).toEqual([{ id: 'c1', capacity: 10 }]);
  });

  it('an empty draft closes everything (a legal, deliberate clear-out)', () => {
    const plan = buildPromotionPlan(currentOpen, {
      shelves: [{ shelf: 1, slots: 6 }],
      assignments: [],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.toCloseIds.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(plan.toCreate).toEqual([]);
  });

  it('rejects an invalid draft document with validation errors', () => {
    const plan = buildPromotionPlan(currentOpen, {
      shelves: [{ shelf: 1, slots: 2 }],
      assignments: [{ shelf: 1, position: 5, targetType: 'sku', sku: 'COKE' }], // out of range
    });
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.toCloseIds).toBeUndefined();
  });
});
