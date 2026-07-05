import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/db.js', () => ({
  default: {
    vendliveMachineMapping: { findMany: vi.fn(), update: vi.fn() },
    locationAssignment: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    locationConfig: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
    product: { findMany: vi.fn() },
    $transaction: vi.fn(async (ops) => ops),
  },
}));

import prisma from '../utils/db.js';
import {
  buildPlanogramEntries,
  computeAssignmentUnion,
  diffAssignments,
  computeMaxStockFills,
  mirrorPlanogramToLocation,
} from './planogram-mirror.js';

describe('buildPlanogramEntries', () => {
  it('sums idealCapacity across a SKU\'s channels and filters unknown SKUs', () => {
    const stock = {
      'COKE-330': { channels: [{ idealCapacity: 8 }, { idealCapacity: 6 }] },
      'GHOST-1': { channels: [{ idealCapacity: 10 }] },
    };
    const { entries, unknownSkuCount } = buildPlanogramEntries(stock, new Set(['COKE-330']));
    expect(entries).toEqual([{ sku: 'COKE-330', idealCapacity: 14 }]);
    expect(unknownSkuCount).toBe(1);
  });

  it('treats missing/garbage capacity as 0 without dropping the SKU', () => {
    const stock = { 'X-1': { channels: [{ idealCapacity: null }, {}, { idealCapacity: 'n/a' }] } };
    const { entries } = buildPlanogramEntries(stock, new Set(['X-1']));
    expect(entries).toEqual([{ sku: 'X-1', idealCapacity: 0 }]);
  });
});

describe('computeAssignmentUnion', () => {
  it('unions across machines, deduped and sorted, tolerating null siblings', () => {
    const union = computeAssignmentUnion([
      [{ sku: 'B', idealCapacity: 4 }, { sku: 'A', idealCapacity: 2 }],
      null,
      [{ sku: 'B', idealCapacity: 6 }, { sku: 'C', idealCapacity: 1 }],
      'garbage',
    ]);
    expect(union).toEqual(['A', 'B', 'C']);
  });
});

describe('diffAssignments', () => {
  it('reports added and removed', () => {
    expect(diffAssignments(['A', 'B'], ['B', 'C'])).toEqual({ added: ['C'], removed: ['A'] });
  });
});

describe('computeMaxStockFills', () => {
  const planograms = [
    [{ sku: 'A', idealCapacity: 6 }, { sku: 'B', idealCapacity: 4 }, { sku: 'F', idealCapacity: 9 }],
    [{ sku: 'A', idealCapacity: 4 }, { sku: 'Z', idealCapacity: 0 }],
  ];

  it('creates rows where none exist, updates only null maxStock, sums across machines', () => {
    const { creates, updates } = computeMaxStockFills(
      planograms,
      [{ sku: 'A', maxStock: null }, { sku: 'B', maxStock: 12 }],
      new Set(),
    );
    expect(updates).toEqual([{ sku: 'A', maxStock: 10 }]); // 6 + 4 across machines
    expect(creates).toEqual([{ sku: 'F', maxStock: 9 }]); // B has manual 12; Z capacity 0
  });

  it('never touches manually-set or manually-cleared (0) maxStock', () => {
    const { creates, updates } = computeMaxStockFills(
      planograms,
      [{ sku: 'A', maxStock: 0 }, { sku: 'B', maxStock: 5 }, { sku: 'F', maxStock: 3 }],
      new Set(),
    );
    expect(creates).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('excludes fresh-meal SKUs from fills', () => {
    const { creates, updates } = computeMaxStockFills(planograms, [], new Set(['F']));
    expect(creates.map((c) => c.sku).sort()).toEqual(['A', 'B']);
    expect(updates).toEqual([]);
  });
});

describe('mirrorPlanogramToLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([]);
    prisma.locationAssignment.findMany.mockResolvedValue([]);
    prisma.locationConfig.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
  });

  it('skips entirely on an empty planogram (never wipes assignments)', async () => {
    const result = await mirrorPlanogramToLocation({
      vendliveMachineId: 1, locationId: 'loc-1', entries: [], rawSkuCount: 0, unknownSkuCount: 0,
    });
    expect(result).toEqual({ mirrored: false, skippedReason: 'empty_planogram' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.vendliveMachineMapping.update).not.toHaveBeenCalled();
  });

  it('skips when no SKU is a known product', async () => {
    const result = await mirrorPlanogramToLocation({
      vendliveMachineId: 1, locationId: 'loc-1', entries: [], rawSkuCount: 3, unknownSkuCount: 3,
    });
    expect(result.mirrored).toBe(false);
    expect(result.skippedReason).toBe('no_known_skus');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('mirrors: union with siblings, delete+create assignments, fills, metadata', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([
      { planogramSkus: [{ sku: 'SIB-1', idealCapacity: 5 }] },
    ]);
    prisma.locationAssignment.findMany.mockResolvedValue([{ sku: 'OLD-1' }, { sku: 'A' }]);

    const result = await mirrorPlanogramToLocation({
      vendliveMachineId: 7,
      locationId: 'loc-1',
      entries: [{ sku: 'A', idealCapacity: 6 }],
      rawSkuCount: 2,
      unknownSkuCount: 1,
    });

    expect(result).toEqual({
      mirrored: true,
      assigned: 2, // A + SIB-1
      added: 1, // SIB-1
      removed: 1, // OLD-1
      unknownSkuCount: 1,
      maxFilled: 2, // A(6) + SIB-1(5) created
      machinesInUnion: 2,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.vendliveMachineMapping.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendliveMachineId: 7 },
    }));
    expect(prisma.locationAssignment.deleteMany).toHaveBeenCalledWith({ where: { locationId: 'loc-1' } });
    expect(prisma.locationAssignment.createMany).toHaveBeenCalledWith({
      data: [{ locationId: 'loc-1', sku: 'A' }, { locationId: 'loc-1', sku: 'SIB-1' }],
      skipDuplicates: true,
    });
  });

  it('update fills carry the maxStock IS NULL write guard', async () => {
    prisma.locationConfig.findMany.mockResolvedValue([{ sku: 'A', maxStock: null }]);
    await mirrorPlanogramToLocation({
      vendliveMachineId: 7,
      locationId: 'loc-1',
      entries: [{ sku: 'A', idealCapacity: 6 }],
      rawSkuCount: 1,
      unknownSkuCount: 0,
    });
    expect(prisma.locationConfig.updateMany).toHaveBeenCalledWith({
      where: { locationId: 'loc-1', sku: 'A', maxStock: null },
      data: { maxStock: 6 },
    });
  });
});
