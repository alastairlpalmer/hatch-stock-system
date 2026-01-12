import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = express.Router();

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

  let recordsAdded = 0;
  let recordsSkipped = 0;
  const newProducts = [];

  for (const sale of sales) {
    // Check if sale already exists
    const existing = await prisma.sale.findUnique({
      where: { id: sale.id },
    });

    if (existing) {
      recordsSkipped++;
      continue;
    }

    // Check if product exists, create if not
    let product = await prisma.product.findUnique({
      where: { sku: sale.sku },
    });

    if (!product && sale.productName) {
      product = await prisma.product.create({
        data: {
          sku: sale.sku,
          name: sale.productName,
          category: sale.category,
          unitCost: sale.costPrice,
          salePrice: sale.charged,
        },
      });
      newProducts.push(product.sku);
    }

    // Create sale record
    await prisma.sale.create({
      data: {
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
      },
    });

    recordsAdded++;
  }

  // Create import record
  await prisma.salesImport.create({
    data: {
      filename: filename || 'manual-import',
      recordsAdded,
      recordsTotal: sales.length,
    },
  });

  res.json({
    success: true,
    recordsAdded,
    recordsSkipped,
    recordsTotal: sales.length,
    newProducts,
  });
}));

// Get sales analytics
router.get('/analytics', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const where = {};
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  const sales = await prisma.sale.findMany({ where });

  // Calculate analytics
  const totalRevenue = sales.reduce((sum, s) => sum + s.charged, 0);
  const totalCost = sales.reduce((sum, s) => sum + (s.costPrice || 0), 0);
  const totalProfit = totalRevenue - totalCost;
  const totalTransactions = sales.length;
  const totalUnits = sales.reduce((sum, s) => sum + s.quantity, 0);
  const avgTransactionValue = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

  // Category breakdown
  const byCategory = {};
  sales.forEach(s => {
    const cat = s.category || 'Other';
    if (!byCategory[cat]) {
      byCategory[cat] = { revenue: 0, units: 0, transactions: 0 };
    }
    byCategory[cat].revenue += s.charged;
    byCategory[cat].units += s.quantity;
    byCategory[cat].transactions++;
  });

  res.json({
    totalRevenue,
    totalCost,
    totalProfit,
    totalTransactions,
    totalUnits,
    avgTransactionValue,
    byCategory,
  });
}));

// Get daily sales
router.get('/daily', asyncHandler(async (req, res) => {
  const { startDate, endDate, days = 30 } = req.query;

  let start, end;
  if (startDate) {
    start = new Date(startDate);
  } else {
    start = new Date();
    start.setDate(start.getDate() - parseInt(days));
  }
  end = endDate ? new Date(endDate) : new Date();

  const sales = await prisma.sale.findMany({
    where: {
      timestamp: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { timestamp: 'asc' },
  });

  // Group by day
  const daily = {};
  sales.forEach(s => {
    const day = s.timestamp.toISOString().split('T')[0];
    if (!daily[day]) {
      daily[day] = { date: day, revenue: 0, units: 0, transactions: 0, profit: 0 };
    }
    daily[day].revenue += s.charged;
    daily[day].units += s.quantity;
    daily[day].transactions++;
    daily[day].profit += s.charged - (s.costPrice || 0);
  });

  res.json(Object.values(daily));
}));

// Get sales by product
router.get('/by-product', asyncHandler(async (req, res) => {
  const { startDate, endDate, limit = 50 } = req.query;

  const where = {};
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  const sales = await prisma.sale.findMany({ where });

  // Group by product
  const byProduct = {};
  sales.forEach(s => {
    if (!byProduct[s.sku]) {
      byProduct[s.sku] = {
        sku: s.sku,
        name: s.productName || s.sku,
        revenue: 0,
        cost: 0,
        units: 0,
        transactions: 0,
      };
    }
    byProduct[s.sku].revenue += s.charged;
    byProduct[s.sku].cost += s.costPrice || 0;
    byProduct[s.sku].units += s.quantity;
    byProduct[s.sku].transactions++;
  });

  // Calculate profit and margin
  const products = Object.values(byProduct).map(p => ({
    ...p,
    profit: p.revenue - p.cost,
    margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100).toFixed(1) : 0,
  }));

  // Sort by revenue
  products.sort((a, b) => b.revenue - a.revenue);

  res.json(products.slice(0, parseInt(limit)));
}));

// Get sales by category
router.get('/by-category', asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const where = {};
  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  const sales = await prisma.sale.findMany({
    where,
    include: { product: { select: { category: true } } },
  });

  // Group by category
  const byCategory = {};
  sales.forEach(s => {
    const cat = s.product?.category || 'Other';
    if (!byCategory[cat]) {
      byCategory[cat] = { category: cat, revenue: 0, units: 0, transactions: 0 };
    }
    byCategory[cat].revenue += s.charged;
    byCategory[cat].units += s.quantity;
    byCategory[cat].transactions++;
  });

  res.json(Object.values(byCategory).sort((a, b) => b.revenue - a.revenue));
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
