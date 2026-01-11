import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all locations
router.get('/', asyncHandler(async (req, res) => {
  const { type } = req.query;

  const where = type ? { type } : {};

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
  const { name, type, address } = req.body;

  const location = await prisma.location.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(type && { type }),
      ...(address !== undefined && { address }),
    },
  });

  res.json(location);
}));

// Update assigned items
router.put('/:id/assigned-items', asyncHandler(async (req, res) => {
  const { skus } = req.body;

  if (!Array.isArray(skus)) {
    return res.status(400).json({ error: 'SKUs array required' });
  }

  // Delete existing assignments
  await prisma.locationAssignment.deleteMany({
    where: { locationId: req.params.id },
  });

  // Create new assignments
  if (skus.length > 0) {
    await prisma.locationAssignment.createMany({
      data: skus.map(sku => ({
        locationId: req.params.id,
        sku,
      })),
    });
  }

  res.json({ success: true, assignedItems: skus });
}));

// Delete location
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.location.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

export default router;
