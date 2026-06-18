import { describe, it, expect } from 'vitest';
import { transferSchema } from './inventory.js';

describe('transferSchema (POST /inventory/transfers)', () => {
  it('accepts a valid transfer with one item', () => {
    const parsed = transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ sku: 'PROD-001', quantity: 5 }],
    });
    expect(parsed.items).toEqual([{ sku: 'PROD-001', quantity: 5 }]);
    expect(parsed.notes).toBeUndefined();
  });

  it('coerces numeric-string quantities to integers', () => {
    const parsed = transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ sku: 'PROD-001', quantity: '3' }],
    });
    expect(parsed.items[0].quantity).toBe(3);
  });

  it('rejects an empty items list', () => {
    expect(() => transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [],
    })).toThrow();
  });

  it('rejects non-positive quantities', () => {
    expect(() => transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ sku: 'PROD-001', quantity: 0 }],
    })).toThrow();
    expect(() => transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ sku: 'PROD-001', quantity: -2 }],
    })).toThrow();
  });

  it('requires both warehouse ids and a non-empty sku', () => {
    expect(() => transferSchema.parse({ toWarehouseId: 'wh-2', items: [{ sku: 'X', quantity: 1 }] })).toThrow();
    expect(() => transferSchema.parse({ fromWarehouseId: 'wh-1', items: [{ sku: 'X', quantity: 1 }] })).toThrow();
    expect(() => transferSchema.parse({
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ sku: '', quantity: 1 }],
    })).toThrow();
  });
});
