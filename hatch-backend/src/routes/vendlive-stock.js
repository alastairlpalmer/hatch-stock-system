import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as vendliveApi from '../services/vendlive.js';
import { syncMachineStock, syncAllMachines, detectRestockEvents } from '../services/vendlive-stock.js';

const router = express.Router();

// ============ STOCK SYNC ENDPOINTS ============

/**
 * POST /api/vendlive/stock/sync/:machineId
 * Manually trigger a stock sync for a specific machine.
 */
router.post('/sync/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const vendliveMachineId = parseInt(req.params.machineId);
  if (isNaN(vendliveMachineId)) {
    return res.status(400).json({ error: 'Invalid machineId' });
  }

  // Find the mapping to get the locationId
  const mapping = await prisma.vendliveMachineMapping.findUnique({
    where: { vendliveMachineId },
  });

  if (!mapping?.locationId) {
    return res.status(400).json({ error: 'Machine not mapped to a location. Map it in Admin first.' });
  }

  try {
    const result = await syncMachineStock(vendliveMachineId, mapping.locationId, config, 'manual_pull');
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Stock sync error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

/**
 * POST /api/vendlive/stock/sync-all
 * Trigger stock sync for all mapped machines.
 */
router.post('/sync-all', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  try {
    const result = await syncAllMachines(config);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Stock sync-all error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

/**
 * GET /api/vendlive/stock/movements/:machineId
 * Proxy VendLive stock movements for a machine (last 7 days by default).
 */
router.get('/movements/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);
  const days = parseInt(req.query.days) || 7;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { results } = await vendliveApi.getStockMovements(config, { machineId, startDate });

  res.json({
    machineId,
    days,
    movements: results.map(m => ({
      id: m.id,
      productName: m.product?.name || 'Unknown',
      productSku: m.product?.externalId || String(m.product?.id),
      quantity: m.quantity,
      movementType: m.movementType,
      eventType: m.eventType,
      operatorName: m.operator?.name || null,
      channel: m.channel,
      createdAt: m.createdAtUtc,
      expiryDate: m.expiryDateUtc,
    })),
  });
}));

/**
 * GET /api/vendlive/stock/live/:machineId
 * Proxy VendLive channel data — current stock per product with channel details.
 */
router.get('/live/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);
  const channels = await vendliveApi.getChannels(config, { machineId });

  // Aggregate stock per product
  const productStock = {};
  for (const ch of channels) {
    const product = ch?.product;
    if (!product) continue;

    const sku = product.externalId || String(product.id);
    if (!productStock[sku]) {
      productStock[sku] = {
        sku,
        productName: product.name,
        category: product.category?.name || null,
        imageUrl: product.image?.file || null,
        totalStock: 0,
        idealCapacity: 0,
        lowStockLevel: 0,
        channelCount: 0,
        channels: [],
      };
    }

    const stockLevel = parseFloat(ch.stockLevel) || 0;
    productStock[sku].totalStock += stockLevel;
    productStock[sku].idealCapacity += (ch.idealCapacity || 0);
    productStock[sku].lowStockLevel += (ch.lowStockLevel || 0);
    productStock[sku].channelCount++;
    productStock[sku].channels.push({
      channelId: ch.id,
      shelf: ch.shelf,
      stockLevel,
      idealCapacity: ch.idealCapacity,
      productPrice: ch.productPrice,
      items: (ch.items || []).map(item => ({
        quantity: item.quantity,
        expiryDate: item.expiryDate,
      })),
    });
  }

  res.json({
    machineId,
    totalChannels: channels.length,
    products: Object.values(productStock),
  });
}));

/**
 * GET /api/vendlive/stock/syncs
 * Stock sync history with pagination.
 */
router.get('/syncs', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const machineId = req.query.machineId ? parseInt(req.query.machineId) : undefined;

  const where = {};
  if (machineId) where.vendliveMachineId = machineId;

  const [syncs, total] = await Promise.all([
    prisma.vendliveStockSync.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { location: { select: { name: true } } },
    }),
    prisma.vendliveStockSync.count({ where }),
  ]);

  res.json({
    syncs: syncs.map(s => ({
      id: s.id,
      vendliveMachineId: s.vendliveMachineId,
      locationName: s.location?.name || null,
      syncType: s.syncType,
      status: s.status,
      productsUpdated: s.productsUpdated,
      totalVariance: s.totalVariance,
      varianceCost: s.varianceCost,
      errorMessage: s.errorMessage,
      metadata: s.metadata,
      createdAt: s.createdAt,
    })),
    total,
    limit,
    offset,
  });
}));

// ============ API DISCOVERY ENDPOINTS ============

/**
 * GET /api/vendlive/stock/discover/movements/:machineId
 */
router.get('/discover/movements/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const data = await vendliveApi.getStockMovements(config, { machineId, startDate, singlePage: true });
    const results = data?.results || data?.data || (Array.isArray(data) ? data : []);

    res.json({
      machineId,
      totalResults: results.length,
      discovery: {
        movementTypes: [...new Set(results.map(r => r.movementType).filter(Boolean))],
        eventTypes: [...new Set(results.map(r => r.eventType).filter(Boolean))],
        fieldNames: results.length > 0 ? Object.keys(results[0]) : [],
      },
      sampleResults: results.slice(0, 5),
      pagination: { count: data?.count, next: data?.next, page: data?.page, totalPages: data?.totalPages },
    });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status });
  }
}));

/**
 * GET /api/vendlive/stock/discover/channels/:machineId
 */
router.get('/discover/channels/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);

  try {
    const channels = await vendliveApi.getChannels(config, { machineId });

    const productStock = {};
    for (const channel of channels) {
      const sku = channel?.product?.externalId || String(channel?.product?.id);
      const productName = channel?.product?.name || 'Unknown';
      const stockLevel = parseFloat(channel?.stockLevel || 0);

      if (!productStock[sku]) {
        productStock[sku] = { sku, productName, totalStock: 0, channelCount: 0 };
      }
      productStock[sku].totalStock += stockLevel;
      productStock[sku].channelCount += 1;
    }

    res.json({
      machineId,
      totalChannels: channels.length,
      discovery: {
        fieldNames: channels.length > 0 ? Object.keys(channels[0]) : [],
        productFieldNames: channels.length > 0 && channels[0]?.product ? Object.keys(channels[0].product) : [],
      },
      stockByProduct: Object.values(productStock),
      sampleChannels: channels.slice(0, 3),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, status: err.response?.status });
  }
}));

/**
 * GET /api/vendlive/stock/discover/machines
 */
router.get('/discover/machines', asyncHandler(async (req, res) => {
  const mappings = await prisma.vendliveMachineMapping.findMany({
    include: { location: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json({
    machines: mappings.map(m => ({
      vendliveMachineId: m.vendliveMachineId,
      machineName: m.machineName,
      locationId: m.locationId,
      locationName: m.location?.name || null,
    })),
  });
}));

export default router;
