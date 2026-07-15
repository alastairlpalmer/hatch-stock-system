import { describe, it, expect } from 'vitest';
import { savePlanogramSchema } from './planogram.js';

describe('savePlanogramSchema', () => {
  it('accepts a valid document', () => {
    const parsed = savePlanogramSchema.parse({
      shelves: [{ shelf: 1, slots: 6 }],
      assignments: [
        { shelf: 1, position: 0, targetType: 'sku', sku: 'ABC' },
        { shelf: 1, position: 1, targetType: 'mealType', mealType: 'Meat' },
      ],
    });
    expect(parsed.shelves).toHaveLength(1);
    expect(parsed.assignments).toHaveLength(2);
  });

  it('accepts an empty assignments list (layout only)', () => {
    expect(() =>
      savePlanogramSchema.parse({ shelves: [{ shelf: 1, slots: 6 }], assignments: [] })
    ).not.toThrow();
  });

  it('rejects missing shelves', () => {
    expect(() => savePlanogramSchema.parse({ shelves: [], assignments: [] })).toThrow();
  });

  it('rejects out-of-range facings', () => {
    expect(() =>
      savePlanogramSchema.parse({ shelves: [{ shelf: 1, slots: 27 }], assignments: [] })
    ).toThrow();
    expect(() =>
      savePlanogramSchema.parse({ shelves: [{ shelf: 1, slots: 0 }], assignments: [] })
    ).toThrow();
  });

  it('accepts capacity fields and rejects out-of-range values', () => {
    expect(() =>
      savePlanogramSchema.parse({
        shelves: [{ shelf: 1, slots: 6, unitsPerSlot: 8 }],
        assignments: [{ shelf: 1, position: 0, targetType: 'sku', sku: 'ABC', capacity: 12 }],
      })
    ).not.toThrow();
    expect(() =>
      savePlanogramSchema.parse({
        shelves: [{ shelf: 1, slots: 6, unitsPerSlot: 0 }],
        assignments: [],
      })
    ).toThrow();
    expect(() =>
      savePlanogramSchema.parse({
        shelves: [{ shelf: 1, slots: 6 }],
        assignments: [{ shelf: 1, position: 0, targetType: 'sku', sku: 'ABC', capacity: 1000 }],
      })
    ).toThrow();
  });

  it('rejects target/field mismatches', () => {
    expect(() =>
      savePlanogramSchema.parse({
        shelves: [{ shelf: 1, slots: 6 }],
        assignments: [{ shelf: 1, position: 0, targetType: 'sku' }],
      })
    ).toThrow();
    expect(() =>
      savePlanogramSchema.parse({
        shelves: [{ shelf: 1, slots: 6 }],
        assignments: [{ shelf: 1, position: 0, targetType: 'mealType' }],
      })
    ).toThrow();
  });
});
