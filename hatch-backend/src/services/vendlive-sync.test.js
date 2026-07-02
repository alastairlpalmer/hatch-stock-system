import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/db.js', () => ({
  default: {
    product: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    sale: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), createMany: vi.fn() },
    vendliveMachineMapping: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    vendliveQuarantinedSale: { upsert: vi.fn() },
    locationStock: { upsert: vi.fn(), updateMany: vi.fn() },
    vendliveConfig: { findUnique: vi.fn(), update: vi.fn() },
    vendliveSyncLog: { create: vi.fn() },
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));

import prisma from '../utils/db.js';
import {
  normalizeWebhookPayload,
  normalizePollPayload,
  computeCharged,
  computeProductPriceUpdates,
  processVendliveOrder,
  resolveSalesMachineMapping,
} from './vendlive-sync.js';

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

describe('computeProductPriceUpdates', () => {
  const item = (overrides = {}) => ({
    productExternalId: 'SKU-1',
    productSaleId: 1,
    timestamp: '2026-06-09T10:00:00Z',
    price: 2.5,
    costPrice: 1.1,
    discountValue: 0,
    ...overrides,
  });
  const mapOf = (products) => new Map(products.map(p => [p.sku, p]));

  it('returns nothing when catalog already matches', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    expect(computeProductPriceUpdates([item()], products)).toEqual([]);
  });

  it('updates both fields when the sale disagrees with the catalog (Müller bug shape: swapped values)', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 1.0, unitCost: 2.5 }]);
    expect(computeProductPriceUpdates([item({ price: 2.5, costPrice: 1.0 })], products)).toEqual([
      { sku: 'SKU-1', data: { salePrice: 2.5, unitCost: 1.0 } },
    ]);
  });

  it('fills null salePrice/unitCost', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: null, unitCost: null }]);
    expect(computeProductPriceUpdates([item()], products)).toEqual([
      { sku: 'SKU-1', data: { salePrice: 2.5, unitCost: 1.1 } },
    ]);
  });

  it('uses the newest sale per SKU, not the first', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    const items = [
      item({ timestamp: '2026-06-09T12:00:00Z', price: 2.99, productSaleId: 2 }),
      item({ timestamp: '2026-06-09T10:00:00Z', price: 2.5, productSaleId: 1 }),
    ];
    expect(computeProductPriceUpdates(items, products)).toEqual([
      { sku: 'SKU-1', data: { salePrice: 2.99 } },
    ]);
  });

  it('breaks timestamp ties by productSaleId', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    const items = [
      item({ productSaleId: 7, price: 3.5 }),
      item({ productSaleId: 3, price: 3.0 }),
    ];
    expect(computeProductPriceUpdates(items, products)).toEqual([
      { sku: 'SKU-1', data: { salePrice: 3.5 } },
    ]);
  });

  it('keeps the list price for discounted/free vends (price field is pre-discount)', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.0, unitCost: 1.1 }]);
    const free = item({ price: 2.5, discountValue: 2.5, totalPaid: 0 });
    expect(computeProductPriceUpdates([free], products)).toEqual([
      { sku: 'SKU-1', data: { salePrice: 2.5 } },
    ]);
  });

  it('never overwrites with zero or missing values', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    expect(computeProductPriceUpdates([item({ price: 0, costPrice: 0 })], products)).toEqual([]);
  });

  it('ignores float noise within the epsilon', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    expect(computeProductPriceUpdates([item({ price: 2.5004, costPrice: 1.0996 })], products)).toEqual([]);
  });

  it('skips items whose SKU is not in the product map', () => {
    const products = mapOf([{ sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 }]);
    expect(computeProductPriceUpdates([item({ productExternalId: 'UNKNOWN' })], products)).toEqual([]);
    expect(computeProductPriceUpdates([item({ productExternalId: null })], products)).toEqual([]);
  });

  it('handles multiple SKUs independently', () => {
    const products = mapOf([
      { sku: 'SKU-1', salePrice: 2.5, unitCost: 1.1 },
      { sku: 'SKU-2', salePrice: 4.0, unitCost: null },
    ]);
    const items = [item(), item({ productExternalId: 'SKU-2', price: 4.0, costPrice: 2.2 })];
    expect(computeProductPriceUpdates(items, products)).toEqual([
      { sku: 'SKU-2', data: { unitCost: 2.2 } },
    ]);
  });
});

// ============ DB-BACKED PATHS (mocked prisma) ============

const location = { id: 'loc-1', name: 'Site A' };

const mappingRow = (overrides = {}) => ({
  id: 'map-1',
  vendliveMachineId: 900,
  salesMachineId: null,
  machineName: 'Front Lobby',
  locationId: location.id,
  autoCreated: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  location,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.product.findUnique.mockResolvedValue(null);
  prisma.product.create.mockResolvedValue({});
  prisma.product.update.mockResolvedValue({});
  prisma.sale.findUnique.mockResolvedValue(null);
  prisma.sale.create.mockResolvedValue({});
  prisma.sale.update.mockResolvedValue({});
  prisma.vendliveMachineMapping.findMany.mockResolvedValue([]);
  prisma.vendliveMachineMapping.findFirst.mockResolvedValue(null);
  prisma.vendliveMachineMapping.create.mockImplementation(({ data }) => Promise.resolve({ id: 'map-new', location: null, ...data }));
  prisma.vendliveMachineMapping.update.mockResolvedValue({});
  prisma.vendliveQuarantinedSale.upsert.mockResolvedValue({});
  prisma.locationStock.upsert.mockResolvedValue({});
  prisma.locationStock.updateMany.mockResolvedValue({ count: 0 });
});

describe('resolveSalesMachineMapping', () => {
  it('prefers the location-mapped row over an unmapped duplicate (last-wins bug)', async () => {
    const unmapped = mappingRow({ id: 'map-dup', vendliveMachineId: 42, salesMachineId: 42, locationId: null, location: null, autoCreated: true });
    const mapped = mappingRow({ salesMachineId: 42 });
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([unmapped, mapped]);

    const result = await resolveSalesMachineMapping('Front Lobby', 42);

    expect(result.id).toBe('map-1');
    expect(result.location).toEqual(location);
    expect(prisma.vendliveMachineMapping.update).not.toHaveBeenCalled();
    expect(prisma.vendliveMachineMapping.create).not.toHaveBeenCalled();
  });

  it('backfills salesMachineId when the chosen row is missing it', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow()]);

    await resolveSalesMachineMapping('Front Lobby', 42);

    expect(prisma.vendliveMachineMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { salesMachineId: 42 },
    });
  });

  it('leaves a row alone when salesMachineId already matches', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow({ salesMachineId: 42 })]);

    await resolveSalesMachineMapping('Front Lobby', 42);

    expect(prisma.vendliveMachineMapping.update).not.toHaveBeenCalled();
  });

  it('creates a new mapping holding the sales id in BOTH id columns', async () => {
    const result = await resolveSalesMachineMapping('New Kiosk', 77);

    expect(prisma.vendliveMachineMapping.create).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        vendliveMachineId: 77,
        salesMachineId: 77,
        machineName: 'New Kiosk',
        autoCreated: true,
      },
    }));
    expect(result.machineName).toBe('New Kiosk');
  });

  it('creates nothing without a machine name or a sales machine id', async () => {
    expect(await resolveSalesMachineMapping(null, 42)).toBeNull();
    expect(await resolveSalesMachineMapping('Front Lobby', null)).toBeNull();
    expect(prisma.vendliveMachineMapping.create).not.toHaveBeenCalled();
  });
});

describe('processVendliveOrder', () => {
  const orderData = (itemOverrides = {}) => ({
    orderSaleId: 100,
    machineName: 'Front Lobby',
    locationName: 'Raw VendLive Name',
    createdAt: '2026-06-09T10:00:00Z',
    items: [{
      productSaleId: 1,
      productExternalId: 'SKU-X',
      machineId: 42,
      vendStatusName: 'Success',
      timestamp: '2026-06-09T10:00:01Z',
      price: 2.5,
      costPrice: 1.1,
      totalPaid: 2.5,
      discountValue: 0,
      isRefunded: false,
      ...itemOverrides,
    }],
  });
  const product = { sku: 'SKU-X', name: 'Cola Can', unitCost: 1.1, salePrice: 2.5 };

  it('quarantines unknown SKUs instead of erroring when auto-create is off', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow({ salesMachineId: 42 })]);

    const result = await processVendliveOrder(orderData(), 'webhook', { autoCreateProducts: false });

    expect(result).toMatchObject({ created: 0, quarantined: 1, errored: 0 });
    expect(result.errors).toEqual([]);
    expect(prisma.sale.create).not.toHaveBeenCalled();
    expect(prisma.vendliveQuarantinedSale.upsert).toHaveBeenCalledTimes(1);

    const call = prisma.vendliveQuarantinedSale.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'vl-100-1' });
    expect(call.create).toMatchObject({
      id: 'vl-100-1',
      vendliveOrderSaleId: 100,
      vendliveProductSaleId: 1,
      reason: 'unknown_sku',
      sku: 'SKU-X',
      machineName: 'Front Lobby',
    });
    // Payload is the ready-to-insert Sale row, resolved to the MAPPED location name
    expect(call.create.payload).toMatchObject({
      id: 'vl-100-1',
      sku: 'SKU-X',
      locationName: 'Site A',
      syncSource: 'webhook',
    });
  });

  it('restores location stock when a known sale flips to refunded', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow({ salesMachineId: 42 })]);
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.sale.findUnique.mockResolvedValue({ id: 'vl-100-1', isRefunded: false, quantity: 1 });

    const result = await processVendliveOrder(orderData({ isRefunded: true }), 'webhook', {});

    expect(result).toMatchObject({ created: 0, skipped: 1, errored: 0 });
    expect(prisma.sale.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isRefunded: true }),
    }));
    expect(prisma.locationStock.upsert).toHaveBeenCalledWith({
      where: { locationId_sku: { locationId: 'loc-1', sku: 'SKU-X' } },
      create: { locationId: 'loc-1', sku: 'SKU-X', quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
  });

  it('does not touch stock when the refund state is unchanged on re-sync', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow({ salesMachineId: 42 })]);
    prisma.product.findUnique.mockResolvedValue(product);
    prisma.sale.findUnique.mockResolvedValue({ id: 'vl-100-1', isRefunded: true, quantity: 1 });

    await processVendliveOrder(orderData({ isRefunded: true }), 'webhook', {});

    expect(prisma.sale.update).not.toHaveBeenCalled();
    expect(prisma.locationStock.upsert).not.toHaveBeenCalled();
  });

  it('books a new sale against the mapped location and decrements its stock', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow({ salesMachineId: 42 })]);
    prisma.product.findUnique.mockResolvedValue(product);

    const result = await processVendliveOrder(orderData(), 'webhook', {});

    expect(result).toMatchObject({ created: 1, skipped: 0, quarantined: 0, errored: 0 });
    expect(prisma.sale.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: 'vl-100-1', sku: 'SKU-X', locationName: 'Site A' }),
    }));
    // Decrement runs inside a clamp transaction
    expect(prisma.locationStock.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { locationId_sku: { locationId: 'loc-1', sku: 'SKU-X' } },
      update: { quantity: { decrement: 1 } },
    }));
  });

  it('backfills salesMachineId on the mapping from the sale machine id', async () => {
    prisma.vendliveMachineMapping.findMany.mockResolvedValue([mappingRow()]); // salesMachineId null
    prisma.product.findUnique.mockResolvedValue(product);

    await processVendliveOrder(orderData(), 'webhook', {});

    expect(prisma.vendliveMachineMapping.update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { salesMachineId: 42 },
    });
  });
});
