import { describe, it, expect } from 'vitest';
import { supplierCreateSchema, supplierUpdateSchema } from './suppliers.js';

describe('supplierCreateSchema', () => {
  it('accepts a full supplier with ordering config', () => {
    const parsed = supplierCreateSchema.parse({
      name: 'Frive',
      email: 'orders@frive.example',
      orderDays: ['wed', 'thu'],
      leadTimeDays: 3,
      minOrderValue: 150,
    });
    expect(parsed.orderDays).toEqual(['wed', 'thu']);
    expect(parsed.leadTimeDays).toBe(3);
    expect(parsed.minOrderValue).toBe(150);
  });

  it('rejects unknown weekday names', () => {
    expect(() =>
      supplierCreateSchema.parse({ name: 'X', orderDays: ['wednesday'] })
    ).toThrow();
  });

  it('rejects lead time out of range and negative minimums', () => {
    expect(() => supplierCreateSchema.parse({ name: 'X', leadTimeDays: 31 })).toThrow();
    expect(() => supplierCreateSchema.parse({ name: 'X', leadTimeDays: -1 })).toThrow();
    expect(() => supplierCreateSchema.parse({ name: 'X', minOrderValue: -5 })).toThrow();
  });

  it('coerces numeric strings (form inputs)', () => {
    const parsed = supplierCreateSchema.parse({ name: 'X', leadTimeDays: '2', minOrderValue: '99.5' });
    expect(parsed.leadTimeDays).toBe(2);
    expect(parsed.minOrderValue).toBe(99.5);
  });

  it('requires a name', () => {
    expect(() => supplierCreateSchema.parse({ orderDays: ['mon'] })).toThrow();
  });
});

describe('supplierUpdateSchema', () => {
  it('accepts partial updates and explicit nulls to clear config', () => {
    const parsed = supplierUpdateSchema.parse({
      orderDays: null,
      leadTimeDays: null,
      minOrderValue: null,
    });
    expect(parsed.orderDays).toBeNull();
    expect(parsed.leadTimeDays).toBeNull();
    expect(parsed.minOrderValue).toBeNull();
  });
});
