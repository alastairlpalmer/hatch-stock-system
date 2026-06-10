import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { batchInputFromReceivedItem } from '../utils/receiving.js';

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

// Generate order suggestions.
// NOTE: must be declared BEFORE `/:id` or Express matches `:id = "suggestions"`.
router.get('/suggestions', asyncHandler(async (req, res) => {
  const { locationId } = req.query;

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

  // Fetch all assigned products in one query (was a per-assignment lookup)
  const products = await prisma.product.findMany({
    where: { sku: { in: location.assignedItems.map(a => a.sku) } },
  });
  const productMap = new Map(products.map(p => [p.sku, p]));

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
      const product = productMap.get(assignment.sku);

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

// Receive order — idempotent and transactional. A retry, double-click, or two
// operators scanning the same delivery must not double-count stock.
// Exported for tests. expiryDate is optional by design: a missing expiry must
// not block sign-in — the batch is flagged as "missing expiry" instead.
export const receiveSchema = z.object({
  warehouseId: z.string().min(1),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    expiryDate: z.string().nullish().refine(
      v => v == null || v === '' || !isNaN(Date.parse(v)),
      { message: 'expiryDate must be a valid date' },
    ),
    hasDamage: z.boolean().optional(),
    damageNotes: z.string().nullish(),
  })).min(1),
});

router.post('/:id/receive', asyncHandler(async (req, res) => {
  const { items, warehouseId } = receiveSchema.parse(req.body);

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status !== 'pending') {
    return res.status(409).json({ error: `Order already ${order.status}` });
  }

  // Received items must be on the order and not exceed the ordered quantity
  const orderedBySku = {};
  for (const oi of order.items) {
    orderedBySku[oi.sku] = (orderedBySku[oi.sku] || 0) + oi.quantity;
  }
  for (const item of items) {
    const ordered = orderedBySku[item.sku];
    if (ordered === undefined) {
      return res.status(400).json({ error: `SKU ${item.sku} is not on this order` });
    }
    if (item.quantity > ordered) {
      return res.status(400).json({
        error: `Received quantity for ${item.sku} (${item.quantity}) exceeds ordered quantity (${ordered})`,
      });
    }
  }

  const updatedOrder = await prisma.$transaction(async (tx) => {
    // Guarded status flip: if a concurrent request already received this
    // order, count is 0 and we abort without touching stock.
    const flipped = await tx.order.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'received', receivedAt: new Date() },
    });
    if (flipped.count === 0) {
      const conflict = new Error('Order already received');
      conflict.status = 409;
      throw conflict;
    }

    for (const item of items) {
      // Create batch for expiry tracking (expiryDate null when not provided —
      // surfaced as "missing" by the expiry views, never blocks receiving)
      await tx.stockBatch.create({
        data: batchInputFromReceivedItem(item, warehouseId),
      });

      // Atomic increment — no read-modify-write race
      await tx.warehouseStock.upsert({
        where: { warehouseId_sku: { warehouseId, sku: item.sku } },
        create: { warehouseId, sku: item.sku, quantity: item.quantity },
        update: { quantity: { increment: item.quantity } },
      });
    }

    return tx.order.findUnique({ where: { id: order.id } });
  });

  res.json({ success: true, order: updatedOrder });
}));

export default router;
