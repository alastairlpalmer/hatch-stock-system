import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { batchInputFromReceivedItem, validateReceiptLines } from '../utils/receiving.js';
import { FRESH_MEAL_PLACEHOLDER_CATEGORY } from '../utils/fresh-meal-placeholders.js';
import { recomputeWarehouseStock } from '../utils/inventory-stock.js';
import {
  buildOrderSuggestions,
  buildConsolidatedSuggestions,
} from '../services/order-suggestions.js';

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

// Generate order suggestions — velocity / days-of-cover model with par-level
// guardrails. Non-fresh products per SKU; Frive fresh meals collapsed into one
// line per meal-type group. Logic lives in services/order-suggestions.js.
// NOTE: must be declared BEFORE `/:id` or Express matches `:id = "suggestions"`.
router.get('/suggestions', asyncHandler(async (req, res) => {
  const { locationId, mode } = req.query;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }

  const result = await buildOrderSuggestions(locationId, new Date(), { mode });
  if (!result) {
    return res.status(404).json({ error: 'Location not found' });
  }

  res.json(result);
}));

// Consolidated suggestions across MANY locations — merged into one list per
// product / fresh-meal group, tagged with each line's preferred supplier so the
// UI can build one PO per supplier. `locationIds` is a comma-separated list;
// when omitted, every location is included.
// NOTE: must be declared BEFORE `/:id` (route-ordering gotcha).
router.get('/suggestions/consolidated', asyncHandler(async (req, res) => {
  const { locationIds, mode } = req.query;

  let ids;
  if (locationIds && locationIds.trim()) {
    ids = locationIds.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    // Default scope is every ACTIVE location — archived sites must not drive buying.
    const all = await prisma.location.findMany({
      where: { archivedAt: null },
      select: { id: true },
    });
    ids = all.map((l) => l.id);
  }

  if (ids.length === 0) {
    return res.json({ locationIds: [], locations: [], suggestions: [] });
  }

  const result = await buildConsolidatedSuggestions(ids, new Date(), { mode });
  if (!result) {
    return res.status(404).json({ error: 'No matching locations found' });
  }

  res.json(result);
}));

// Recent receiving events across all orders (partial receipts included) —
// the goods-in history feed.
// NOTE: must be declared BEFORE `/:id` or Express matches `:id = "receipts"`.
router.get('/receipts', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const receipts = await prisma.orderReceipt.findMany({
    include: {
      order: {
        select: {
          id: true,
          status: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(receipts);
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
      receipts: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json(order);
}));

// Expected delivery date — an ISO date string; blank/null clears it.
const expectedDateSchema = z.string().nullish().refine(
  v => v == null || v === '' || !isNaN(Date.parse(v)),
  { message: 'expectedDate must be a valid date' },
);

// Create order. Exported for tests.
export const orderCreateSchema = z.object({
  supplierId: z.string().nullish(),
  deliveryMethod: z.string().nullish(),
  deliveryTo: z.string().nullish(),
  deliveryFee: z.coerce.number().min(0).nullish(),
  notes: z.string().nullish(),
  invoiceRef: z.string().nullish(),
  expectedDate: expectedDateSchema,
  buyingListId: z.string().nullish(),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unitPrice: z.coerce.number().min(0).nullish(),
  })).min(1),
});

router.post('/', asyncHandler(async (req, res) => {
  const {
    supplierId,
    deliveryMethod,
    deliveryTo,
    deliveryFee,
    notes,
    invoiceRef,
    expectedDate,
    buyingListId,
    items,
  } = orderCreateSchema.parse(req.body);

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
      expectedDate: expectedDate ? new Date(expectedDate) : null,
      buyingListId,
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

// Update order. An optional `items` array REPLACES the order's line items —
// previously item edits sent by the Edit form were silently dropped because
// this handler only updated metadata. Edits (items AND metadata) are only
// allowed while the order is pending: once received, stock was booked in
// against the old lines and rewriting history would desync inventory.
//
// The only status change this endpoint allows is pending → cancelled;
// `received` is reachable exclusively through POST /:id/receive (which books
// the stock in), and received/cancelled are terminal.
export const orderUpdateSchema = z.object({
  supplierId: z.string().nullish(),
  deliveryMethod: z.string().nullish(),
  deliveryTo: z.string().nullish(),
  deliveryFee: z.coerce.number().min(0).nullish(),
  notes: z.string().nullish(),
  invoiceRef: z.string().nullish(),
  expectedDate: expectedDateSchema,
  status: z.enum(['pending', 'received', 'cancelled']).optional(),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.coerce.number().int().positive(),
    unitPrice: z.coerce.number().min(0).nullish(),
  })).min(1).optional(),
});

router.put('/:id', asyncHandler(async (req, res) => {
  const { supplierId, deliveryMethod, deliveryTo, deliveryFee, notes, invoiceRef, expectedDate, status, items } =
    orderUpdateSchema.parse(req.body);

  const existing = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    return res.status(404).json({ error: 'Order not found' });
  }
  const statusChange = status !== undefined && status !== existing.status;
  if (statusChange && !(existing.status === 'pending' && status === 'cancelled')) {
    return res.status(409).json({
      error: `Cannot change status from ${existing.status} to ${status} — only pending orders can be cancelled, and receiving goes through the receive endpoint`,
    });
  }
  if (existing.status !== 'pending') {
    return res.status(409).json({ error: `Cannot edit a ${existing.status} order` });
  }

  const order = await prisma.$transaction(async (tx) => {
    if (items !== undefined) {
      await tx.orderItem.deleteMany({ where: { orderId: existing.id } });
      await tx.orderItem.createMany({
        data: items.map(item => ({
          orderId: existing.id,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? null,
        })),
      });
    }

    // Recompute the total from the (possibly new) items + effective fee
    const currentItems = await tx.orderItem.findMany({ where: { orderId: existing.id } });
    const effectiveFee = deliveryFee !== undefined && deliveryFee !== null
      ? deliveryFee
      : (existing.deliveryFee || 0);
    const totalAmount = currentItems.reduce(
      (sum, item) => sum + item.quantity * (item.unitPrice || 0), 0
    ) + effectiveFee;

    return tx.order.update({
      where: { id: existing.id },
      data: {
        ...(supplierId !== undefined && { supplierId }),
        ...(deliveryMethod !== undefined && { deliveryMethod }),
        ...(deliveryTo !== undefined && { deliveryTo }),
        ...(deliveryFee !== undefined && { deliveryFee }),
        ...(notes !== undefined && { notes }),
        ...(invoiceRef !== undefined && { invoiceRef }),
        ...(expectedDate !== undefined && { expectedDate: expectedDate ? new Date(expectedDate) : null }),
        ...(status !== undefined && { status }),
        totalAmount,
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });
  });

  res.json(order);
}));

// Delete order. Received orders are protected: stock batches were booked in
// from them, so deleting one would orphan the audit trail.
router.delete('/:id', asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status === 'received') {
    return res.status(409).json({ error: 'Cannot delete a received order — stock was booked in from it' });
  }

  await prisma.order.delete({
    where: { id: req.params.id },
  });

  res.json({ success: true });
}));

// Receive order — supports PARTIAL receipts and multiple expiry lots per SKU.
// Each call books in one delivery event: items may repeat a SKU (one line per
// date-lot), receivedQty accumulates on the order lines, and the order only
// flips to `received` when every line is fully covered or the operator
// explicitly closes it short. Idempotency: a retry, double-click, or two
// operators scanning the same delivery must not double-count stock — the
// per-item receivedQty increment is guarded inside the transaction.
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
    // Fresh-meal allocation: count these units against THIS order line (a
    // meal-type placeholder) while booking the batch under `sku` (the actual
    // flavour found in the box). `name` lets receiving auto-create a flavour
    // product that isn't in the catalogue yet (new weekly menu).
    forSku: z.string().min(1).nullish(),
    name: z.string().nullish(),
  })).min(1),
  closeShort: z.boolean().optional(),
  receivedBy: z.string().nullish(),
});

router.post('/:id/receive', asyncHandler(async (req, res) => {
  const { items, warehouseId, closeShort, receivedBy } = receiveSchema.parse(req.body);

  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { category: true, mealType: true } } } },
    },
  });

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status !== 'pending') {
    return res.status(409).json({ error: `Order already ${order.status}` });
  }

  // Received lines must be on the order and, summed per order line, must not
  // exceed what is still outstanding (ordered minus previously received).
  const { sums, itemBySku, error } = validateReceiptLines(order.items, items);
  if (error) {
    return res.status(400).json({ error });
  }

  // forSku allocation is ONLY valid against fresh-meal placeholder lines —
  // arbitrary substitution on normal lines would corrupt goods-in truth.
  for (const line of items) {
    if (!line.forSku) continue;
    const target = itemBySku.get(line.forSku);
    if (target?.product?.category !== FRESH_MEAL_PLACEHOLDER_CATEGORY) {
      return res.status(400).json({
        error: `${line.forSku} is not a fresh-meal placeholder line — flavour allocation is not allowed against it`,
      });
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    // Auto-create flavour products the catalogue hasn't seen yet (the weekly
    // menu rotates, so brand-new flavours arriving is the normal case). They
    // inherit the placeholder's meal type and join the fresh-meal group.
    const allocationLines = items.filter((l) => l.forSku);
    for (const line of allocationLines) {
      const existing = await tx.product.findUnique({ where: { sku: line.sku } });
      if (!existing) {
        const placeholder = itemBySku.get(line.forSku);
        await tx.product.create({
          data: {
            sku: line.sku,
            name: line.name || line.sku,
            category: 'Fresh Meals',
            isFreshMeal: true,
            mealType: placeholder?.product?.mealType ?? null,
            mealTypeConfirmed: true,
            unitsPerBox: 1,
          },
        });
      }
    }
    // Create one batch per line for expiry tracking (expiryDate null when not
    // provided — surfaced as "missing" by the expiry views, never blocks
    // receiving). Batches are authoritative: the warehouse aggregate is then
    // recomputed from them rather than incremented separately (which could
    // drift).
    for (const item of items) {
      await tx.stockBatch.create({
        data: batchInputFromReceivedItem(item, warehouseId),
      });
    }

    // Guarded per-SKU increment: if a concurrent receipt already booked units
    // in, the receivedQty precondition fails (count 0) and we abort without
    // touching stock rather than over-receiving.
    for (const [sku, sum] of sums) {
      const orderItem = itemBySku.get(sku);
      const updated = await tx.orderItem.updateMany({
        where: { id: orderItem.id, receivedQty: { lte: orderItem.quantity - sum } },
        data: { receivedQty: { increment: sum } },
      });
      if (updated.count === 0) {
        const conflict = new Error(`Concurrent receipt detected for ${sku} — reload the order and retry`);
        conflict.status = 409;
        throw conflict;
      }
    }

    // Recompute each affected aggregate once, however many lots came in.
    // Batches are booked under the line's OWN sku (the actual product), which
    // differs from the order-line sku for fresh-meal allocations.
    for (const sku of new Set(items.map((l) => l.sku))) {
      await recomputeWarehouseStock(tx, warehouseId, sku);
    }

    // Journal the receiving event — the goods-in audit trail for this delivery
    const receipt = await tx.orderReceipt.create({
      data: {
        orderId: order.id,
        warehouseId,
        items,
        closedShort: !!closeShort,
        receivedBy,
      },
    });

    // The order completes when every line is fully received, or when the
    // operator closes it short (accepting the shortfall).
    const freshItems = await tx.orderItem.findMany({ where: { orderId: order.id } });
    const complete = closeShort || freshItems.every(i => i.receivedQty >= i.quantity);
    if (complete) {
      await tx.order.update({
        where: { id: order.id },
        data: { status: 'received', receivedAt: new Date() },
      });
    }

    const updatedOrder = await tx.order.findUnique({
      where: { id: order.id },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    return { order: updatedOrder, receipt, complete: !!complete };
  });

  res.json(result);
}));

export default router;
