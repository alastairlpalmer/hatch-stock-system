import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/db.js', () => ({
  default: {
    locationStock: { updateMany: vi.fn() },
  },
}));

import prisma from '../utils/db.js';
import { parseRestockTypes, isRestockMovement, clearDelistedRows } from './vendlive-stock.js';

describe('parseRestockTypes', () => {
  it('splits, trims and lowercases the configured list', () => {
    expect(parseRestockTypes('restock, Refill ,ADDITION')).toEqual(['restock', 'refill', 'addition']);
  });

  it('defaults to "in" when unset and drops empty tokens', () => {
    expect(parseRestockTypes(null)).toEqual(['in']);
    expect(parseRestockTypes('restock,,')).toEqual(['restock']);
  });
});

describe('isRestockMovement', () => {
  const types = parseRestockTypes('restock,refill,addition');

  it('matches exactly regardless of case', () => {
    expect(isRestockMovement('Restock', types)).toBe(true);
    expect(isRestockMovement('REFILL', types)).toBe(true);
  });

  it('matches substrings in both directions', () => {
    // VendLive sends a longer label than the configured token...
    expect(isRestockMovement('Machine Restock', types)).toBe(true);
    // ...or the operator configured a longer phrase than VendLive sends.
    expect(isRestockMovement('add', parseRestockTypes('stock addition'))).toBe(true);
  });

  it('rejects unrelated movement types and empty values', () => {
    expect(isRestockMovement('Sale', types)).toBe(false);
    expect(isRestockMovement('Out', types)).toBe(false);
    expect(isRestockMovement('', types)).toBe(false);
    expect(isRestockMovement(null, types)).toBe(false);
  });

  it('legacy default "In" still matches VendLive "In" movements', () => {
    expect(isRestockMovement('In', parseRestockTypes(undefined))).toBe(true);
  });
});

describe('clearDelistedRows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.locationStock.updateMany.mockResolvedValue({ count: 2 });
  });

  it('zeroes quantity and expiry for rows not in the reported SKU list', async () => {
    const cleared = await clearDelistedRows('loc-1', ['A', 'B']);

    expect(cleared).toBe(2);
    expect(prisma.locationStock.updateMany).toHaveBeenCalledWith({
      where: {
        locationId: 'loc-1',
        sku: { notIn: ['A', 'B'] },
        OR: [{ quantity: { not: 0 } }, { earliestExpiry: { not: null } }],
      },
      data: { quantity: 0, earliestExpiry: null },
    });
  });

  it('does NOT touch the database when the report is empty (API hiccup must not wipe the machine)', async () => {
    expect(await clearDelistedRows('loc-1', [])).toBe(0);
    expect(await clearDelistedRows('loc-1', undefined)).toBe(0);
    expect(prisma.locationStock.updateMany).not.toHaveBeenCalled();
  });
});
