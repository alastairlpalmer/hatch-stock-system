import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { findLegacyDuplicates } from '../utils/sales-dedupe.js';

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
  if (endDate) conditions.push(Prisma.sql`s."timestamp" <= ${new Date(endDate)}`);

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

// Get sales with filters
router.get('/', asyncHandler(async (req, res) => {
  const { startDate, endDate, sku, limit = 1000 } = req.query;

  const where = {};
  if (sku) where.sku = sku;
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
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
      productRows.push({
        sku: sale.sku,
        name: sale.productName,
        category: sale.category || null,
        unitCost: sale.costPrice ?? null,
        salePrice: sale.charged ?? null,
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
      COALESCE(p.category, 'Other')   AS category,
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
  const end = endDate ? new Date(endDate) : new Date();

  const where = analyticsWhere({ startDate: start, endDate: end, locationName: req.query.locationName });

  const rows = await prisma.$queryRaw`
    SELECT
      to_char(s."timestamp", 'YYYY-MM-DD')                     AS date,
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
      COALESCE(p.category, 'Other')      AS category,
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
