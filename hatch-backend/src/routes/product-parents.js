import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getLocationVelocity } from '../services/order-suggestions.js';

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

// Flavour starvation: machines where a family's TOTAL stock looks healthy but
// its best-selling flavour is at zero. Parent-level min/max can't see this —
// and a starved flavour stops generating the sales data that drives the order
// split, so it self-reinforces. Feeds the Dashboard attention rail.
router.get('/starvation', asyncHandler(async (req, res) => {
  const [members, parents, locations] = await Promise.all([
    prisma.product.findMany({
      where: { parentId: { not: null }, isFreshMeal: false },
      select: { sku: true, name: true, parentId: true },
    }),
    prisma.productParent.findMany({ select: { id: true, name: true } }),
    prisma.location.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
  ]);
  if (members.length === 0) return res.json({ items: [] });

  const parentNameOf = new Map(parents.map((p) => [p.id, p.name]));
  const membersByParent = new Map();
  for (const m of members) {
    if (!membersByParent.has(m.parentId)) membersByParent.set(m.parentId, []);
    membersByParent.get(m.parentId).push(m);
  }

  const memberSkus = members.map((m) => m.sku);
  const [stockRows, velocities] = await Promise.all([
    prisma.locationStock.findMany({
      where: { locationId: { in: locations.map((l) => l.id) }, sku: { in: memberSkus } },
      select: { locationId: true, sku: true, quantity: true },
    }),
    Promise.all(locations.map((l) => getLocationVelocity(l.id))),
  ]);
  const stockOf = new Map(stockRows.map((r) => [`${r.locationId}|${r.sku}`, r.quantity]));

  const items = [];
  locations.forEach((location, i) => {
    const velocity = velocities[i];
    for (const [parentId, fam] of membersByParent) {
      const withStats = fam.map((m) => ({
        ...m,
        stock: stockOf.get(`${location.id}|${m.sku}`) || 0,
        vLong: velocity[m.sku]?.vLong || 0,
      }));
      const familyStock = withStats.reduce((a, m) => a + m.stock, 0);
      if (familyStock <= 0) continue; // genuinely empty — ordinary low-stock alerts cover it
      const top = withStats.reduce((a, m) => (m.vLong > (a?.vLong || 0) ? m : a), null);
      // <= 0: sync drift can leave a sold-out flavour slightly negative.
      if (top && top.vLong > 0 && top.stock <= 0) {
        items.push({
          locationId: location.id,
          locationName: location.name,
          parentId,
          parentName: parentNameOf.get(parentId) || parentId,
          flavourSku: top.sku,
          flavourName: top.name,
          familyStock,
        });
      }
    }
  });

  res.json({ items });
}));

// trim() runs BEFORE min(1): a whitespace-only name is rejected rather than
// stored as an empty string that renders as a blank, unclickable group.
const nameSchema = z.object({ name: z.string().trim().min(1).max(60) });

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

  // The member check must live INSIDE the transaction: checked outside, a
  // concurrent assignment could land between check and delete, and the FK's
  // ON DELETE SET NULL would silently orphan the just-assigned flavours.
  try {
    await prisma.$transaction(async (tx) => {
      const members = await tx.product.count({ where: { parentId: existing.id } });
      if (members > 0) {
        const err = new Error(
          `Cannot delete: ${members} product(s) are still in "${existing.name}". Remove them first.`,
        );
        err.status = 409;
        throw err;
      }
      // Planogram slots reference parents with NO FK (history must survive) —
      // block the delete rather than leave zombie "any flavour" slots that
      // pick nothing forever.
      const slots = await tx.slotAssignment.count({
        where: { parentId: existing.id, validTo: null },
      });
      if (slots > 0) {
        const err = new Error(
          `Cannot delete: ${slots} planogram slot(s) still target "${existing.name}". Reassign them first.`,
        );
        err.status = 409;
        throw err;
      }
      await tx.locationParentConfig.deleteMany({ where: { parentId: existing.id } });
      await tx.productParent.delete({ where: { id: existing.id } });
    });
  } catch (err) {
    if (err.status === 409) return res.status(409).json({ error: err.message });
    throw err;
  }
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

  try {
    // Only unassigned flavours (or re-assignments to the SAME group) — a SKU
    // in another family must be removed there first, matching the UI flow,
    // instead of being silently stolen.
    const result = await prisma.product.updateMany({
      where: {
        sku: { in: skus },
        isFreshMeal: false,
        OR: [{ parentId: null }, { parentId: parent.id }],
      },
      data: { parentId: parent.id },
    });
    const skippedInOtherGroup = skus.length - result.count;
    res.json({ success: true, assigned: result.count, skippedInOtherGroup });
  } catch (err) {
    // FK violation: the group was deleted between the lookup above and the
    // update (concurrent admin) — report it rather than 500.
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'Product group was deleted — refresh and try again' });
    }
    throw err;
  }
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

  try {
    const config = await prisma.locationParentConfig.upsert({
      where: { locationId_parentId: { locationId, parentId } },
      create: { locationId, parentId, minStock, maxStock },
      update: { minStock, maxStock },
    });
    res.json(config);
  } catch (err) {
    // FK violation — unknown location or group id must read as a 404, not a 500.
    if (err.code === 'P2003') {
      return res.status(404).json({ error: 'Location or product group not found' });
    }
    throw err;
  }
}));

export default router;
