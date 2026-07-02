import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  generatePickList,
  completePickList,
  getPickListRun,
  returnPickListLeftovers,
} from '../services/pick-list.js';

const router = express.Router();

const dateString = z.string().refine(
  (v) => !isNaN(Date.parse(v)),
  { message: 'must be a valid date' },
);

// Generate a draft pick list for a route (or explicit locations) + target date.
// Logic lives in services/pick-list.js.
const generateSchema = z.object({
  warehouseId: z.string().min(1),
  targetDate: dateString,
  routeId: z.string().min(1).nullish(),
  locationIds: z.array(z.string().min(1)).nullish(),
  createdBy: z.string().nullish(),
}).refine(
  (d) => d.routeId || (d.locationIds && d.locationIds.length > 0),
  { message: 'routeId or locationIds required' },
);

router.post('/generate', asyncHandler(async (req, res) => {
  const { warehouseId, targetDate, routeId, locationIds, createdBy } =
    generateSchema.parse(req.body);

  const pickList = await generatePickList({
    warehouseId,
    targetDate,
    routeId: routeId ?? null,
    locationIds: locationIds ?? null,
    createdBy: createdBy ?? null,
  });

  res.status(201).json(pickList);
}));

// List pick lists, newest first
router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  const lists = await prisma.pickList.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  res.json(lists);
}));

// Route-run view: the pick list plus, per stop in route order, the plan, the
// latest stock check since the list was created and the linked restock —
// everything the run screen needs in one response. Logic lives in
// services/pick-list.js.
router.get('/:id/run', asyncHandler(async (req, res) => {
  res.json(await getPickListRun(req.params.id));
}));

// Get single pick list
router.get('/:id', asyncHandler(async (req, res) => {
  const list = await prisma.pickList.findUnique({ where: { id: req.params.id } });
  if (!list) return res.status(404).json({ error: 'Pick list not found' });
  res.json(list);
}));

// Update a pick list — ONLY packing tick-state / packedQty (merged onto the
// stored items by sku) and status (draft|cancelled). Quantities and batch
// allocations are regenerated, never hand-edited. A packed list is immutable.
const updateSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    packed: z.boolean().optional(),
    packedQty: z.coerce.number().int().min(0).nullish(),
  })).optional(),
  status: z.enum(['draft', 'cancelled']).optional(),
});

router.put('/:id', asyncHandler(async (req, res) => {
  const { items, status } = updateSchema.parse(req.body);

  const existing = await prisma.pickList.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Pick list not found' });
  if (existing.status === 'packed') {
    return res.status(409).json({ error: 'Pick list has already been packed' });
  }

  let mergedItems;
  if (items !== undefined) {
    const patchBySku = new Map(items.map((i) => [i.sku, i]));
    mergedItems = (Array.isArray(existing.items) ? existing.items : []).map((item) => {
      const patch = patchBySku.get(item.sku);
      if (!patch) return item;
      return {
        ...item,
        ...(patch.packed !== undefined && { packed: patch.packed }),
        ...(patch.packedQty !== undefined && { packedQty: patch.packedQty }),
      };
    });
  }

  const list = await prisma.pickList.update({
    where: { id: existing.id },
    data: {
      ...(mergedItems !== undefined && { items: mergedItems }),
      ...(status !== undefined && { status }),
    },
  });

  res.json(list);
}));

// Delete a pick list (drafts/cancelled only — a packed list is an audit record).
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.pickList.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Pick list not found' });
  if (existing.status === 'packed') {
    return res.status(409).json({ error: 'Cannot delete a packed pick list' });
  }

  await prisma.pickList.delete({ where: { id: existing.id } });
  res.json({ success: true });
}));

// Complete a pick list: consume warehouse stock FEFO, journal the StockRemoval
// and flip to packed. 409 with { error, shortfalls } when live stock no longer
// covers the list — regenerate and retry.
const completeSchema = z.object({ takenBy: z.string().nullish() });

router.post('/:id/complete', asyncHandler(async (req, res) => {
  const { takenBy } = completeSchema.parse(req.body ?? {});

  try {
    const result = await completePickList(req.params.id, { takenBy: takenBy ?? null });
    res.json(result);
  } catch (err) {
    if (err.shortfalls) {
      return res.status(409).json({ error: err.message, shortfalls: err.shortfalls });
    }
    throw err;
  }
}));

// Return leftovers from the van to the warehouse after a run. 409 unless the
// list is packed; 400 with { error, violations } when a return exceeds what
// should still be on the van (packed − loaded − already returned).
const returnLeftoversSchema = z.object({
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.coerce.number().int().min(1),
  })).min(1),
  performedBy: z.string().nullish(),
});

router.post('/:id/return-leftovers', asyncHandler(async (req, res) => {
  const { items, performedBy } = returnLeftoversSchema.parse(req.body);

  try {
    const result = await returnPickListLeftovers(req.params.id, {
      items,
      performedBy: performedBy ?? null,
    });
    res.json(result);
  } catch (err) {
    if (err.violations) {
      return res.status(400).json({ error: err.message, violations: err.violations });
    }
    throw err;
  }
}));

export default router;
