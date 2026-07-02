import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { categorizeBatchesByExpiry } from '../utils/expiry.js';
import { resolveOrderingConfig, DEFAULT_LEAD_TIME_DAYS, DEFAULT_COVER_DAYS } from '../config/ordering.js';
import {
  recomputeWarehouseStock,
  consumeBatchesFEFO,
  setWarehouseStockAbsolute,
} from '../utils/inventory-stock.js';

const router = express.Router();

// Shared field schemas
const skuSchema = z.string().min(1);
const quantitySchema = z.coerce.number().int();
const nonNegativeQty = quantitySchema.refine(v => v >= 0, { message: 'quantity must be >= 0' });
const positiveQty = quantitySchema.refine(v => v > 0, { message: 'quantity must be > 0' });

// ============ WAREHOUSE STOCK ============

// Get all warehouse stock
router.get('/warehouse', asyncHandler(async (req, res) => {
  const { warehouseId } = req.query;

  const where = warehouseId ? { warehouseId } : {};

  const stock = await prisma.warehouseStock.findMany({
    where,
    include: {
      product: true,
      warehouse: { select: { id: true, name: true } },
    },
  });

  // Group by warehouse
  const grouped = {};
  stock.forEach(s => {
    if (!grouped[s.warehouseId]) {
      grouped[s.warehouseId] = {};
    }
    grouped[s.warehouseId][s.sku] = s.quantity;
  });

  res.json(grouped);
}));

// Update warehouse stock
const warehouseUpdateSchema = z.object({
  warehouseId: z.string().min(1),
  sku: skuSchema,
  quantity: quantitySchema,
  isDelta: z.boolean().optional().default(true),
});

router.post('/warehouse/update', asyncHandler(async (req, res) => {
  const { warehouseId, sku, quantity, isDelta } = warehouseUpdateSchema.parse(req.body);

  // Batches are authoritative — a delta or absolute set is materialised as batch
  // changes (see setWarehouseStockAbsolute), then the aggregate is recomputed.
  const total = await prisma.$transaction(async (tx) => {
    let target = quantity;
    if (isDelta) {
      const agg = await tx.stockBatch.aggregate({ where: { warehouseId, sku }, _sum: { remainingQty: true } });
      target = (agg._sum.remainingQty || 0) + quantity;
    }
    return setWarehouseStockAbsolute(tx, warehouseId, sku, target);
  });

  res.json({ warehouseId, sku, quantity: total });
}));

// Bulk update warehouse stock (absolute quantities)
const warehouseBulkSchema = z.object({
  warehouseId: z.string().min(1),
  items: z.array(z.object({ sku: skuSchema, quantity: nonNegativeQty })),
});

router.post('/warehouse/bulk', asyncHandler(async (req, res) => {
  const { warehouseId, items } = warehouseBulkSchema.parse(req.body);

  // Each absolute set reconciles to batches. Chunk into separate transactions so
  // a large CSV import doesn't hold one long-running transaction open.
  const CHUNK = 25;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const item of chunk) {
        await setWarehouseStockAbsolute(tx, warehouseId, item.sku, item.quantity, 'CSV import adjustment');
      }
    });
  }

  res.json({ updated: items.length, errors: [] });
}));

// ============ WAREHOUSE-TO-WAREHOUSE TRANSFERS ============

export const transferSchema = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  items: z.array(z.object({ sku: skuSchema, quantity: positiveQty })).min(1),
  notes: z.string().optional(),
  performedBy: z.string().optional(),
});

// Record a transfer of stock between two warehouses (atomic).
router.post('/transfers', asyncHandler(async (req, res) => {
  const { fromWarehouseId, toWarehouseId, items, notes, performedBy } =
    transferSchema.parse(req.body);

  if (fromWarehouseId === toWarehouseId) {
    return res.status(400).json({ error: 'Source and destination warehouses must differ' });
  }

  try {
    const transfer = await prisma.$transaction(async (tx) => {
      // Pre-check source stock: reject the whole transfer if any SKU is short
      // rather than silently losing product when batches are drained.
      for (const { sku, quantity } of items) {
        const source = await tx.warehouseStock.findUnique({
          where: { warehouseId_sku: { warehouseId: fromWarehouseId, sku } },
        });
        const available = source?.quantity ?? 0;
        if (available < quantity) {
          const err = new Error(
            `Insufficient stock for ${sku} at source: have ${available}, need ${quantity}`
          );
          err.status = 400;
          throw err;
        }
      }

      for (const { sku, quantity } of items) {
        // Move actual batches FEFO from source to destination so expiry travels
        // with the stock (the destination batches keep the original expiry, damage
        // flags and received date). Both aggregates are then recomputed from
        // batches.
        const { consumed, shortfall } = await consumeBatchesFEFO(tx, fromWarehouseId, sku, quantity);
        // The aggregate pre-check passed, but the batches themselves are the
        // source of truth — if they can't cover the quantity (drift or a
        // concurrent consumer), roll the transfer back rather than moving
        // stock that doesn't exist.
        if (shortfall > 0) {
          const err = new Error('Insufficient warehouse stock');
          err.status = 400;
          err.shortfalls = [{ sku, requested: quantity, available: quantity - shortfall }];
          throw err;
        }
        for (const { batch, take } of consumed) {
          await tx.stockBatch.create({
            data: {
              warehouseId: toWarehouseId,
              sku,
              quantity: take,
              remainingQty: take,
              expiryDate: batch.expiryDate,
              hasDamage: batch.hasDamage,
              damageNotes: batch.damageNotes,
              receivedAt: batch.receivedAt,
            },
          });
        }
        await recomputeWarehouseStock(tx, fromWarehouseId, sku);
        await recomputeWarehouseStock(tx, toWarehouseId, sku);
      }

      return tx.stockTransfer.create({
        data: { fromWarehouseId, toWarehouseId, items, notes, performedBy },
      });
    });

    res.json(transfer);
  } catch (err) {
    if (err.shortfalls) {
      return res.status(400).json({ error: 'Insufficient warehouse stock', shortfalls: err.shortfalls });
    }
    throw err;
  }
}));

// List recent transfers (optionally filtered to a warehouse, either side).
router.get('/transfers', asyncHandler(async (req, res) => {
  const { warehouseId } = req.query;

  const where = warehouseId
    ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }
    : {};

  const transfers = await prisma.stockTransfer.findMany({
    where,
    include: {
      fromWarehouse: { select: { id: true, name: true } },
      toWarehouse: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(transfers);
}));

// ============ LOCATION STOCK ============

// Get location stock
router.get('/locations/:id', asyncHandler(async (req, res) => {
  const stock = await prisma.locationStock.findMany({
    where: { locationId: req.params.id },
    include: { product: true },
  });

  // Return as { sku: quantity }
  const stockMap = {};
  stock.forEach(s => {
    stockMap[s.sku] = s.quantity;
  });

  res.json(stockMap);
}));

// Update location stock (absolute)
const locationUpdateSchema = z.object({
  sku: skuSchema,
  quantity: nonNegativeQty,
});

router.post('/locations/:id/update', asyncHandler(async (req, res) => {
  const { sku, quantity } = locationUpdateSchema.parse(req.body);
  const locationId = req.params.id;

  const stock = await prisma.locationStock.upsert({
    where: { locationId_sku: { locationId, sku } },
    create: { locationId, sku, quantity },
    update: { quantity },
  });

  res.json(stock);
}));

// Set location stock (bulk, absolute)
const locationSetSchema = z.object({
  items: z.array(z.object({ sku: skuSchema, quantity: nonNegativeQty })),
});

router.post('/locations/:id/set', asyncHandler(async (req, res) => {
  const { items } = locationSetSchema.parse(req.body);
  const locationId = req.params.id;

  await prisma.$transaction(
    items.map(item =>
      prisma.locationStock.upsert({
        where: { locationId_sku: { locationId, sku: item.sku } },
        create: { locationId, sku: item.sku, quantity: item.quantity },
        update: { quantity: item.quantity },
      })
    )
  );

  res.json({ success: true, updated: items.length });
}));

// Get location config
router.get('/locations/:id/config', asyncHandler(async (req, res) => {
  const configs = await prisma.locationConfig.findMany({
    where: { locationId: req.params.id },
  });

  // Return as { sku: { minStock, maxStock } }
  const configMap = {};
  configs.forEach(c => {
    configMap[c.sku] = { minStock: c.minStock, maxStock: c.maxStock };
  });

  res.json(configMap);
}));

// Update location config for a product
const locationConfigSchema = z.object({
  minStock: z.coerce.number().int().min(0).nullish(),
  maxStock: z.coerce.number().int().min(0).nullish(),
});

router.put('/locations/:id/config/:sku', asyncHandler(async (req, res) => {
  const { minStock, maxStock } = locationConfigSchema.parse(req.body);
  const { id: locationId, sku } = req.params;

  const config = await prisma.locationConfig.upsert({
    where: { locationId_sku: { locationId, sku } },
    create: {
      locationId,
      sku,
      minStock,
      maxStock,
    },
    update: {
      minStock,
      maxStock,
    },
  });

  res.json(config);
}));

// Get per-location ordering config (lead time + cover days). Returns the
// resolved values (defaults applied), the raw overrides, and the defaults — so
// the UI can show whether a location is on the default or a custom value.
router.get('/locations/:id/ordering', asyncHandler(async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    select: { leadTimeDays: true, coverDays: true },
  });
  if (!location) return res.status(404).json({ error: 'Location not found' });

  res.json({
    resolved: resolveOrderingConfig(location),
    overrides: { leadTimeDays: location.leadTimeDays, coverDays: location.coverDays },
    defaults: { leadTimeDays: DEFAULT_LEAD_TIME_DAYS, coverDays: DEFAULT_COVER_DAYS },
  });
}));

// Update per-location ordering config. Send null for a field to clear the
// override and fall back to the code default.
const orderingConfigSchema = z.object({
  leadTimeDays: z.coerce.number().int().min(0).nullish(),
  coverDays: z.coerce.number().int().min(0).nullish(),
});

router.put('/locations/:id/ordering', asyncHandler(async (req, res) => {
  const data = orderingConfigSchema.parse(req.body);
  const location = await prisma.location.update({
    where: { id: req.params.id },
    data,
    select: { leadTimeDays: true, coverDays: true },
  });

  res.json({
    resolved: resolveOrderingConfig(location),
    overrides: { leadTimeDays: location.leadTimeDays, coverDays: location.coverDays },
    defaults: { leadTimeDays: DEFAULT_LEAD_TIME_DAYS, coverDays: DEFAULT_COVER_DAYS },
  });
}));

// ============ BATCHES ============

// Get batches
router.get('/batches', asyncHandler(async (req, res) => {
  const { warehouseId, sku, hasRemaining } = req.query;

  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (sku) where.sku = sku;
  if (hasRemaining === 'true') where.remainingQty = { gt: 0 };

  const batches = await prisma.stockBatch.findMany({
    where,
    include: {
      product: { select: { name: true, category: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });

  res.json(batches);
}));

// Get expiring batches.
// Includes batches with NO expiry date (returned in the `missing` bucket) —
// stock signed in without an expiry must be surfaced for correction, not
// silently excluded from expiry tracking.
router.get('/batches/expiring', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + days);

  const batches = await prisma.stockBatch.findMany({
    where: {
      remainingQty: { gt: 0 },
      OR: [
        { expiryDate: { lte: thresholdDate } },
        { expiryDate: null },
      ],
    },
    include: {
      product: { select: { name: true, category: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { expiryDate: { sort: 'asc', nulls: 'last' } },
  });

  res.json(categorizeBatchesByExpiry(batches));
}));

// Drift check: any (warehouse, sku) where warehouse_stock.quantity disagrees
// with SUM(batch remaining_qty). Should be EMPTY once batches are authoritative
// — used to verify the backfill and ongoing consistency.
router.get('/batches/drift', asyncHandler(async (req, res) => {
  const [stock, sums] = await Promise.all([
    prisma.warehouseStock.findMany(),
    prisma.stockBatch.groupBy({
      by: ['warehouseId', 'sku'],
      _sum: { remainingQty: true },
    }),
  ]);

  const sumMap = new Map(sums.map(s => [`${s.warehouseId}|${s.sku}`, s._sum.remainingQty || 0]));
  const seen = new Set();
  const drift = [];

  for (const s of stock) {
    const key = `${s.warehouseId}|${s.sku}`;
    seen.add(key);
    const batchSum = sumMap.get(key) || 0;
    if (s.quantity !== batchSum) {
      drift.push({ warehouseId: s.warehouseId, sku: s.sku, aggregate: s.quantity, batchSum, diff: s.quantity - batchSum });
    }
  }
  // Batches that sum > 0 but have no warehouse_stock row at all
  for (const [key, batchSum] of sumMap) {
    if (!seen.has(key) && batchSum !== 0) {
      const [warehouseId, sku] = key.split('|');
      drift.push({ warehouseId, sku, aggregate: 0, batchSum, diff: -batchSum });
    }
  }

  res.json({ count: drift.length, drift });
}));

// Create batch
const batchCreateSchema = z.object({
  warehouseId: z.string().min(1),
  sku: skuSchema,
  quantity: positiveQty,
  expiryDate: z.string().nullish().refine(
    v => v == null || v === '' || !isNaN(Date.parse(v)),
    { message: 'expiryDate must be a valid date' },
  ),
  hasDamage: z.boolean().optional(),
  damageNotes: z.string().nullish(),
});

router.post('/batches', asyncHandler(async (req, res) => {
  const { warehouseId, sku, quantity, expiryDate, hasDamage, damageNotes } = batchCreateSchema.parse(req.body);

  // Batches are authoritative for warehouse quantity, so creating one bumps the
  // aggregate. This is the "Add Stock" path (and any direct batch add).
  const batch = await prisma.$transaction(async (tx) => {
    const created = await tx.stockBatch.create({
      data: {
        warehouseId,
        sku,
        quantity,
        remainingQty: quantity,
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        hasDamage: hasDamage || false,
        damageNotes,
      },
    });
    await recomputeWarehouseStock(tx, warehouseId, sku);
    return created;
  });

  res.status(201).json(batch);
}));

// Update batch. expiryDate is updatable so batches signed in without one
// ("missing expiry") can be corrected later from the expiry tab; explicit
// null clears it.
const batchUpdateSchema = z.object({
  remainingQty: nonNegativeQty.optional(),
  hasDamage: z.boolean().optional(),
  damageNotes: z.string().nullish(),
  expiryDate: z.string().nullable().refine(
    v => v === null || (v !== '' && !isNaN(Date.parse(v))),
    { message: 'expiryDate must be a valid date or null' },
  ).optional(),
});

router.put('/batches/:id', asyncHandler(async (req, res) => {
  const { remainingQty, hasDamage, damageNotes, expiryDate } = batchUpdateSchema.parse(req.body);

  // Editing a batch's remaining quantity must keep the warehouse aggregate in
  // lock-step (this was the drift bug — the old code updated the batch but not
  // warehouse_stock). Recompute is cheap and correct for every field change.
  const batch = await prisma.$transaction(async (tx) => {
    const updated = await tx.stockBatch.update({
      where: { id: req.params.id },
      data: {
        ...(remainingQty !== undefined && { remainingQty }),
        ...(hasDamage !== undefined && { hasDamage }),
        ...(damageNotes !== undefined && { damageNotes }),
        ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
      },
    });
    await recomputeWarehouseStock(tx, updated.warehouseId, updated.sku);
    return updated;
  });

  res.json(batch);
}));

// Hard-delete a batch created in error. Distinct from write-off (which journals
// the loss as wastage): delete is for genuine mistakes and leaves no
// StockRemoval. The warehouse aggregate is recomputed from the surviving batches.
router.delete('/batches/:id', asyncHandler(async (req, res) => {
  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.stockBatch.findUnique({ where: { id: req.params.id } });
    if (!batch) return null;
    await tx.stockBatch.delete({ where: { id: req.params.id } });
    await recomputeWarehouseStock(tx, batch.warehouseId, batch.sku);
    return batch;
  });

  if (!result) return res.status(404).json({ error: 'Batch not found' });
  res.json({ success: true, deleted: result.id });
}));

// Write off a batch (expired / damaged stock).
// Zeroes the batch's remaining quantity, decrements warehouse stock by the
// written-off amount, and journals the wastage as a StockRemoval so it shows
// up in history with a reason.
const writeOffSchema = z.object({
  reason: z.enum(['expired', 'damaged', 'other']).default('expired'),
  quantity: positiveQty.optional(), // defaults to entire remaining qty
  notes: z.string().nullish(),
  performedBy: z.string().nullish(),
});

router.post('/batches/:id/write-off', asyncHandler(async (req, res) => {
  const { reason, quantity, notes, performedBy } = writeOffSchema.parse(req.body);

  const batch = await prisma.stockBatch.findUnique({
    where: { id: req.params.id },
    include: { product: { select: { name: true } } },
  });

  if (!batch) {
    return res.status(404).json({ error: 'Batch not found' });
  }
  if (batch.remainingQty <= 0) {
    return res.status(409).json({ error: 'Batch has no remaining stock to write off' });
  }

  const writeOffQty = Math.min(quantity ?? batch.remainingQty, batch.remainingQty);

  const result = await prisma.$transaction(async (tx) => {
    // Guarded decrement so two concurrent write-offs can't double-deduct
    const updated = await tx.stockBatch.updateMany({
      where: { id: batch.id, remainingQty: { gte: writeOffQty } },
      data: { remainingQty: { decrement: writeOffQty } },
    });
    if (updated.count === 0) {
      const conflict = new Error('Batch remaining quantity changed — retry');
      conflict.status = 409;
      throw conflict;
    }

    await recomputeWarehouseStock(tx, batch.warehouseId, batch.sku);

    const removal = await tx.stockRemoval.create({
      data: {
        warehouseId: batch.warehouseId,
        routeName: `Write-off (${reason})`,
        takenBy: performedBy,
        notes: notes || `Write-off of batch ${batch.id} (${batch.product?.name || batch.sku}): ${reason}`,
        items: [{ sku: batch.sku, quantity: writeOffQty, reason, batchId: batch.id }],
      },
    });

    return removal;
  });

  res.status(201).json({ success: true, writeOffQty, removal: result });
}));

// ============ REMOVALS ============

// Record stock removal
const removalSchema = z.object({
  warehouseId: z.string().min(1),
  routeId: z.string().nullish(),
  routeName: z.string().nullish(),
  takenBy: z.string().nullish(),
  notes: z.string().nullish(),
  items: z.array(z.object({ sku: skuSchema, quantity: positiveQty })).min(1),
});

router.post('/removals', asyncHandler(async (req, res) => {
  const { warehouseId, routeId, routeName, items, takenBy, notes } = removalSchema.parse(req.body);

  try {
    const removal = await prisma.$transaction(async (tx) => {
      const record = await tx.stockRemoval.create({
        data: {
          warehouseId,
          routeId,
          routeName,
          items,
          takenBy,
          notes,
        },
      });

      const shortfalls = [];
      for (const item of items) {
        // Consume batches FEFO (first-expiry-first-out) so the expiry report
        // reflects what actually left the warehouse, then recompute the aggregate
        // from the surviving batches (batches are the source of truth for qty).
        const { shortfall } = await consumeBatchesFEFO(tx, warehouseId, item.sku, item.quantity);
        if (shortfall > 0) {
          shortfalls.push({ sku: item.sku, requested: item.quantity, available: item.quantity - shortfall });
        }
        await recomputeWarehouseStock(tx, warehouseId, item.sku);
      }

      // A removal that batches cannot cover must fail loudly, not silently
      // under-deliver: throwing rolls back the whole removal.
      if (shortfalls.length > 0) {
        const err = new Error('Insufficient warehouse stock');
        err.status = 400;
        err.shortfalls = shortfalls;
        throw err;
      }

      return record;
    });

    res.status(201).json(removal);
  } catch (err) {
    if (err.shortfalls) {
      return res.status(400).json({ error: 'Insufficient warehouse stock', shortfalls: err.shortfalls });
    }
    throw err;
  }
}));

// Get removal history
router.get('/removals', asyncHandler(async (req, res) => {
  const { warehouseId, startDate, endDate } = req.query;

  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const removals = await prisma.stockRemoval.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json(removals);
}));

// ============ STOCK CHECKS ============

// Submit stock check
const stockCheckSchema = z.object({
  locationId: z.string().min(1),
  performedBy: z.string().nullish(),
  items: z.array(z.object({
    sku: skuSchema,
    counted: nonNegativeQty,
    expected: z.coerce.number().int().optional(),
    variance: z.coerce.number().int().optional(),
    reason: z.string().nullish(),
  })).min(1),
});

router.post('/stock-checks', asyncHandler(async (req, res) => {
  const { locationId, items, performedBy } = stockCheckSchema.parse(req.body);

  const stockCheck = await prisma.$transaction(async (tx) => {
    const record = await tx.stockCheck.create({
      data: {
        locationId,
        items,
        performedBy,
      },
    });

    // Update location stock to counted values
    for (const item of items) {
      await tx.locationStock.upsert({
        where: { locationId_sku: { locationId, sku: item.sku } },
        create: { locationId, sku: item.sku, quantity: item.counted },
        update: { quantity: item.counted },
      });
    }

    return record;
  });

  res.status(201).json(stockCheck);
}));

// Get stock check history
router.get('/locations/:id/stock-check-history', asyncHandler(async (req, res) => {
  const stockChecks = await prisma.stockCheck.findMany({
    where: { locationId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(stockChecks);
}));

// ============ RESTOCKS ============

// Record restock
const restockSchema = z.object({
  locationId: z.string().min(1),
  performedBy: z.string().nullish(),
  photoUrl: z.string().nullish(),
  notes: z.string().nullish(),
  items: z.array(z.object({ sku: skuSchema, quantity: positiveQty })).min(1),
});

router.post('/restocks', asyncHandler(async (req, res) => {
  const { locationId, items, performedBy, photoUrl, notes } = restockSchema.parse(req.body);

  const restock = await prisma.$transaction(async (tx) => {
    const record = await tx.restockRecord.create({
      data: {
        locationId,
        items,
        performedBy,
        photoUrl,
        notes,
      },
    });

    for (const item of items) {
      // Atomic increment — no read-modify-write race
      await tx.locationStock.upsert({
        where: { locationId_sku: { locationId, sku: item.sku } },
        create: { locationId, sku: item.sku, quantity: item.quantity },
        update: { quantity: { increment: item.quantity } },
      });
    }

    return record;
  });

  res.status(201).json(restock);
}));

// Get restock history
router.get('/locations/:id/restock-history', asyncHandler(async (req, res) => {
  const restocks = await prisma.restockRecord.findMany({
    where: { locationId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  res.json(restocks);
}));

export default router;
