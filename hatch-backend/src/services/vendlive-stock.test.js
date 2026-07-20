import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/db.js', () => ({
  default: {
    locationStock: { updateMany: vi.fn() },
  },
}));

import prisma from '../utils/db.js';
import {
  parseRestockTypes,
  isRestockMovement,
  clearDelistedRows,
  extractChannelSkus,
  hasPlanogramDrift,
} from './vendlive-stock.js';

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

describe('extractChannelSkus', () => {
  it('uses externalId, falling back to the VendLive product id', () => {
    const skus = extractChannelSkus([
      { product: { externalId: 'SKU-1', id: 10 } },
      { product: { id: 20 } },
    ]);
    expect([...skus].sort()).toEqual(['20', 'SKU-1']);
  });

  it('skips channels with no product and dedupes multi-channel SKUs', () => {
    const skus = extractChannelSkus([
      { product: { externalId: 'SKU-1' } },
      { product: { externalId: 'SKU-1' } },
      { product: null },
      {},
    ]);
    expect([...skus]).toEqual(['SKU-1']);
  });

  it('handles null/empty channel lists', () => {
    expect(extractChannelSkus(null).size).toBe(0);
    expect(extractChannelSkus([]).size).toBe(0);
  });
});

describe('hasPlanogramDrift', () => {
  const stored = [
    { sku: 'SKU-1', idealCapacity: 5 },
    { sku: 'SKU-2', idealCapacity: 3 },
  ];

  it('no drift when the live set matches the stored snapshot', () => {
    expect(hasPlanogramDrift(new Set(['SKU-1', 'SKU-2']), stored)).toBe(false);
  });

  it('drifts when a product was added to the planogram', () => {
    expect(hasPlanogramDrift(new Set(['SKU-1', 'SKU-2', 'SKU-NEW']), stored)).toBe(true);
  });

  it('drifts when a product was removed from the planogram', () => {
    expect(hasPlanogramDrift(new Set(['SKU-1']), stored)).toBe(true);
  });

  it('drifts on a same-size swap (one out, one in)', () => {
    expect(hasPlanogramDrift(new Set(['SKU-1', 'SKU-3']), stored)).toBe(true);
  });

  it('never drifts on an empty probe (API hiccup guard)', () => {
    expect(hasPlanogramDrift(new Set(), stored)).toBe(false);
    expect(hasPlanogramDrift(null, stored)).toBe(false);
  });

  it('drifts when the machine has never been mirrored (null/garbage snapshot)', () => {
    expect(hasPlanogramDrift(new Set(['SKU-1']), null)).toBe(true);
    expect(hasPlanogramDrift(new Set(['SKU-1']), 'garbage')).toBe(true);
  });

  it('ignores malformed stored entries rather than counting them', () => {
    const messy = [{ sku: 'SKU-1' }, null, { sku: '' }, { notSku: 'x' }];
    expect(hasPlanogramDrift(new Set(['SKU-1']), messy)).toBe(false);
  });
});
