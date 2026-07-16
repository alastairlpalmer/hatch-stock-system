import { describe, it, expect } from 'vitest';
import {
  recomputeWarehouseStock,
  consumeBatchesFEFO,
  consumePlannedBatches,
  setWarehouseStockAbsolute,
} from './inventory-stock.js';

// ---- Minimal in-memory Prisma transaction stub -----------------------------
// Implements just the surface these helpers use: stockBatch.aggregate/findMany/
// findUnique/update/updateMany/create and warehouseStock.upsert, honouring the
// orderBy specs the helpers pass (so FEFO / newest-first ordering is actually
// exercised) and the remainingQty gte guard on updateMany (so the guarded
// decrement path is too).

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
      findUnique: async ({ where }) => batches.find((x) => x.id === where.id) || null,
      update: async ({ where, data }) => {
        const b = batches.find((x) => x.id === where.id);
        if (data.remainingQty?.decrement != null) b.remainingQty -= data.remainingQty.decrement;
        else if (typeof data.remainingQty === 'number') b.remainingQty = data.remainingQty;
        return b;
      },
      updateMany: async ({ where, data }) => {
        const b = batches.find((x) => x.id === where.id);
        if (!b) return { count: 0 };
        if (where.remainingQty?.gte != null && b.remainingQty < where.remainingQty.gte) return { count: 0 };
        if (data.remainingQty?.decrement != null) b.remainingQty -= data.remainingQty.decrement;
        else if (typeof data.remainingQty === 'number') b.remainingQty = data.remainingQty;
        return { count: 1 };
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

  it('never drives remainingQty negative when the snapshot is stale', async () => {
    // Simulate a concurrent consumer: findMany hands back a STALE view claiming
    // more stock than the batch actually holds, so the first guarded decrement
    // must miss and the retry take only what is really there.
    const tx = makeTx([{ id: 'b1', warehouseId: WH, sku: SKU, remainingQty: 5, expiryDate: new Date('2026-02-01') }]);
    const origFindMany = tx.stockBatch.findMany;
    tx.stockBatch.findMany = async (args) => {
      const res = await origFindMany(args);
      return res.map((b) => ({ ...b, remainingQty: b.remainingQty + 15 }));
    };

    const { consumed, shortfall } = await consumeBatchesFEFO(tx, WH, SKU, 10);
    expect(tx._batches.find((b) => b.id === 'b1').remainingQty).toBe(0);
    expect(consumed).toEqual([expect.objectContaining({ take: 5 })]);
    expect(shortfall).toBe(5);
  });

  it('counts a batch fully drained by a concurrent consumer as shortfall, untouched', async () => {
    const tx = makeTx([{ id: 'b1', warehouseId: WH, sku: SKU, remainingQty: 0, expiryDate: new Date('2026-02-01') }]);
    // Stale view says 8 remaining; the live batch is already empty.
    tx.stockBatch.findMany = async () => [
      { id: 'b1', warehouseId: WH, sku: SKU, remainingQty: 8, expiryDate: new Date('2026-02-01') },
    ];

    const { consumed, shortfall } = await consumeBatchesFEFO(tx, WH, SKU, 8);
    expect(consumed).toEqual([]);
    expect(shortfall).toBe(8);
    expect(tx._batches.find((b) => b.id === 'b1').remainingQty).toBe(0);
  });
});

describe('consumePlannedBatches', () => {
  it('consumes exactly the planned batches when the plan still holds', async () => {
    const tx = makeTx([
      { id: 'early', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-02-01') },
      { id: 'late', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
    ]);
    const plan = [{ batchId: 'early', qty: 15 }, { batchId: 'late', qty: 5 }];
    const { consumed, shortfall, offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 20, plan);
    expect(shortfall).toBe(0);
    expect(offPlanQty).toBe(0);
    expect(tx._batches.find((b) => b.id === 'early').remainingQty).toBe(5);
    expect(tx._batches.find((b) => b.id === 'late').remainingQty).toBe(15);
    expect(consumed).toEqual([
      { batchId: 'early', take: 15 },
      { batchId: 'late', take: 5 },
    ]);
  });

  it('takes less than planned when packedQty was reduced, in plan order', async () => {
    const tx = makeTx([
      { id: 'early', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-02-01') },
      { id: 'late', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
    ]);
    const plan = [{ batchId: 'early', qty: 15 }, { batchId: 'late', qty: 5 }];
    const { offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 10, plan);
    expect(offPlanQty).toBe(0);
    // First planned lot covers the whole reduced quantity.
    expect(tx._batches.find((b) => b.id === 'early').remainingQty).toBe(10);
    expect(tx._batches.find((b) => b.id === 'late').remainingQty).toBe(20);
  });

  it('falls back to FEFO for units a planned batch can no longer cover, reporting offPlanQty', async () => {
    const tx = makeTx([
      // Planned lot was drained to 3 by something else since generation.
      { id: 'planned', warehouseId: WH, sku: SKU, remainingQty: 3, expiryDate: new Date('2026-02-01') },
      { id: 'other', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
    ]);
    const plan = [{ batchId: 'planned', qty: 10 }];
    const { shortfall, offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 10, plan);
    expect(shortfall).toBe(0);
    expect(offPlanQty).toBe(7);
    expect(tx._batches.find((b) => b.id === 'planned').remainingQty).toBe(0);
    expect(tx._batches.find((b) => b.id === 'other').remainingQty).toBe(13);
  });

  it('reports a shortfall when neither the plan nor fallback stock covers it', async () => {
    const tx = makeTx([
      { id: 'planned', warehouseId: WH, sku: SKU, remainingQty: 4, expiryDate: new Date('2026-02-01') },
    ]);
    const plan = [{ batchId: 'planned', qty: 10 }];
    const { shortfall, offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 10, plan);
    expect(shortfall).toBe(6);
    expect(offPlanQty).toBe(0);
  });

  it('treats a missing/deleted planned batch as fallback work', async () => {
    const tx = makeTx([
      { id: 'other', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-03-01') },
    ]);
    const plan = [{ batchId: 'gone', qty: 10 }];
    const { shortfall, offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 10, plan);
    expect(shortfall).toBe(0);
    expect(offPlanQty).toBe(10);
    expect(tx._batches.find((b) => b.id === 'other').remainingQty).toBe(10);
  });

  it('handles an empty or absent plan as pure FEFO', async () => {
    const tx = makeTx([
      { id: 'early', warehouseId: WH, sku: SKU, remainingQty: 20, expiryDate: new Date('2026-02-01') },
    ]);
    const { shortfall, offPlanQty } = await consumePlannedBatches(tx, WH, SKU, 5, undefined);
    expect(shortfall).toBe(0);
    expect(offPlanQty).toBe(5);
    expect(tx._batches.find((b) => b.id === 'early').remainingQty).toBe(15);
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
