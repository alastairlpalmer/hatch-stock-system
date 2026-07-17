import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * Fresh-meal buckets (admin-managed, configurable) and per-location group
 * capacity. Buckets are referenced BY NAME from products.meal_type and
 * location_meal_config.meal_type (denormalised, no FK), so a rename must
 * cascade to both — handled transactionally in PUT /:id.
 */

// ============ MEAL TYPES (buckets) ============

// List buckets in display order.
router.get('/', asyncHandler(async (req, res) => {
  const mealTypes = await prisma.mealType.findMany({ orderBy: { sortOrder: 'asc' } });
  res.json(mealTypes);
}));

// trim() before min(1) — a whitespace-only bucket name must not slip through
// as an empty string (same guard as product-parents).
const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  sortOrder: z.coerce.number().int().optional(),
});

router.post('/', asyncHandler(async (req, res) => {
  const { name, sortOrder } = createSchema.parse(req.body);
  try {
    const created = await prisma.mealType.create({
      data: { name: name.trim(), sortOrder: sortOrder ?? 0 },
    });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A meal type with that name already exists' });
    }
    throw err;
  }
}));

const updateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

// Update a bucket. Renaming cascades to the denormalised name on products and
// location_meal_config so collapsed rows and reporting stay consistent.
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, sortOrder } = updateSchema.parse(req.body);

  const existing = await prisma.mealType.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Meal type not found' });

  const newName = name?.trim();
  const renaming = newName && newName !== existing.name;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.mealType.update({
        where: { id: req.params.id },
        data: {
          ...(newName && { name: newName }),
          ...(sortOrder !== undefined && { sortOrder }),
        },
      });
      if (renaming) {
        await tx.product.updateMany({
          where: { mealType: existing.name },
          data: { mealType: newName },
        });
        await tx.locationMealConfig.updateMany({
          where: { mealType: existing.name },
          data: { mealType: newName },
        });
      }
      return row;
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A meal type with that name already exists' });
    }
    throw err;
  }
}));

// Delete a bucket. Blocked (409) while any product still references it, so we
// never orphan classified meals.
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.mealType.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Meal type not found' });

  const inUse = await prisma.product.count({ where: { mealType: existing.name } });
  if (inUse > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${inUse} product(s) are still classified as "${existing.name}". Reassign them first.`,
    });
  }

  await prisma.$transaction([
    prisma.locationMealConfig.deleteMany({ where: { mealType: existing.name } }),
    prisma.mealType.delete({ where: { id: req.params.id } }),
  ]);
  res.json({ success: true });
}));

// ============ PER-LOCATION GROUP CAPACITY ============

// Get group capacity for a location, as { mealType: { minStock, maxStock } }.
router.get('/location/:locationId/config', asyncHandler(async (req, res) => {
  const rows = await prisma.locationMealConfig.findMany({
    where: { locationId: req.params.locationId },
  });
  const configMap = {};
  rows.forEach((r) => {
    configMap[r.mealType] = { minStock: r.minStock, maxStock: r.maxStock };
  });
  res.json(configMap);
}));

const mealConfigSchema = z.object({
  minStock: z.coerce.number().int().min(0).nullish(),
  maxStock: z.coerce.number().int().min(0).nullish(),
});

router.put('/location/:locationId/config/:mealType', asyncHandler(async (req, res) => {
  const { minStock, maxStock } = mealConfigSchema.parse(req.body);
  const { locationId, mealType } = req.params;

  const config = await prisma.locationMealConfig.upsert({
    where: { locationId_mealType: { locationId, mealType } },
    create: { locationId, mealType, minStock, maxStock },
    update: { minStock, maxStock },
  });
  res.json(config);
}));

export default router;
