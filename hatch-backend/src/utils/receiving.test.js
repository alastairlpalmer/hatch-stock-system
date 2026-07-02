import { describe, it, expect } from 'vitest';
import { batchInputFromReceivedItem, validateReceiptLines } from './receiving.js';
import { receiveSchema } from '../routes/orders.js';

describe('receiving with an expiry date', () => {
  it('stores the typed expiry on the batch', () => {
    const input = batchInputFromReceivedItem(
      { sku: 'SKU-1', quantity: 12, expiryDate: '2026-09-30' },
      'wh-1',
    );
    expect(input.expiryDate).toBeInstanceOf(Date);
    expect(input.expiryDate.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(input.quantity).toBe(12);
    expect(input.remainingQty).toBe(12);
    expect(input.warehouseId).toBe('wh-1');
  });

  it('passes the expiry through schema validation unchanged', () => {
    const parsed = receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [{ sku: 'SKU-1', quantity: 5, expiryDate: '2026-09-30' }],
    });
    expect(parsed.items[0].expiryDate).toBe('2026-09-30');
  });

  it('rejects an unparseable expiry date', () => {
    expect(() => receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [{ sku: 'SKU-1', quantity: 5, expiryDate: 'not-a-date' }],
    })).toThrow();
  });
});

describe('receiving WITHOUT an expiry date', () => {
  it('does not block sign-in: schema accepts a missing expiry', () => {
    const parsed = receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [{ sku: 'SKU-1', quantity: 5 }],
    });
    expect(parsed.items).toHaveLength(1);
  });

  it.each([undefined, null, ''])('creates the batch with expiryDate null (input: %j)', (expiryDate) => {
    const input = batchInputFromReceivedItem({ sku: 'SKU-1', quantity: 5, expiryDate }, 'wh-1');
    expect(input.expiryDate).toBeNull();
    expect(input.quantity).toBe(5); // item still signed in
  });

  it('preserves damage info regardless of expiry', () => {
    const input = batchInputFromReceivedItem(
      { sku: 'SKU-1', quantity: 5, hasDamage: true, damageNotes: 'crushed box' },
      'wh-1',
    );
    expect(input.hasDamage).toBe(true);
    expect(input.damageNotes).toBe('crushed box');
    expect(input.expiryDate).toBeNull();
  });
});

describe('partial receiving schema', () => {
  it('accepts multiple lines for the same SKU (one per expiry lot)', () => {
    const parsed = receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [
        { sku: 'SKU-1', quantity: 6, expiryDate: '2026-09-30' },
        { sku: 'SKU-1', quantity: 4, expiryDate: '2026-10-15' },
      ],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.closeShort).toBeUndefined();
  });

  it('accepts closeShort and receivedBy', () => {
    const parsed = receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [{ sku: 'SKU-1', quantity: 5 }],
      closeShort: true,
      receivedBy: 'Alastair',
    });
    expect(parsed.closeShort).toBe(true);
    expect(parsed.receivedBy).toBe('Alastair');
  });

  it('rejects a non-boolean closeShort', () => {
    expect(() => receiveSchema.parse({
      warehouseId: 'wh-1',
      items: [{ sku: 'SKU-1', quantity: 5 }],
      closeShort: 'yes',
    })).toThrow();
  });
});

describe('validateReceiptLines', () => {
  const orderItems = [
    { id: 'oi-1', sku: 'SKU-1', quantity: 10, receivedQty: 0 },
    { id: 'oi-2', sku: 'SKU-2', quantity: 4, receivedQty: 0 },
  ];

  it('sums multiple lots of the same SKU and accepts when within the ordered quantity', () => {
    const { sums, error } = validateReceiptLines(orderItems, [
      { sku: 'SKU-1', quantity: 6, expiryDate: '2026-09-30' },
      { sku: 'SKU-1', quantity: 4, expiryDate: '2026-10-15' },
      { sku: 'SKU-2', quantity: 1 },
    ]);
    expect(error).toBeNull();
    expect(sums.get('SKU-1')).toBe(10);
    expect(sums.get('SKU-2')).toBe(1);
  });

  it('rejects when the per-SKU SUM over-receives, naming the sku', () => {
    const { error } = validateReceiptLines(orderItems, [
      { sku: 'SKU-1', quantity: 6 },
      { sku: 'SKU-1', quantity: 5 },
    ]);
    expect(error).toMatch(/SKU-1/);
    expect(error).toMatch(/exceeds outstanding/);
  });

  it('counts earlier receipts: only the outstanding quantity may be received', () => {
    const partiallyReceived = [{ id: 'oi-1', sku: 'SKU-1', quantity: 10, receivedQty: 7 }];
    expect(validateReceiptLines(partiallyReceived, [{ sku: 'SKU-1', quantity: 3 }]).error).toBeNull();
    expect(validateReceiptLines(partiallyReceived, [{ sku: 'SKU-1', quantity: 4 }]).error).toMatch(/SKU-1/);
  });

  it('rejects a SKU that is not on the order', () => {
    const { error } = validateReceiptLines(orderItems, [{ sku: 'SKU-9', quantity: 1 }]);
    expect(error).toBe('SKU SKU-9 is not on this order');
  });

  it('maps each sku to its order item for the guarded increment', () => {
    const { itemBySku, error } = validateReceiptLines(orderItems, [{ sku: 'SKU-2', quantity: 4 }]);
    expect(error).toBeNull();
    expect(itemBySku.get('SKU-2').id).toBe('oi-2');
  });
});
