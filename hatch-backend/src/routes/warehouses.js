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

// Delete warehouse
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.warehouse.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

export default router;
