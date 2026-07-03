import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Ordering config lives on the supplier so the buying list can warn about
// order-day windows and minimum-order shortfalls, and PO expectedDate can be
// derived from the supplier's lead time.
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const supplierFieldsSchema = z.object({
  name: z.string().min(1),
  contact: z.string().nullish(),
  email: z.string().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  // Weekdays the supplier accepts orders; null/empty = any day.
  orderDays: z.array(z.enum(WEEKDAYS)).nullish(),
  leadTimeDays: z.coerce.number().int().min(0).max(30).nullish(),
  minOrderValue: z.coerce.number().min(0).nullish(),
});

export const supplierCreateSchema = supplierFieldsSchema;
export const supplierUpdateSchema = supplierFieldsSchema.partial();

// Normalise empty orderDays arrays to null so "no restriction" has one shape.
function normalizeConfig(data) {
  const out = { ...data };
  if (Array.isArray(out.orderDays) && out.orderDays.length === 0) {
    out.orderDays = null;
  }
  return out;
}

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
  const data = normalizeConfig(supplierCreateSchema.parse(req.body));

  const supplier = await prisma.supplier.create({ data });

  res.status(201).json(supplier);
}));

// Update supplier
router.put('/:id', asyncHandler(async (req, res) => {
  const parsed = normalizeConfig(supplierUpdateSchema.parse(req.body));

  // Only touch fields that were present in the payload; explicit nulls clear.
  const data = {};
  for (const key of ['name', 'contact', 'email', 'phone', 'address', 'orderDays', 'leadTimeDays', 'minOrderValue']) {
    if (key in req.body) data[key] = parsed[key] ?? null;
  }
  if (data.name === null) delete data.name; // name is required — ignore null

  const supplier = await prisma.supplier.update({
    where: { id: req.params.id },
    data,
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
