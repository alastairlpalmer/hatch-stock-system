import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

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
router.post('/warehouse/update', asyncHandler(async (req, res) => {
  const { warehouseId, sku, quantity, isDelta = true } = req.body;

  if (!warehouseId || !sku || quantity === undefined) {
    return res.status(400).json({ error: 'warehouseId, sku, and quantity required' });
  }

  // Get current stock
  const existing = await prisma.warehouseStock.findUnique({
    where: { warehouseId_sku: { warehouseId, sku } },
  });

  const currentQty = existing?.quantity || 0;
  const newQty = isDelta ? currentQty + quantity : quantity;

  // Upsert stock record
  const stock = await prisma.warehouseStock.upsert({
    where: { warehouseId_sku: { warehouseId, sku } },
    create: {
      warehouseId,
      sku,
      quantity: Math.max(0, newQty),
    },
    update: {
      quantity: Math.max(0, newQty),
    },
  });

  res.json(stock);
}));

// Bulk update warehouse stock
router.post('/warehouse/bulk', asyncHandler(async (req, res) => {
  const { warehouseId, items } = req.body;

  if (!warehouseId || !Array.isArray(items)) {
    return res.status(400).json({ error: 'warehouseId and items array required' });
  }

  const results = { updated: 0, errors: [] };

  for (const item of items) {
    try {
      await prisma.warehouseStock.upsert({
        where: { warehouseId_sku: { warehouseId, sku: item.sku } },
        create: {
          warehouseId,
          sku: item.sku,
          quantity: item.quantity,
        },
        update: {
          quantity: item.quantity,
        },
      });
      results.updated++;
    } catch (error) {
      results.errors.push({ sku: item.sku, error: error.message });
    }
  }

  res.json(results);
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

// Update location stock
router.post('/locations/:id/update', asyncHandler(async (req, res) => {
  const { sku, quantity } = req.body;
  const locationId = req.params.id;

  if (!sku || quantity === undefined) {
    return res.status(400).json({ error: 'sku and quantity required' });
  }

  const stock = await prisma.locationStock.upsert({
    where: { locationId_sku: { locationId, sku } },
    create: {
      locationId,
      sku,
      quantity: Math.max(0, quantity),
    },
    update: {
      quantity: Math.max(0, quantity),
    },
  });

  res.json(stock);
}));

// Set location stock (bulk, replaces all)
router.post('/locations/:id/set', asyncHandler(async (req, res) => {
  const { items } = req.body;
  const locationId = req.params.id;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items array required' });
  }

  // Update each item
  for (const item of items) {
    await prisma.locationStock.upsert({
      where: { locationId_sku: { locationId, sku: item.sku } },
      create: {
        locationId,
        sku: item.sku,
        quantity: item.quantity,
      },
      update: {
        quantity: item.quantity,
      },
    });
  }

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
router.put('/locations/:id/config/:sku', asyncHandler(async (req, res) => {
  const { minStock, maxStock } = req.body;
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

// Get expiring batches
router.get('/batches/expiring', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() + days);

  const batches = await prisma.stockBatch.findMany({
    where: {
      remainingQty: { gt: 0 },
      expiryDate: { lte: thresholdDate },
    },
    include: {
      product: { select: { name: true, category: true } },
      warehouse: { select: { name: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });

  // Categorize by urgency
  const now = new Date();
  const result = {
    expired: [],
    critical: [], // < 7 days
    warning: [],  // < 30 days
  };

  batches.forEach(batch => {
    const expiry = new Date(batch.expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) {
      result.expired.push({ ...batch, daysUntil });
    } else if (daysUntil <= 7) {
      result.critical.push({ ...batch, daysUntil });
    } else {
      result.warning.push({ ...batch, daysUntil });
    }
  });

  res.json(result);
}));

// Create batch
router.post('/batches', asyncHandler(async (req, res) => {
  const { warehouseId, sku, quantity, expiryDate, hasDamage, damageNotes } = req.body;

  if (!warehouseId || !sku || !quantity) {
    return res.status(400).json({ error: 'warehouseId, sku, and quantity required' });
  }

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

// Update batch
router.put('/batches/:id', asyncHandler(async (req, res) => {
  const { remainingQty, hasDamage, damageNotes } = req.body;

  const batch = await prisma.stockBatch.update({
    where: { id: req.params.id },
    data: {
      ...(remainingQty !== undefined && { remainingQty }),
      ...(hasDamage !== undefined && { hasDamage }),
      ...(damageNotes !== undefined && { damageNotes }),
    },
  });

  res.json(batch);
}));

// ============ REMOVALS ============

// Record stock removal
router.post('/removals', asyncHandler(async (req, res) => {
  const { warehouseId, routeId, routeName, items, takenBy, notes } = req.body;

  if (!warehouseId || !items?.length) {
    return res.status(400).json({ error: 'warehouseId and items required' });
  }

  // Create removal record
  const removal = await prisma.stockRemoval.create({
    data: {
      warehouseId,
      routeId,
      routeName,
      items,
      takenBy,
      notes,
    },
  });

  // Update warehouse stock
  for (const item of items) {
    const existing = await prisma.warehouseStock.findUnique({
      where: { warehouseId_sku: { warehouseId, sku: item.sku } },
    });

    if (existing) {
      await prisma.warehouseStock.update({
        where: { warehouseId_sku: { warehouseId, sku: item.sku } },
        data: { quantity: Math.max(0, existing.quantity - item.quantity) },
      });
    }
  }

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
router.post('/stock-checks', asyncHandler(async (req, res) => {
  const { locationId, items, performedBy } = req.body;

  if (!locationId || !items?.length) {
    return res.status(400).json({ error: 'locationId and items required' });
  }

  // Create stock check record
  const stockCheck = await prisma.stockCheck.create({
    data: {
      locationId,
      items,
      performedBy,
    },
  });

  // Update location stock to counted values
  for (const item of items) {
    await prisma.locationStock.upsert({
      where: { locationId_sku: { locationId, sku: item.sku } },
      create: {
        locationId,
        sku: item.sku,
        quantity: item.counted,
      },
      update: {
        quantity: item.counted,
      },
    });
  }

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
router.post('/restocks', asyncHandler(async (req, res) => {
  const { locationId, items, performedBy, photoUrl, notes } = req.body;

  if (!locationId || !items?.length) {
    return res.status(400).json({ error: 'locationId and items required' });
  }

  // Create restock record
  const restock = await prisma.restockRecord.create({
    data: {
      locationId,
      items,
      performedBy,
      photoUrl,
      notes,
    },
  });

  // Update location stock
  for (const item of items) {
    const existing = await prisma.locationStock.findUnique({
      where: { locationId_sku: { locationId, sku: item.sku } },
    });

    const currentQty = existing?.quantity || 0;

    await prisma.locationStock.upsert({
      where: { locationId_sku: { locationId, sku: item.sku } },
      create: {
        locationId,
        sku: item.sku,
        quantity: currentQty + item.quantity,
      },
      update: {
        quantity: currentQty + item.quantity,
      },
    });
  }

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
