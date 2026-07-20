import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all locations
router.get('/', asyncHandler(async (req, res) => {
  const { type, includeArchived } = req.query;

  // Archived (retired) locations are hidden from the active list by default.
  // Pass ?includeArchived=true to include them (e.g. admin management views).
  const where = {
    ...(type ? { type } : {}),
    ...(includeArchived === 'true' ? {} : { archivedAt: null }),
  };

  const locations = await prisma.location.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      assignedItems: { select: { sku: true } },
    },
  });

  // Format assigned items as array of SKUs
  const formatted = locations.map(loc => ({
    ...loc,
    assignedItems: loc.assignedItems.map(a => a.sku),
  }));

  res.json(formatted);
}));

// Get single location
router.get('/:id', asyncHandler(async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      assignedItems: { select: { sku: true } },
    },
  });

  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }

  res.json({
    ...location,
    assignedItems: location.assignedItems.map(a => a.sku),
  });
}));

// Get location with full stock details
router.get('/:id/with-stock', asyncHandler(async (req, res) => {
  const location = await prisma.location.findUnique({
    where: { id: req.params.id },
    include: {
      assignedItems: { select: { sku: true } },
      stock: { include: { product: true } },
      configs: true,
    },
  });

  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }

  // Format stock as { sku: quantity }
  const stockMap = {};
  location.stock.forEach(s => {
    stockMap[s.sku] = s.quantity;
  });

  // Format config as { sku: { minStock, maxStock } }
  const configMap = {};
  location.configs.forEach(c => {
    configMap[c.sku] = { minStock: c.minStock, maxStock: c.maxStock };
  });

  res.json({
    ...location,
    assignedItems: location.assignedItems.map(a => a.sku),
    stock: stockMap,
    config: configMap,
    stockDetails: location.stock,
  });
}));

// Create location
router.post('/', asyncHandler(async (req, res) => {
  const { name, type, address, assignedItems } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const location = await prisma.location.create({
    data: {
      name,
      type: type || 'vending',
      address,
      assignedItems: assignedItems?.length ? {
        create: assignedItems.map(sku => ({ sku })),
      } : undefined,
    },
    include: { assignedItems: { select: { sku: true } } },
  });

  res.status(201).json({
    ...location,
    assignedItems: location.assignedItems.map(a => a.sku),
  });
}));

// Update location
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, type, address, assignedItems } = req.body;
  const { id } = req.params;

  await prisma.$transaction(async (tx) => {
    await tx.location.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(type && { type }),
        ...(address !== undefined && { address }),
      },
    });

    if (Array.isArray(assignedItems)) {
      await tx.locationAssignment.deleteMany({ where: { locationId: id } });
      if (assignedItems.length > 0) {
        await tx.locationAssignment.createMany({
          data: assignedItems.map(sku => ({ locationId: id, sku })),
        });
      }
    }
  });

  const location = await prisma.location.findUnique({
    where: { id },
    include: { assignedItems: { select: { sku: true } } },
  });

  res.json({
    ...location,
    assignedItems: location.assignedItems.map(a => a.sku),
  });
}));

// Update assigned items. Replace-in-one-transaction: a crash between the
// delete and the create must not leave the location with no assignments
// (suggestions/stock checks silently widen to ALL products in that state).
router.put('/:id/assigned-items', asyncHandler(async (req, res) => {
  const { skus } = req.body;

  if (!Array.isArray(skus)) {
    return res.status(400).json({ error: 'SKUs array required' });
  }

  await prisma.$transaction([
    prisma.locationAssignment.deleteMany({
      where: { locationId: req.params.id },
    }),
    ...(skus.length > 0
      ? [prisma.locationAssignment.createMany({
        data: skus.map(sku => ({
          locationId: req.params.id,
          sku,
        })),
        skipDuplicates: true,
      })]
      : []),
  ]);

  res.json({ success: true, assignedItems: skus });
}));

// Delete location.
//
// Restock and stock-check records reference the location without cascade
// (operational history must survive), so a bare delete on any location that
// has been restocked hit the FK constraint and surfaced as a blank 500.
// Answer 409 pointing at the archive flow instead — archiving hides the
// machine everywhere while keeping its history.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;

  const [restockCount, checkCount] = await Promise.all([
    prisma.restockRecord.count({ where: { locationId: id } }),
    prisma.stockCheck.count({ where: { locationId: id } }),
  ]);
  if (restockCount > 0 || checkCount > 0) {
    const parts = [
      restockCount > 0 && `${restockCount} restock${restockCount === 1 ? '' : 's'}`,
      checkCount > 0 && `${checkCount} stock check${checkCount === 1 ? '' : 's'}`,
    ].filter(Boolean).join(' and ');
    return res.status(409).json({
      error: `Cannot delete: this location has ${parts} in its history, which must be kept. Archive the location instead — it disappears from day-to-day screens but keeps its records.`,
    });
  }

  try {
    await prisma.location.delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Cannot delete: this location is referenced by other records that must be kept. Archive it instead.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Location not found' });
    }
    throw err;
  }

  res.json({ success: true });
}));

export default router;
