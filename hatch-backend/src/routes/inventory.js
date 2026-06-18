import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { categorizeBatchesByExpiry } from '../utils/expiry.js';

const router = express.Router();

// Shared field schemas
const skuSchema = z.string().min(1);
const quantitySchema = z.coerce.number().int();
const nonNegativeQty = quantitySchema.refine(v => v >= 0, { message: 'quantity must be >= 0' });
const positiveQty = quantitySchema.refine(v => v > 0, { message: 'quantity must be > 0' });

/**
 * Atomically apply a delta to a stock row inside a transaction, clamping at 0.
 * Negative results are clamped (matching previous behaviour) — but unlike a
 * silent Math.max(0, …) we log them, since clamping hides shrinkage.
 */
async function applyStockDelta(tx, model, where, createData, delta) {
  await tx[model].upsert({
    where,
    create: { ...createData, quantity: Math.max(0, delta) },
    update: { quantity: { increment: delta } },
  });
  if (delta < 0) {
    const clamped = await tx[model].updateMany({
      where: { ...whereToFlat(where), quantity: { lt: 0 } },
      data: { quantity: 0 },
    });
    if (clamped.count > 0) {
      console.warn(`Stock clamped to 0 (over-decrement) on ${model}:`, JSON.stringify(where));
    }
  }
}

// Prisma compound-unique `where` ({ warehouseId_sku: { … } }) → flat filter for updateMany
function whereToFlat(where) {
  const key = Object.keys(where)[0];
  return where[key];
}

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

  const where = { warehouseId_sku: { warehouseId, sku } };

  const stock = await prisma.$transaction(async (tx) => {
    if (isDelta) {
      await applyStockDelta(tx, 'warehouseStock', where, { warehouseId, sku }, quantity);
    } else {
      await tx.warehouseStock.upsert({
        where,
        create: { warehouseId, sku, quantity: Math.max(0, quantity) },
        update: { quantity: Math.max(0, quantity) },
      });
    }
    return tx.warehouseStock.findUnique({ where });
  });

  res.json(stock);
}));

// Bulk update warehouse stock (absolute quantities)
const warehouseBulkSchema = z.object({
  warehouseId: z.string().min(1),
  items: z.array(z.object({ sku: skuSchema, quantity: nonNegativeQty })),
});

router.post('/warehouse/bulk', asyncHandler(async (req, res) => {
  const { warehouseId, items } = warehouseBulkSchema.parse(req.body);

  await prisma.$transaction(
    items.map(item =>
      prisma.warehouseStock.upsert({
        where: { warehouseId_sku: { warehouseId, sku: item.sku } },
        create: { warehouseId, sku: item.sku, quantity: item.quantity },
        update: { quantity: item.quantity },
      })
    )
  );

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

  const transfer = await prisma.$transaction(async (tx) => {
    // Pre-check source stock: applyStockDelta clamps at 0, so reject the whole
    // transfer if any SKU is short rather than silently losing product.
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
      await applyStockDelta(
        tx, 'warehouseStock',
        { warehouseId_sku: { warehouseId: fromWarehouseId, sku } },
        { warehouseId: fromWarehouseId, sku },
        -quantity,
      );
      await applyStockDelta(
        tx, 'warehouseStock',
        { warehouseId_sku: { warehouseId: toWarehouseId, sku } },
        { warehouseId: toWarehouseId, sku },
        quantity,
      );
    }

    return tx.stockTransfer.create({
      data: { fromWarehouseId, toWarehouseId, items, notes, performedBy },
    });
  });

  res.json(transfer);
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

  const batch = await prisma.stockBatch.create({
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

  const batch = await prisma.stockBatch.update({
    where: { id: req.params.id },
    data: {
      ...(remainingQty !== undefined && { remainingQty }),
      ...(hasDamage !== undefined && { hasDamage }),
      ...(damageNotes !== undefined && { damageNotes }),
      ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
    },
  });

  res.json(batch);
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

    await applyStockDelta(
      tx,
      'warehouseStock',
      { warehouseId_sku: { warehouseId: batch.warehouseId, sku: batch.sku } },
      { warehouseId: batch.warehouseId, sku: batch.sku },
      -writeOffQty,
    );

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

    for (const item of items) {
      await applyStockDelta(
        tx,
        'warehouseStock',
        { warehouseId_sku: { warehouseId, sku: item.sku } },
        { warehouseId, sku: item.sku },
        -item.quantity,
      );

      // Consume batches FEFO (first-expiry-first-out) so the expiry report
      // reflects what actually left the warehouse. Best-effort: historical
      // batches may not cover the quantity, in which case we drain what we
      // can — warehouse totals remain the source of truth for quantity.
      let toConsume = item.quantity;
      const batches = await tx.stockBatch.findMany({
        where: { warehouseId, sku: item.sku, remainingQty: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      });
      for (const batch of batches) {
        if (toConsume <= 0) break;
        const take = Math.min(batch.remainingQty, toConsume);
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: { remainingQty: { decrement: take } },
        });
        toConsume -= take;
      }
    }

    return record;
  });

  res.status(201).json(removal);
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
