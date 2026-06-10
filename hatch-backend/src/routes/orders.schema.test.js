import { describe, it, expect } from 'vitest';
import { orderUpdateSchema } from './orders.js';

describe('orderUpdateSchema (PUT /orders/:id)', () => {
  it('accepts the exact payload shape the Edit form sends and keeps the items', () => {
    // Mirrors Orders.jsx submit(): extra fields (id, deliveryType, subtotal,
    // lineTotal, …) must be stripped, not rejected — and items must survive.
    const parsed = orderUpdateSchema.parse({
      id: '1718000000000',
      supplierId: 'sup-1',
      deliveryMethod: 'standard',
      deliveryType: 'warehouse',
      warehouseId: 'wh-1',
      customAddress: null,
      items: [
        { sku: 'SKU-1', quantity: 10, unitPrice: 1.5, lineTotal: 15 },
        { sku: 'SKU-2', quantity: 3, unitPrice: 0, lineTotal: 0 },
      ],
      expectedDate: '2026-06-20',
      deliveryFee: 4.99,
      subtotal: 15,
      total: 19.99,
      notes: '',
      invoiceRef: 'INV-42',
      invoiceImage: null,
      status: 'pending',
      createdAt: '2026-06-10T08:00:00Z',
      updatedAt: '2026-06-10T09:00:00Z',
    });

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toEqual({ sku: 'SKU-1', quantity: 10, unitPrice: 1.5 });
    expect(parsed.deliveryFee).toBe(4.99);
    expect(parsed).not.toHaveProperty('subtotal');
    expect(parsed.items[1]).not.toHaveProperty('lineTotal');
  });

  it('allows a metadata-only update with no items field', () => {
    const parsed = orderUpdateSchema.parse({ notes: 'call ahead', invoiceRef: 'INV-7' });
    expect(parsed.items).toBeUndefined();
    expect(parsed.notes).toBe('call ahead');
  });

  it('coerces string quantities/prices from form inputs', () => {
    const parsed = orderUpdateSchema.parse({
      items: [{ sku: 'SKU-1', quantity: '7', unitPrice: '2.50' }],
    });
    expect(parsed.items[0].quantity).toBe(7);
    expect(parsed.items[0].unitPrice).toBe(2.5);
  });

  it('rejects zero/negative quantities and empty item lists', () => {
    expect(() => orderUpdateSchema.parse({ items: [{ sku: 'SKU-1', quantity: 0 }] })).toThrow();
    expect(() => orderUpdateSchema.parse({ items: [{ sku: 'SKU-1', quantity: -2 }] })).toThrow();
    expect(() => orderUpdateSchema.parse({ items: [] })).toThrow();
  });

  it('rejects an unknown status', () => {
    expect(() => orderUpdateSchema.parse({ status: 'archived' })).toThrow();
  });
});
