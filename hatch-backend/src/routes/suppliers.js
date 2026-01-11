import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all suppliers
router.get('/', asyncHandler(async (req, res) => {
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(suppliers);
}));

// Get single supplier
router.get('/:id', asyncHandler(async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
  });

  if (!supplier) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  res.json(supplier);
}));

// Create supplier
router.post('/', asyncHandler(async (req, res) => {
  const { name, contact, email, phone, address } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const supplier = await prisma.supplier.create({
    data: { name, contact, email, phone, address },
  });

  res.status(201).json(supplier);
}));

// Update supplier
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, contact, email, phone, address } = req.body;

  const supplier = await prisma.supplier.update({
    where: { id: req.params.id },
    data: {
      ...(name && { name }),
      ...(contact !== undefined && { contact }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(address !== undefined && { address }),
    },
  });

  res.json(supplier);
}));

// Delete supplier
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.supplier.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

// Get supplier's orders
router.get('/:id/orders', asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { supplierId: req.params.id },
    include: {
      items: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(orders);
}));

export default router;
