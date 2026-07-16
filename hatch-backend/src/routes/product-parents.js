import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * Product parents ("Barebells", "Estate Dairy"): stable flavour families.
 * The parent is a pure grouping row — never stocked, sold, or ordered;
 * flavours are ordinary products linked by products.parent_id (an FK by id,
 * so renames need no cascade — deliberately unlike the fresh-meal name-string
 * link). A product cannot be in both grouping systems: fresh meals are
 * rejected on assignment, or ordering would double-count them once parent
 * aggregation lands.
 */

const memberSelect = { sku: true, name: true, category: true, barcode: true, unitsPerBox: true };

// List parents with their member flavours.
router.get('/', asyncHandler(async (req, res) => {
  const parents = await prisma.productParent.findMany({
    orderBy: { name: 'asc' },
    include: { products: { select: memberSelect, orderBy: { name: 'asc' } } },
  });
  res.json(parents);
}));

const nameSchema = z.object({ name: z.string().min(1).max(60) });

router.post('/', asyncHandler(async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  try {
    const created = await prisma.productParent.create({ data: { name: name.trim() } });
    res.status(201).json({ ...created, products: [] });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A product group with that name already exists' });
    }
    throw err;
  }
}));

// Rename. Members link by id, so nothing cascades.
router.put('/:id', asyncHandler(async (req, res) => {
  const { name } = nameSchema.parse(req.body);
  try {
    const updated = await prisma.productParent.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
      include: { products: { select: memberSelect, orderBy: { name: 'asc' } } },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Product group not found' });
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A product group with that name already exists' });
    }
    throw err;
  }
}));

// Delete a group. Blocked (409) while flavours are still assigned, so a
// mistaken delete can't silently orphan members and drop their group config.
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await prisma.productParent.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Product group not found' });

  const members = await prisma.product.count({ where: { parentId: existing.id } });
  if (members > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${members} product(s) are still in "${existing.name}". Remove them first.`,
    });
  }

  await prisma.$transaction([
    prisma.locationParentConfig.deleteMany({ where: { parentId: existing.id } }),
    prisma.productParent.delete({ where: { id: existing.id } }),
  ]);
  res.json({ success: true });
}));

// ============ MEMBERSHIP ============

const membersSchema = z.object({ skus: z.array(z.string().min(1)).min(1) });

// Assign flavours to a group.
router.post('/:id/members', asyncHandler(async (req, res) => {
  const { skus } = membersSchema.parse(req.body);
  const parent = await prisma.productParent.findUnique({ where: { id: req.params.id } });
  if (!parent) return res.status(404).json({ error: 'Product group not found' });

  const freshMeals = await prisma.product.findMany({
    where: { sku: { in: skus }, isFreshMeal: true },
    select: { name: true },
  });
  if (freshMeals.length > 0) {
    return res.status(409).json({
      error: `Fresh meals are grouped by meal type and cannot join a product group: ${freshMeals.map((p) => p.name).join(', ')}`,
    });
  }

  const result = await prisma.product.updateMany({
    where: { sku: { in: skus }, isFreshMeal: false },
    data: { parentId: parent.id },
  });
  res.json({ success: true, assigned: result.count });
}));

// Remove one flavour from a group.
router.delete('/:id/members/:sku', asyncHandler(async (req, res) => {
  const result = await prisma.product.updateMany({
    where: { sku: req.params.sku, parentId: req.params.id },
    data: { parentId: null },
  });
  if (result.count === 0) {
    return res.status(404).json({ error: 'Product is not in this group' });
  }
  res.json({ success: true });
}));

// ============ PER-LOCATION GROUP CAPACITY ============
// Mirrors the meal-types location config; consumed by ordering/picking in
// later phases.

// Get group capacity for a location, as { parentId: { minStock, maxStock } }.
router.get('/location/:locationId/config', asyncHandler(async (req, res) => {
  const rows = await prisma.locationParentConfig.findMany({
    where: { locationId: req.params.locationId },
  });
  const configMap = {};
  rows.forEach((r) => {
    configMap[r.parentId] = { minStock: r.minStock, maxStock: r.maxStock };
  });
  res.json(configMap);
}));

const parentConfigSchema = z.object({
  minStock: z.coerce.number().int().min(0).nullish(),
  maxStock: z.coerce.number().int().min(0).nullish(),
});

router.put('/location/:locationId/config/:parentId', asyncHandler(async (req, res) => {
  const { minStock, maxStock } = parentConfigSchema.parse(req.body);
  const { locationId, parentId } = req.params;

  const config = await prisma.locationParentConfig.upsert({
    where: { locationId_parentId: { locationId, parentId } },
    create: { locationId, parentId, minStock, maxStock },
    update: { minStock, maxStock },
  });
  res.json(config);
}));

export default router;
