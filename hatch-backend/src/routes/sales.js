import express from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { findLegacyDuplicates } from '../utils/sales-dedupe.js';
import { guessFreshMeal } from '../services/meal-classifier.js';
import { SALE_LOCATION_JOINS } from '../utils/sales-location.js';
import { exclusiveEndBound } from '../utils/date-range.js';

const router = express.Router();

/**
 * Build the shared WHERE fragment for analytics queries.
 * Refunded sales are excluded from all revenue/profit figures unless
 * includeRefunded is set (used to report how much was excluded).
 * locationName scopes to one or more locations (string or array — VendLive
 * can report the same physical site under several names, so the UI lets
 * users select and combine multiple). The literal 'Unknown' matches sales
 * with no location recorded.
 */
function analyticsWhere({ startDate, endDate, locationName }, { includeRefunded = false } = {}) {
  const conditions = [includeRefunded ? Prisma.sql`s.is_refunded = true` : Prisma.sql`s.is_refunded = false`];
  if (startDate) conditions.push(Prisma.sql`s."timestamp" >= ${new Date(startDate)}`);
  if (endDate) {
    conditions.push(Prisma.sql`s."timestamp" < ${exclusiveEndBound(endDate)}`);
  }

  const names = [].concat(locationName || []).filter(n => n && n !== 'all');
  if (names.length > 0) {
    const parts = names.map(n =>
      n === 'Unknown'
        ? Prisma.sql`(s.location_name IS NULL OR s.location_name = 'Unknown')`
        : Prisma.sql`s.location_name = ${n}`
    );
    conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return Prisma.join(conditions, ' AND ');
}

// Effective category for category-level rollups: Frive fresh-meal flavours roll
// up into their meal-type bucket instead of their raw category. Mirrors
// effectiveCategory() in services/analytics.js — keep the two in lockstep.
// Assumes the sales table is aliased `s` and joined to products aliased `p`.
const EFFECTIVE_CATEGORY = Prisma.sql`
  CASE
    WHEN p.is_fresh_meal = true AND p.meal_type IS NOT NULL THEN 'Frive ' || p.meal_type
    WHEN p.is_fresh_meal = true THEN 'Frive (unclassified)'
    ELSE COALESCE(p.category, 'Other')
  END`;

// Get sales with filters
router.get('/', asyncHandler(async (req, res) => {
  const { startDate, endDate, sku, limit = 1000 } = req.query;

  const where = {};
  if (sku) where.sku = sku;
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) {
      where.timestamp.lt = exclusiveEndBound(endDate);
    }
  }

  const sales = await prisma.sale.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: parseInt(limit),
    include: {
      product: {
        select: { category: true }
      }
    }
  });

  // Flatten product category into sale object
  const salesWithCategory = sales.map(sale => ({
    ...sale,
    category: sale.product?.category || null,
    product: undefined, // Remove nested product object
  }));

  res.json(salesWithCategory);
}));

// Import sales from CSV data
router.post('/import', asyncHandler(async (req, res) => {
  const { sales, filename } = req.body;

  if (!Array.isArray(sales)) {
    return res.status(400).json({ error: 'Sales array required' });
  }

  const validSales = sales.filter(s => s?.id && s?.sku);

  // Bulk de-duplicate against existing sale IDs (was one query per row)
  const existingIds = new Set(
    (await prisma.sale.findMany({
      where: { id: { in: validSales.map(s => s.id) } },
      select: { id: true },
    })).map(s => s.id)
  );
  let newSales = validSales.filter(s => !existingIds.has(s.id));

  // Guard against re-importing sales the VendLive sync already holds under a
  // different id (the cause of the June 2026 double-counted revenue): match
  // incoming rows against existing VendLive sales by SKU + timestamp window
  // and skip any that pair up.
  let crossSourceSkipped = 0;
  if (newSales.length > 0) {
    const timestamps = newSales.map(s => new Date(s.timestamp).getTime()).filter(t => !isNaN(t));
    if (timestamps.length > 0) {
      const PAD = 10 * 60 * 1000;
      const existingVendlive = await prisma.sale.findMany({
        where: {
          id: { startsWith: 'vl-' },
          timestamp: {
            gte: new Date(Math.min(...timestamps) - PAD),
            lte: new Date(Math.max(...timestamps) + PAD),
          },
        },
        select: { id: true, sku: true, timestamp: true },
      });
      const dupes = findLegacyDuplicates(newSales, existingVendlive);
      const dupeIds = new Set(dupes.map(d => d.legacyId));
      crossSourceSkipped = dupeIds.size;
      newSales = newSales.filter(s => !dupeIds.has(s.id));
    }
  }

  // Bulk-create any products we haven't seen
  const skus = [...new Set(newSales.map(s => s.sku))];
  const existingSkus = new Set(
    (await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    })).map(p => p.sku)
  );

  const productRows = [];
  for (const sale of newSales) {
    if (!existingSkus.has(sale.sku) && sale.productName) {
      existingSkus.add(sale.sku);
      // Best-effort fresh-meal guess (unconfirmed) so Frive flavours imported
      // via CSV also surface in the review queue. The CSV category feeds the
      // classifier too — "Fresh Meals" flags a flavour name keywords miss.
      const meal = guessFreshMeal(sale.productName, { category: sale.category });
      productRows.push({
        sku: sale.sku,
        name: sale.productName,
        category: sale.category || null,
        unitCost: sale.costPrice ?? null,
        salePrice: sale.charged ?? null,
        isFreshMeal: meal.isFreshMeal,
        mealType: meal.mealType,
      });
    }
  }

  // Only import sales whose product exists (or was just created)
  const importable = newSales.filter(s => existingSkus.has(s.sku));

  const [, createResult] = await prisma.$transaction([
    prisma.product.createMany({ data: productRows, skipDuplicates: true }),
    prisma.sale.createMany({
      data: importable.map(sale => ({
        id: sale.id,
        sku: sale.sku,
        productName: sale.productName,
        quantity: sale.quantity || 1,
        charged: sale.charged,
        costPrice: sale.costPrice,
        paymentMethod: sale.paymentMethod,
        locationName: sale.locationName,
        machineName: sale.machineName,
        timestamp: new Date(sale.timestamp),
        syncSource: 'csv_import',
      })),
      skipDuplicates: true,
    }),
    prisma.salesImport.create({
      data: {
        filename: filename || 'manual-import',
        recordsAdded: importable.length,
        recordsTotal: sales.length,
      },
    }),
  ]);

  res.json({
    success: true,
    recordsAdded: createResult.count,
    recordsSkipped: sales.length - createResult.count,
    recordsTotal: sales.length,
    duplicatesOfVendliveSales: crossSourceSkipped,
    newProducts: productRows.map(p => p.sku),
  });
}));

// Find (and optionally remove) legacy CSV rows that duplicate VendLive-synced
// sales. dryRun defaults to TRUE — nothing is deleted unless the caller
// explicitly sends { dryRun: false }. The VendLive copy is always the one
// kept (actual amount paid, refund tracking, machine metadata).
router.post('/deduplicate', asyncHandler(async (req, res) => {
  const dryRun = req.body?.dryRun !== false;

  const [legacy, vendlive] = await Promise.all([
    prisma.sale.findMany({
      where: { NOT: { id: { startsWith: 'vl-' } } },
      select: { id: true, sku: true, timestamp: true, charged: true, productName: true },
    }),
    prisma.sale.findMany({
      where: { id: { startsWith: 'vl-' } },
      select: { id: true, sku: true, timestamp: true },
    }),
  ]);

  const duplicates = findLegacyDuplicates(legacy, vendlive);
  const value = duplicates.reduce((acc, d) => acc + d.charged, 0);

  if (!dryRun && duplicates.length > 0) {
    const result = await prisma.sale.deleteMany({
      where: { id: { in: duplicates.map(d => d.legacyId) } },
    });
    console.log(`Sales dedupe: removed ${result.count} duplicate legacy rows (£${value.toFixed(2)})`);
  }

  res.json({
    dryRun,
    duplicates: duplicates.length,
    value,
    legacyTotal: legacy.length,
    sample: duplicates.slice(0, 10),
  });
}));

// Distinct location names across all sales, with volume and date range —
// powers the merge-locations admin tool (date ranges let the user verify an
// alias doesn't span a machine move before merging it).
router.get('/location-names', asyncHandler(async (req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT
      COALESCE(s.location_name, 'Unknown') AS name,
      COUNT(*)::int                        AS sales,
      COALESCE(SUM(s.charged), 0)::float   AS revenue,
      MIN(s."timestamp")                   AS first_sale,
      MAX(s."timestamp")                   AS last_sale
    FROM sales s
    GROUP BY 1
    ORDER BY sales DESC
  `;
  res.json(rows.map(r => ({
    name: r.name,
    sales: r.sales,
    revenue: r.revenue,
    firstSale: r.first_sale,
    lastSale: r.last_sale,
  })));
}));

// Diagnose how reliably sales resolve to a Hatch locationId — the prerequisite
// for per-location sales velocity in order generation. Reports the split by
// resolution path (machine mapping vs name fallback vs unresolved) and lists the
// top unresolved names / unmapped machine ids so the admin knows what to fix
// (add a machine mapping, or merge an alias name onto a Location's name).
router.get('/location-resolution', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const conditions = [Prisma.sql`s.is_refunded = false`];
  if (startDate) conditions.push(Prisma.sql`s."timestamp" >= ${new Date(startDate)}`);
  if (endDate) {
    conditions.push(Prisma.sql`s."timestamp" < ${exclusiveEndBound(endDate)}`);
  }
  const where = Prisma.join(conditions, ' AND ');

  const [summary] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int                                                                AS total,
      COUNT(*) FILTER (WHERE vmm.location_id IS NOT NULL)::int                      AS via_machine,
      COUNT(*) FILTER (WHERE vmm.location_id IS NULL AND lname.id IS NOT NULL)::int AS via_name,
      COUNT(*) FILTER (WHERE vmm.location_id IS NULL AND lname.id IS NULL)::int     AS unresolved
    FROM sales s
    ${SALE_LOCATION_JOINS}
    WHERE ${where}
  `;

  const unresolved = await prisma.$queryRaw`
    SELECT
      COALESCE(s.location_name, 'Unknown') AS location_name,
      s.vendlive_machine_id                AS vendlive_machine_id,
      COUNT(*)::int                        AS sales
    FROM sales s
    ${SALE_LOCATION_JOINS}
    WHERE ${where} AND vmm.location_id IS NULL AND lname.id IS NULL
    GROUP BY 1, 2
    ORDER BY sales DESC
    LIMIT 50
  `;

  res.json({
    summary,
    unresolved: unresolved.map(r => ({
      locationName: r.location_name,
      vendliveMachineId: r.vendlive_machine_id,
      sales: r.sales,
    })),
  });
}));

// Merge historical location names: rename sales recorded under alias names
// (e.g. a machine name used before mappings existed) to the canonical site
// name. NAME-based by design — never machine-based — so it stays correct
// when machines move between sites: each alias only existed while the
// machine sat at that site, and post-move sales carry the new site's name
// from the machine mapping. dryRun defaults to TRUE.
export const mergeLocationsSchema = z.object({
  from: z.array(z.string().min(1)).min(1),
  to: z.string().min(1),
  dryRun: z.boolean().optional().default(true),
});

router.post('/merge-locations', asyncHandler(async (req, res) => {
  const { from, to, dryRun } = mergeLocationsSchema.parse(req.body);
  const sources = [...new Set(from)].filter(n => n !== to);
  if (sources.length === 0) {
    return res.status(400).json({ error: 'No source names to merge (the target name is excluded automatically)' });
  }

  const where = {
    OR: sources.map(n => n === 'Unknown'
      ? { OR: [{ locationName: null }, { locationName: 'Unknown' }] }
      : { locationName: n }),
  };

  const affected = await prisma.sale.count({ where });
  let renamed = 0;
  if (!dryRun && affected > 0) {
    const result = await prisma.sale.updateMany({ where, data: { locationName: to } });
    renamed = result.count;
    console.log(`Sales location merge: renamed ${renamed} sales from [${sources.join(', ')}] to "${to}"`);
  }

  res.json({ dryRun, affected, renamed, from: sources, to });
}));

// Get sales analytics -- aggregated in the database, refunds excluded
router.get('/analytics', asyncHandler(async (req, res) => {
  const where = analyticsWhere(req.query);

  const [totalsRow] = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int                                          AS transactions,
      COALESCE(SUM(s.charged), 0)::float                     AS revenue,
      COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS cost,
      COALESCE(SUM(s.quantity), 0)::int                      AS units,
      COUNT(*) FILTER (WHERE s.charged = 0)::int             AS free_vends
    FROM sales s
    WHERE ${where}
  `;

  // What was excluded as refunded — reported so totals can be reconciled
  // against VendLive's own figures.
  const refundedWhere = analyticsWhere(req.query, { includeRefunded: true });
  const [refundedRow] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(s.charged), 0)::float AS value
    FROM sales s
    WHERE ${refundedWhere}
  `;

  const categoryRows = await prisma.$queryRaw`
    SELECT
      ${EFFECTIVE_CATEGORY}              AS category,
      COALESCE(SUM(s.charged), 0)::float AS revenue,
      COALESCE(SUM(s.quantity), 0)::int  AS units,
      COUNT(*)::int                      AS transactions
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY 1
  `;

  const byCategory = {};
  for (const row of categoryRows) {
    byCategory[row.category] = {
      revenue: row.revenue,
      units: row.units,
      transactions: row.transactions,
    };
  }

  const totalRevenue = totalsRow.revenue;
  const totalCost = totalsRow.cost;

  res.json({
    totalRevenue,
    totalCost,
    totalProfit: totalRevenue - totalCost,
    totalTransactions: totalsRow.transactions,
    totalUnits: totalsRow.units,
    avgTransactionValue: totalsRow.transactions > 0 ? totalRevenue / totalsRow.transactions : 0,
    freeVends: totalsRow.free_vends,
    refundedCount: refundedRow.count,
    refundedValue: refundedRow.value,
    byCategory,
  });
}));

// Get daily sales -- aggregated in the database, refunds excluded
router.get('/daily', asyncHandler(async (req, res) => {
  const { startDate, endDate, days = 30 } = req.query;

  let start;
  if (startDate) {
    start = new Date(startDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - parseInt(days));
  }
  // Pass the raw endDate through so date-only strings stay day-inclusive
  // (a pre-converted Date would read as an exact instant).
  const end = endDate || new Date();

  const where = analyticsWhere({ startDate: start, endDate: end, locationName: req.query.locationName });

  // London local days, matching getDailyTransactions in services/analytics.js —
  // UTC bucketing here made this chart disagree with the analytics dashboard
  // at day boundaries during BST.
  const rows = await prisma.$queryRaw`
    SELECT
      to_char((s."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS date,
      COALESCE(SUM(s.charged), 0)::float                     AS revenue,
      COALESCE(SUM(s.quantity), 0)::int                      AS units,
      COUNT(*)::int                                          AS transactions,
      COALESCE(SUM(s.charged - COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS profit
    FROM sales s
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  res.json(rows);
}));

// Get daily sales split by category -- aggregated in the database, refunds
// excluded. Powers the stacked "revenue by category per day" chart. Same
// date/location scoping and effective-category rollup (Frive fresh meals) as
// /daily and /by-category so the figures reconcile exactly.
router.get('/daily-by-category', asyncHandler(async (req, res) => {
  const { startDate, endDate, days = 30 } = req.query;

  let start;
  if (startDate) {
    start = new Date(startDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - parseInt(days));
  }
  // Raw endDate for the same day-inclusive reason as /daily above.
  const end = endDate || new Date();

  const where = analyticsWhere({ startDate: start, endDate: end, locationName: req.query.locationName });

  // London local days — must match /daily above so the two charts reconcile.
  const rows = await prisma.$queryRaw`
    SELECT
      to_char((s."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS date,
      ${EFFECTIVE_CATEGORY}                 AS category,
      COALESCE(SUM(s.charged), 0)::float    AS revenue,
      COALESCE(SUM(s.quantity), 0)::int     AS units
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY 1, 2
    ORDER BY 1 ASC
  `;

  res.json(rows);
}));

// Get sales by product -- aggregated in the database, refunds excluded
router.get('/by-product', asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;
  const where = analyticsWhere(req.query);

  const rows = await prisma.$queryRaw`
    SELECT
      s.sku,
      COALESCE(MAX(s.product_name), s.sku)                   AS name,
      COALESCE(MAX(p.category), 'Other')                     AS category,
      COALESCE(SUM(s.charged), 0)::float                     AS revenue,
      COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS cost,
      COALESCE(SUM(s.quantity), 0)::int                      AS units,
      COUNT(*)::int                                          AS transactions
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY s.sku
    ORDER BY revenue DESC
    LIMIT ${parseInt(limit)}
  `;

  const products = rows.map(p => ({
    ...p,
    profit: p.revenue - p.cost,
    margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100).toFixed(1) : 0,
  }));

  res.json(products);
}));

// Get sales by category -- aggregated in the database, refunds excluded
router.get('/by-category', asyncHandler(async (req, res) => {
  const where = analyticsWhere(req.query);

  const rows = await prisma.$queryRaw`
    SELECT
      ${EFFECTIVE_CATEGORY}              AS category,
      COALESCE(SUM(s.charged), 0)::float AS revenue,
      COALESCE(SUM(s.quantity), 0)::int  AS units,
      COUNT(*)::int                      AS transactions
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY 1
    ORDER BY revenue DESC
  `;

  res.json(rows);
}));

// Get import history
router.get('/imports', asyncHandler(async (req, res) => {
  const imports = await prisma.salesImport.findMany({
    orderBy: { importedAt: 'desc' },
    take: 50,
  });

  res.json(imports);
}));

export default router;
