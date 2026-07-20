import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all warehouses
router.get('/', asyncHandler(async (req, res) => {
  const warehouses = await prisma.warehouse.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(warehouses);
}));

// Get single warehouse with stock
router.get('/:id', asyncHandler(async (req, res) => {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
    include: {
      stock: {
        include: { product: true },
      },
    },
  });

  if (!warehouse) {
    return res.status(404).json({ error: 'Warehouse not found' });
  }

  res.json(warehouse);
}));

// Get warehouse with full stock details
router.get('/:id/with-stock', asyncHandler(async (req, res) => {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: req.params.id },
  });

  if (!warehouse) {
    return res.status(404).json({ error: 'Warehouse not found' });
  }

  const stock = await prisma.warehouseStock.findMany({
    where: { warehouseId: req.params.id },
    include: { product: true },
  });

  // Convert to { sku: quantity } format
  const stockMap = {};
  stock.forEach(s => {
    stockMap[s.sku] = s.quantity;
  });

  res.json({ ...warehouse, stock: stockMap, stockDetails: stock });
}));

// Create warehouse
router.post('/', asyncHandler(async (req, res) => {
  const { name, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const warehouse = await prisma.warehouse.create({
    data: { name, address },
  });

  res.status(201).json(warehouse);
}));

// Update warehouse
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, address } = req.body;

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(address !== undefined && { address }),
    },
  });

  res.json(warehouse);
}));

// Delete warehouse.
//
// Removals and transfers reference the warehouse without cascade (movement
// history must survive), so a bare delete on a warehouse with history hit the
// FK constraint and surfaced as a blank 500. Orders' delivery destination
// would silently null out. Check first and answer 409 with an explanation;
// stock rows DO cascade, so refuse while any stock remains.
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;

  const [removalCount, transferCount, orderCount, stockUnits] = await Promise.all([
    prisma.stockRemoval.count({ where: { warehouseId: id } }),
    prisma.stockTransfer.count({ where: { OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } }),
    prisma.order.count({ where: { warehouseId: id } }),
    prisma.warehouseStock.aggregate({ where: { warehouseId: id, quantity: { gt: 0 } }, _sum: { quantity: true } }),
  ]);

  const heldUnits = stockUnits._sum.quantity || 0;
  if (heldUnits > 0) {
    return res.status(409).json({
      error: `Cannot delete: this warehouse still holds ${heldUnits} unit${heldUnits === 1 ? '' : 's'} of stock. Transfer or remove the stock first.`,
    });
  }
  if (removalCount > 0 || transferCount > 0 || orderCount > 0) {
    const parts = [
      removalCount > 0 && `${removalCount} stock removal${removalCount === 1 ? '' : 's'}`,
      transferCount > 0 && `${transferCount} transfer${transferCount === 1 ? '' : 's'}`,
      orderCount > 0 && `${orderCount} order${orderCount === 1 ? '' : 's'}`,
    ].filter(Boolean).join(', ');
    return res.status(409).json({
      error: `Cannot delete: this warehouse has ${parts} in its history, which must be kept for reporting.`,
    });
  }

  try {
    await prisma.warehouse.delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Cannot delete: this warehouse is referenced by other records that must be kept.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Warehouse not found' });
    }
    throw err;
  }

  res.json({ success: true });
}));

export default router;
