import { describe, it, expect } from 'vitest';
import { batchInputFromReceivedItem } from './receiving.js';
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
