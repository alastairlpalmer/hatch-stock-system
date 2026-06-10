import { describe, it, expect } from 'vitest';
import { normalizeWebhookPayload, normalizePollPayload, computeCharged } from './vendlive-sync.js';

describe('computeCharged', () => {
  it('uses totalPaid when present', () => {
    expect(computeCharged({ totalPaid: 1.8, price: 2.0, discountValue: 0.2 })).toBe(1.8);
  });

  it('returns 0 for a 100% discounted (free) vend instead of full price', () => {
    expect(computeCharged({ totalPaid: 0, price: 2.5, discountValue: 2.5 })).toBe(0);
  });

  it('subtracts partial discounts when totalPaid is missing', () => {
    expect(computeCharged({ totalPaid: 0, price: 3.0, discountValue: 1.0 })).toBe(2.0);
  });

  it('never goes negative when discount exceeds price', () => {
    expect(computeCharged({ totalPaid: 0, price: 2.0, discountValue: 5.0 })).toBe(0);
  });

  it('falls back to price when totalPaid and discount are absent', () => {
    expect(computeCharged({ totalPaid: 0, price: 2.2, discountValue: 0 })).toBe(2.2);
  });
});

describe('normalizeWebhookPayload', () => {
  const body = {
    id: '12345',
    machine: 'Front Lobby',
    location_name: 'Head Office',
    charged: '2.50',
    created_at: '2026-06-09T10:00:00Z',
    order_product_sales: [
      {
        id: '777',
        product_external_id: 'SKU-1',
        machine_id: '42',
        vend_status_name: 'Success',
        timestamp: '2026-06-09T10:00:01Z',
        price: '2.50',
        cost_price: '1.10',
        total_paid: '2.50',
        discount_value: '0',
        is_refunded: false,
      },
    ],
  };

  it('parses ids as integers (including machine_id strings)', () => {
    const result = normalizeWebhookPayload(body);
    expect(result.orderSaleId).toBe(12345);
    expect(result.items[0].productSaleId).toBe(777);
    expect(result.items[0].machineId).toBe(42);
  });

  it('maps snake_case money fields to numbers', () => {
    const item = normalizeWebhookPayload(body).items[0];
    expect(item.price).toBe(2.5);
    expect(item.costPrice).toBe(1.1);
    expect(item.totalPaid).toBe(2.5);
  });

  it('handles a missing machine_id without throwing', () => {
    const noMachine = {
      ...body,
      order_product_sales: [{ ...body.order_product_sales[0], machine_id: undefined }],
    };
    expect(normalizeWebhookPayload(noMachine).items[0].machineId).toBeNull();
  });

  it('handles an empty order_product_sales array', () => {
    expect(normalizeWebhookPayload({ id: '1' }).items).toEqual([]);
  });
});

describe('normalizePollPayload', () => {
  const entry = {
    id: 9001,
    machine: { id: 42, friendlyName: 'Front Lobby' },
    locationName: 'Head Office',
    charged: 2.5,
    createdAt: '2026-06-09T10:00:00Z',
    productSales: [
      {
        id: 555,
        product: { id: 10, name: 'Cola Can', externalId: 'SKU-1', category: { name: 'Drinks' } },
        vendStatus: 'Success',
        timestamp: '2026-06-09T10:00:01Z',
        price: 2.5,
        costPrice: 1.1,
        totalPaid: 2.5,
        isRefunded: false,
      },
    ],
  };

  it('extracts machine info from the machine object', () => {
    const result = normalizePollPayload(entry);
    expect(result.machineName).toBe('Front Lobby');
    expect(result.machineVendliveId).toBe(42);
    expect(result.items[0].machineId).toBe(42);
  });

  it('prefers product.externalId as the SKU, falling back to product.id', () => {
    expect(normalizePollPayload(entry).items[0].productExternalId).toBe('SKU-1');

    const noExternal = {
      ...entry,
      productSales: [{ ...entry.productSales[0], product: { id: 10, name: 'Cola Can' } }],
    };
    expect(normalizePollPayload(noExternal).items[0].productExternalId).toBe('10');
  });

  it('reads vendStatus from any of the three naming variants', () => {
    const variants = [
      { vendStatus: 'Success' },
      { vendStatusName: 'Success' },
      { vend_status_name: 'Success' },
    ];
    for (const v of variants) {
      const e = { ...entry, productSales: [{ ...entry.productSales[0], vendStatus: undefined, ...v }] };
      expect(normalizePollPayload(e).items[0].vendStatusName).toBe('Success');
    }
  });

  it('preserves isRefunded=false explicitly (?? not ||)', () => {
    const e = { ...entry, productSales: [{ ...entry.productSales[0], isRefunded: false }] };
    expect(normalizePollPayload(e).items[0].isRefunded).toBe(false);
  });

  it('handles machine as a plain string', () => {
    const e = { ...entry, machine: 'Kiosk 3' };
    expect(normalizePollPayload(e).machineName).toBe('Kiosk 3');
  });
});
