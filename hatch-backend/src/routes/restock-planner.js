import express from 'express';
import { z } from 'zod';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

// Restock planner calendar (Restock > Planner). The frontend renders the
// weekly defaults itself (Monday = restock, Friday = de-stock); this API
// stores overrides and ad-hoc entries keyed by (date, kind), and the range
// GET also returns stock-check summaries so a day's plan shows what was
// actually checked in hindsight. Writes are NOT on the operational-write
// allowlist, so rolePolicy makes them admin-only once auth is enabled
// (no-op while AUTH_ENABLED is off, matching the rest of the API).

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const upsertSchema = z.object({
  date: dateString,
  kind: z.enum(['restock', 'destock']),
  status: z.enum(['planned', 'cancelled']).default('planned'),
  assignees: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  notes: z.string().max(500).nullish(),
});

const rangeSchema = z.object({ from: dateString, to: dateString });

// Entries + stock-check summaries for an inclusive date range. Stock checks
// are matched to calendar days client-side (by the browser's local date), so
// the range here is in whole UTC days with `to` exclusive-plus-one.
router.get('/', asyncHandler(async (req, res) => {
  const { from, to } = rangeSchema.parse(req.query);
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const toExclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);

  const [entries, checks] = await Promise.all([
    prisma.restockPlanEntry.findMany({
      where: { date: { gte: fromDate, lte: toDate } },
      orderBy: [{ date: 'asc' }, { kind: 'asc' }],
    }),
    prisma.stockCheck.findMany({
      where: { createdAt: { gte: fromDate, lt: toExclusive } },
      orderBy: { createdAt: 'asc' },
      include: { location: { select: { name: true } } },
    }),
  ]);

  // Product names for the per-SKU breakdown (items JSON only carries skus).
  const skus = [...new Set(checks.flatMap((c) => (Array.isArray(c.items) ? c.items : []).map((i) => i.sku)))];
  const products = skus.length
    ? await prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true, name: true } })
    : [];
  const nameBySku = new Map(products.map((p) => [p.sku, p.name]));

  const stockChecks = checks.map((c) => {
    const items = Array.isArray(c.items) ? c.items : [];
    return {
      id: c.id,
      locationId: c.locationId,
      locationName: c.location?.name ?? null,
      performedBy: c.performedBy,
      source: c.source,
      createdAt: c.createdAt,
      itemCount: items.length,
      varianceCount: items.filter((i) => i.variance != null && Number(i.variance) !== 0).length,
      items: items.map(({ sku, expected, counted, variance }) => ({
        sku,
        productName: nameBySku.get(sku) ?? null,
        expected,
        counted,
        variance,
      })),
    };
  });

  res.json({ entries, stockChecks });
}));

// Create or update the entry for a (date, kind) — assign names, edit notes,
// cancel/restore a default, or add an ad-hoc in-week run.
router.put('/', asyncHandler(async (req, res) => {
  const { date, kind, status, assignees, notes } = upsertSchema.parse(req.body);
  const day = new Date(`${date}T00:00:00.000Z`);

  const entry = await prisma.restockPlanEntry.upsert({
    where: { date_kind: { date: day, kind } },
    create: { date: day, kind, status, assignees, notes: notes ?? null },
    update: { status, assignees, notes: notes ?? null },
  });

  res.json(entry);
}));

// Remove an entry — the day reverts to its Monday/Friday default (or to
// nothing, for an ad-hoc day).
router.delete('/:id', asyncHandler(async (req, res) => {
  await prisma.restockPlanEntry.deleteMany({ where: { id: req.params.id } });
  res.json({ success: true });
}));

export default router;
