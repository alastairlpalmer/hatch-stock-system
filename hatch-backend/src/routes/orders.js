import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Get all orders
router.get('/', asyncHandler(async (req, res) => {
  const { status, supplierId, startDate, endDate } = req.query;

  const where = {};
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { name: true, category: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  res.json(orders);
}));

// Get single order
router.get('/:id', asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      supplier: true,
      items: {
        include: { product: true },
      },
    },
  });

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json(order);
}));

// Create order
router.post('/', asyncHandler(async (req, res) => {
  const { 
    supplierId, 
    deliveryMethod, 
    deliveryTo, 
    deliveryFee, 
    notes, 
    invoiceRef,
    items 
  } = req.body;

  if (!items?.length) {
    return res.status(400).json({ error: 'Order items required' });
  }

  // Calculate total
  const totalAmount = items.reduce((sum, item) => {
    return sum + (item.quantity * (item.unitPrice || 0));
  }, 0) + (deliveryFee || 0);

  const order = await prisma.order.create({
    data: {
      supplierId,
      deliveryMethod,
      deliveryTo,
      deliveryFee,
      notes,
      invoiceRef,
      totalAmount,
      items: {
        create: items.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });

  res.status(201).json(order);
}));

// Update order
router.put('/:id', asyncHandler(async (req, res) => {
  const { supplierId, deliveryMethod, deliveryTo, deliveryFee, notes, invoiceRef, status } = req.body;

  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      ...(supplierId !== undefined && { supplierId }),
      ...(deliveryMethod !== undefined && { deliveryMethod }),
      ...(deliveryTo !== undefined && { deliveryTo }),
      ...(deliveryFee !== undefined && { deliveryFee }),
      ...(notes !== undefined && { notes }),
      ...(invoiceRef !== undefined && { invoiceRef }),
      ...(status !== undefined && { status }),
    },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { include: { product: { select: { name: true } } } },
    },
  });

  res.json(order);
}));

// Delete order
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.order.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

// Receive order
router.post('/:id/receive', asyncHandler(async (req, res) => {
  const { items, warehouseId } = req.body;

  if (!items?.length || !warehouseId) {
    return res.status(400).json({ error: 'Items and warehouseId required' });
  }

  // Update order status
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status: 'received',
      receivedAt: new Date(),
    },
  });

  // Create batches and update stock
  for (const item of items) {
    // Create batch for expiry tracking
    await prisma.stockBatch.create({
      data: {
        warehouseId,
        sku: item.sku,
        quantity: item.quantity,
        remainingQty: item.quantity,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        hasDamage: item.hasDamage || false,
        damageNotes: item.damageNotes,
      },
    });

    // Update warehouse stock
    const existing = await prisma.warehouseStock.findUnique({
      where: { warehouseId_sku: { warehouseId, sku: item.sku } },
    });

    const currentQty = existing?.quantity || 0;

    await prisma.warehouseStock.upsert({
      where: { warehouseId_sku: { warehouseId, sku: item.sku } },
      create: {
        warehouseId,
        sku: item.sku,
        quantity: currentQty + item.quantity,
      },
      update: {
        quantity: currentQty + item.quantity,
      },
    });
  }

  res.json({ success: true, order });
}));

// Generate order suggestions
router.get('/suggestions', asyncHandler(async (req, res) => {
  const { locationId, supplierId } = req.query;

  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }

  // Get location stock and config
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: {
      stock: true,
      configs: true,
      assignedItems: true,
    },
  });

  if (!location) {
    return res.status(404).json({ error: 'Location not found' });
  }

  // Build suggestions
  const suggestions = [];

  for (const assignment of location.assignedItems) {
    const stockRecord = location.stock.find(s => s.sku === assignment.sku);
    const config = location.configs.find(c => c.sku === assignment.sku);

    const currentQty = stockRecord?.quantity || 0;
    const minStock = config?.minStock || 0;
    const maxStock = config?.maxStock || 10;

    // Suggest if at or below min stock
    if (currentQty <= minStock * 1.5) {
      const product = await prisma.product.findUnique({
        where: { sku: assignment.sku },
      });

      suggestions.push({
        sku: assignment.sku,
        name: product?.name || assignment.sku,
        category: product?.category,
        currentStock: currentQty,
        minStock,
        maxStock,
        suggestedQty: maxStock - currentQty,
        priority: currentQty <= minStock ? 'critical' : 'warning',
        unitCost: product?.unitCost,
      });
    }
  }

  // Sort by priority
  suggestions.sort((a, b) => {
    if (a.priority === 'critical' && b.priority !== 'critical') return -1;
    if (a.priority !== 'critical' && b.priority === 'critical') return 1;
    return b.suggestedQty - a.suggestedQty;
  });

  res.json(suggestions);
}));

export default router;
