import express from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * Build the shared WHERE fragment for analytics queries.
 * Refunded sales are excluded from all revenue/profit figures.
 */
function analyticsWhere({ startDate, endDate }) {
  const conditions = [Prisma.sql`s.is_refunded = false`];
  if (startDate) conditions.push(Prisma.sql`s."timestamp" >= ${new Date(startDate)}`);
  if (endDate) conditions.push(Prisma.sql`s."timestamp" <= ${new Date(endDate)}`);
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
  const newSales = validSales.filter(s => !existingIds.has(s.id));

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
    newProducts: productRows.map(p => p.sku),
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
      COALESCE(SUM(s.quantity), 0)::int                      AS units
    FROM sales s
    WHERE ${where}
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

  const where = analyticsWhere({ startDate: start, endDate: end });

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
      COALESCE(SUM(s.charged), 0)::float                     AS revenue,
      COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS cost,
      COALESCE(SUM(s.quantity), 0)::int                      AS units,
      COUNT(*)::int                                          AS transactions
    FROM sales s
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
