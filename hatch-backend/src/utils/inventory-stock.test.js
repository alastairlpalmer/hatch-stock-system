import { describe, it, expect } from 'vitest';
import {
  recomputeWarehouseStock,
  consumeBatchesFEFO,
  setWarehouseStockAbsolute,
} from './inventory-stock.js';

// ---- Minimal in-memory Prisma transaction stub -----------------------------
// Implements just the surface these helpers use: stockBatch.aggregate/findMany/
// update/create and warehouseStock.upsert, honouring the orderBy specs the
// helpers pass (so FEFO / newest-first ordering is actually exercised).

function sortBatches(batches, orderBy) {
  const specs = orderBy.map((o) => {
    const field = Object.keys(o)[0];
    const v = o[field];
    return typeof v === 'string'
      ? { field, dir: v, nulls: 'last' }
      : { field, dir: v.sort, nulls: v.nulls || 'last' };
  });
  return [...batches].sort((a, b) => {
    for (const { field, dir, nulls } of specs) {
      let av = a[field];
      let bv = b[field];
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull || bNull) {
        if (aNull && bNull) continue;
        return (aNull ? 1 : -1) * (nulls === 'first' ? -1 : 1);
      }
      if (av instanceof Date) av = av.getTime();
      if (bv instanceof Date) bv = bv.getTime();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function makeTx(initial = []) {
  let seq = 0;
  const batches = initial.map((b, i) => ({
    id: b.id || `b${i}`,
    hasDamage: false,
    damageNotes: null,
    receivedAt: b.receivedAt || new Date('2026-01-01'),
    ...b,
  }));
  const warehouseStock = new Map();

  return {
    _batches: batches,
    _stock: warehouseStock,
    stockBatch: {
      aggregate: async ({ where }) => ({
        _sum: {
          remainingQty: batches
            .filter((b) => b.warehouseId === where.warehouseId && b.sku === where.sku)
            .reduce((acc, b) => acc + b.remainingQty, 0),
        },
      }),
      findMany: async ({ where, orderBy }) => {
        let res = batches.filter((b) => b.warehouseId === where.warehouseId && b.sku === where.sku);
        if (where.remainingQty?.gt != null) res = res.filter((b) => b.remainingQty > where.remainingQty.gt);
        return orderBy ? sortBatches(res, orderBy) : res;
      },
      update: async ({ where, data }) => {
        const b = batches.find((x) => x.id === where.id);
        if (data.remainingQty?.decrement != null) b.remainingQty -= data.remainingQty.decrement;
        else if (typeof data.remainingQty === 'number') b.remainingQty = data.remainingQty;
        return b;
      },
      create: async ({ data }) => {
        const b = { id: `new${seq++}`, ...data };
        batches.push(b);
        return b;
      },
    },
    warehouseStock: {
      upsert: async ({ where, update }) => {
        const k = `${where.warehouseId_sku.warehouseId}|${where.warehouseId_sku.sku}`;
        warehouseStock.set(k, update.quantity);
      },
    },
  };
}

const WH = 'wh1';
const SKU = 'SKU-1';
const stockOf = (tx) => tx._stock.get(`${WH}|${SKU}`);

describe('recomputeWarehouseStock', () => {
  it('sets the aggregate to the sum of batch remaining_qty', async () => {
    const tx = makeTx([
      { warehouseId: WH, sku: SKU, remainingQty: 30, expiryDate: new Date('2026-02-01') },
      { warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
    ]);
    const total = await recomputeWarehouseStock(tx, WH, SKU);
    expect(total).toBe(50);
    expect(stockOf(tx)).toBe(50);
  });

  it('is zero when there are no batches', async () => {
    const tx = makeTx([]);
    expect(await recomputeWarehouseStock(tx, WH, SKU)).toBe(0);
    expect(stockOf(tx)).toBe(0);
  });
});

describe('consumeBatchesFEFO', () => {
  it('drains earliest-expiry batches first and reports no shortfall', async () => {
    const tx = makeTx([
      { id: 'late', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
      { id: 'early', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-02-01') },
    ]);
    const { consumed, shortfall } = await consumeBatchesFEFO(tx, WH, SKU, 25);
    expect(shortfall).toBe(0);
    // earliest (early) fully drained, then 5 from late
    expect(tx._batches.find((b) => b.id === 'early').remainingQty).toBe(0);
    expect(tx._batches.find((b) => b.id === 'late').remainingQty).toBe(15);
    expect(consumed[0].batch.id).toBe('early');
  });

  it('reports a shortfall when batches cannot cover the quantity', async () => {
    const tx = makeTx([{ warehouseId: WH, sku: SKU, remainingQty: 10, expiryDate: new Date('2026-02-01') }]);
    const { shortfall } = await consumeBatchesFEFO(tx, WH, SKU, 25);
    expect(shortfall).toBe(15);
  });
});

describe('setWarehouseStockAbsolute', () => {
  it('materialises an increase as a new no-expiry batch', async () => {
    const tx = makeTx([{ warehouseId: WH, sku: SKU, remainingQty: 10, expiryDate: new Date('2026-02-01') }]);
    const total = await setWarehouseStockAbsolute(tx, WH, SKU, 25);
    expect(total).toBe(25);
    expect(stockOf(tx)).toBe(25);
    const added = tx._batches.find((b) => b.remainingQty === 15);
    expect(added).toBeTruthy();
    expect(added.expiryDate).toBeNull();
  });

  it('materialises a decrease by draining newest-expiry first, preserving near-expiry stock', async () => {
    const tx = makeTx([
      { id: 'early', warehouseId: WH, sku: SKU, remainingQty: 10, expiryDate: new Date('2026-02-01') },
      { id: 'late', warehouseId: WH, sku: SKU, remainingQty: 10, expiryDate: new Date('2026-03-01') },
    ]);
    const total = await setWarehouseStockAbsolute(tx, WH, SKU, 12);
    expect(total).toBe(12);
    // 8 removed from the latest-expiry batch; the earliest-expiry batch is intact
    expect(tx._batches.find((b) => b.id === 'late').remainingQty).toBe(2);
    expect(tx._batches.find((b) => b.id === 'early').remainingQty).toBe(10);
  });

  it('clamps a negative target to zero', async () => {
    const tx = makeTx([{ warehouseId: WH, sku: SKU, remainingQty: 10, expiryDate: new Date('2026-02-01') }]);
    const total = await setWarehouseStockAbsolute(tx, WH, SKU, -5);
    expect(total).toBe(0);
    expect(stockOf(tx)).toBe(0);
  });
});
