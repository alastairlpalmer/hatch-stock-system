import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  MAX_SHELVES,
  MAX_SLOTS_PER_SHELF,
  MAX_SLOT_CAPACITY,
  validateLayout,
  diffSlotAssignments,
  detectStale,
  computeUnplaced,
  buildRestockSheetRows,
  resolveSlotCapacity,
} from '../services/planogram-layout.js';

const router = express.Router();

/**
 * Visual planogram API.
 *
 * A location's fridge layout (shelves + facings) and its temporal slot
 * assignments — the source of truth for what is IN the machine this week.
 * Reads are open, writes are admin-only via the global rolePolicy. Quantities
 * are deliberately NOT in these payloads: the frontend already owns live/DB
 * quantities and the fresh-meal group sums, and duplicating them here would
 * create a second freshness source.
 */

const capacitySchema = z.number().int().min(1).max(MAX_SLOT_CAPACITY).optional().nullable();

const shelfSchema = z.object({
  shelf: z.number().int().min(1).max(MAX_SHELVES),
  slots: z.number().int().min(1).max(MAX_SLOTS_PER_SHELF),
  unitsPerSlot: capacitySchema, // shelf-wide capacity default (units per facing)
});

const assignmentSchema = z
  .object({
    shelf: z.number().int().min(1),
    position: z.number().int().min(0),
    targetType: z.enum(['sku', 'mealType']),
    sku: z.string().min(1).optional().nullable(),
    mealType: z.string().min(1).optional().nullable(),
    capacity: capacitySchema, // per-slot override of the shelf default
  })
  .refine((a) => (a.targetType === 'sku' ? !!a.sku : !!a.mealType), {
    message: "sku targets require 'sku'; mealType targets require 'mealType'",
  });

export const savePlanogramSchema = z.object({
  shelves: z.array(shelfSchema).min(1),
  assignments: z.array(assignmentSchema),
});

/**
 * Build the location's product context used for stale/unplaced computation:
 * the mirrored assignment list joined with product classification.
 */
async function loadLocationProducts(locationId) {
  const assigned = await prisma.locationAssignment.findMany({
    where: { locationId },
    select: { sku: true },
  });
  const skus = assigned.map((a) => a.sku);
  if (skus.length === 0) return [];
  return prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { sku: true, name: true, category: true, isFreshMeal: true, mealType: true },
  });
}

/** Shared read used by GET and returned after PUT so the client refreshes atomically. */
async function buildPlanogramPayload(locationId) {
  const layout = await prisma.machineLayout.findUnique({ where: { locationId } });
  if (!layout) return { layout: null, assignments: [], unplaced: { skus: [], mealTypes: [] } };

  const [openRows, locationProducts] = await Promise.all([
    prisma.slotAssignment.findMany({
      where: { layoutId: layout.id, validTo: null },
      orderBy: [{ shelf: 'asc' }, { position: 'asc' }],
    }),
    loadLocationProducts(locationId),
  ]);

  const productBySku = new Map(locationProducts.map((p) => [p.sku, p]));
  // Slot targets can reference SKUs no longer assigned to the location (stale
  // slots) — fetch their product info too so the UI can still name them.
  const missingSkus = openRows
    .filter((r) => r.targetType === 'sku' && r.sku && !productBySku.has(r.sku))
    .map((r) => r.sku);
  if (missingSkus.length > 0) {
    const extra = await prisma.product.findMany({
      where: { sku: { in: missingSkus } },
      select: { sku: true, name: true, category: true, isFreshMeal: true, mealType: true },
    });
    for (const p of extra) productBySku.set(p.sku, p);
  }

  const assignedSkuSet = new Set(locationProducts.map((p) => p.sku));
  const mealTypeMemberCounts = new Map();
  for (const p of locationProducts) {
    if (!p.isFreshMeal) continue;
    const group = p.mealType || 'Unclassified';
    mealTypeMemberCounts.set(group, (mealTypeMemberCounts.get(group) || 0) + 1);
  }

  const shelvesByNumber = new Map(
    (Array.isArray(layout.shelves) ? layout.shelves : []).map((s) => [s.shelf, s]),
  );
  const assignments = detectStale(openRows, assignedSkuSet, mealTypeMemberCounts).map((a) => ({
    id: a.id,
    shelf: a.shelf,
    position: a.position,
    slotCode: a.slotCode,
    targetType: a.targetType,
    sku: a.sku,
    mealType: a.mealType,
    capacity: a.capacity ?? null,
    // capacity ?? shelf unitsPerSlot ?? null — what this facing actually holds
    effectiveCapacity: resolveSlotCapacity(a, shelvesByNumber),
    validFrom: a.validFrom,
    stale: a.stale,
    product: a.sku ? (productBySku.get(a.sku) ?? null) : null,
  }));

  return {
    layout: {
      id: layout.id,
      locationId: layout.locationId,
      shelves: layout.shelves,
      updatedAt: layout.updatedAt,
    },
    assignments,
    unplaced: computeUnplaced(openRows, locationProducts),
  };
}

// Current layout + open slot assignments (+ stale flags, unplaced checklist)
router.get('/location/:locationId', asyncHandler(async (req, res) => {
  const location = await prisma.location.findUnique({ where: { id: req.params.locationId } });
  if (!location) return res.status(404).json({ error: 'Location not found' });
  res.json(await buildPlanogramPayload(req.params.locationId));
}));

// Full-document save. Diffs against the open rows so unchanged slots keep
// their validFrom; changed/removed slots are CLOSED (validTo = now) and
// replacements inserted — automatic position history for the future heatmap.
router.put('/location/:locationId', asyncHandler(async (req, res) => {
  const locationId = req.params.locationId;
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return res.status(404).json({ error: 'Location not found' });

  const { shelves, assignments } = savePlanogramSchema.parse(req.body);
  const errors = validateLayout(shelves, assignments);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Invalid layout', details: errors });
  }

  const layout = await prisma.machineLayout.upsert({
    where: { locationId },
    create: { locationId, shelves },
    update: { shelves },
  });

  const openRows = await prisma.slotAssignment.findMany({
    where: { layoutId: layout.id, validTo: null },
    select: { id: true, shelf: true, position: true, targetType: true, sku: true, mealType: true, capacity: true },
  });
  const { toCloseIds, toCreate, toUpdateCapacity } = diffSlotAssignments(openRows, assignments);

  if (toCloseIds.length > 0 || toCreate.length > 0 || toUpdateCapacity.length > 0) {
    const now = new Date();
    await prisma.$transaction([
      prisma.slotAssignment.updateMany({
        where: { id: { in: toCloseIds } },
        data: { validTo: now },
      }),
      prisma.slotAssignment.createMany({
        data: toCreate.map((a) => ({
          ...a,
          layoutId: layout.id,
          locationId,
          validFrom: now,
        })),
      }),
      // Capacity edits on unchanged targets update the open row in place —
      // capacity is a current attribute, never a history-cycling change.
      ...toUpdateCapacity.map(({ id, capacity }) =>
        prisma.slotAssignment.update({ where: { id }, data: { capacity } })
      ),
    ]);
  }

  res.json(await buildPlanogramPayload(locationId));
}));

// Share-link info for the location's restock sheet. The token lives on the
// layout (created with it via @default(uuid())), so this is a plain read —
// exposed only to authed users, who then hand the URL to the 3PL.
router.get('/location/:locationId/share', asyncHandler(async (req, res) => {
  const layout = await prisma.machineLayout.findUnique({
    where: { locationId: req.params.locationId },
    select: { shareToken: true },
  });
  if (!layout) return res.status(404).json({ error: 'No layout configured for this location' });
  res.json({ shareToken: layout.shareToken, sharePath: `/share/restock-sheet/${layout.shareToken}` });
}));

// ============ PUBLIC RESTOCK SHEET ============

/**
 * Read-only 3PL restock sheet by share token. Mounted at
 * /api/public/restock-sheet — BEFORE the auth gate (see index.js), mirroring
 * the shared buying-list view: the unguessable uuid token IS the credential.
 *
 * One row per slot in walking order (top shelf, left to right) with
 * target-level "add" quantities (see buildRestockSheetRows). Quantities come
 * from LocationStock (kept fresh by the VendLive stock sync); stockUpdatedAt
 * reports how fresh. Deliberately excludes prices, margins and internal ids.
 */
export const publicRestockSheetRouter = express.Router();

publicRestockSheetRouter.get('/:token', asyncHandler(async (req, res) => {
  const layout = await prisma.machineLayout.findUnique({
    where: { shareToken: req.params.token },
    include: { location: { select: { id: true, name: true } } },
  });
  if (!layout) return res.status(404).json({ error: 'Not found' });

  const [assignments, stockRows, configRows, mealConfigRows] = await Promise.all([
    prisma.slotAssignment.findMany({
      where: { layoutId: layout.id, validTo: null },
      select: { shelf: true, position: true, slotCode: true, targetType: true, sku: true, mealType: true },
    }),
    prisma.locationStock.findMany({
      where: { locationId: layout.locationId },
      select: { sku: true, quantity: true, updatedAt: true, product: { select: { name: true, isFreshMeal: true, mealType: true } } },
    }),
    prisma.locationConfig.findMany({
      where: { locationId: layout.locationId },
      select: { sku: true, maxStock: true },
    }),
    prisma.locationMealConfig.findMany({
      where: { locationId: layout.locationId },
      select: { mealType: true, maxStock: true },
    }),
  ]);

  const qtyBySku = new Map(stockRows.map((r) => [r.sku, r.quantity]));
  const nameBySku = new Map(stockRows.map((r) => [r.sku, r.product?.name || r.sku]));
  // Slot targets can reference SKUs with no stock row yet — name them too.
  const missingSkus = assignments
    .filter((a) => a.targetType === 'sku' && a.sku && !nameBySku.has(a.sku))
    .map((a) => a.sku);
  if (missingSkus.length > 0) {
    const extra = await prisma.product.findMany({
      where: { sku: { in: missingSkus } },
      select: { sku: true, name: true },
    });
    for (const p of extra) nameBySku.set(p.sku, p.name);
  }

  const groupQty = new Map();
  for (const r of stockRows) {
    if (!r.product?.isFreshMeal) continue;
    const group = r.product.mealType || 'Unclassified';
    groupQty.set(group, (groupQty.get(group) || 0) + r.quantity);
  }

  const skuMax = new Map(configRows.filter((r) => r.maxStock != null).map((r) => [r.sku, r.maxStock]));
  const groupMax = new Map(mealConfigRows.filter((r) => r.maxStock != null).map((r) => [r.mealType, r.maxStock]));

  const { rows, totalAdd } = buildRestockSheetRows(assignments, {
    qtyBySku,
    groupQty,
    skuMax,
    groupMax,
    nameBySku,
  });

  const stockUpdatedAt = stockRows.reduce(
    (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
    null
  );

  res.json({
    locationName: layout.location?.name || 'Unknown location',
    generatedAt: new Date().toISOString(),
    stockUpdatedAt,
    shelves: layout.shelves,
    rows,
    totalAdd,
  });
}));

export default router;
