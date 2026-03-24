import express from 'express';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import * as vendliveApi from '../services/vendlive.js';

const router = express.Router();

// ============ API DISCOVERY ENDPOINTS ============
// These return raw VendLive responses so we can inspect the real data format
// before building the full sync logic.

/**
 * GET /api/vendlive/stock/discover/movements/:machineId
 * Fetches stock movements for a machine and returns raw data + distinct types.
 */
router.get('/discover/movements/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);
  if (isNaN(machineId)) {
    return res.status(400).json({ error: 'Invalid machineId' });
  }

  // Fetch last 30 days of movements
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  try {
    const data = await vendliveApi.getStockMovements(config, {
      machineId,
      startDate,
    });

    // Extract distinct field values to understand the data
    const results = data?.results || data?.data || (Array.isArray(data) ? data : []);
    const distinctMovementTypes = [...new Set(results.map(r => r.movementType).filter(Boolean))];
    const distinctEventTypes = [...new Set(results.map(r => r.eventType).filter(Boolean))];

    // Also check snake_case variants in case API uses different casing
    const distinctMovementTypesSnake = [...new Set(results.map(r => r.movement_type).filter(Boolean))];
    const distinctEventTypesSnake = [...new Set(results.map(r => r.event_type).filter(Boolean))];

    res.json({
      machineId,
      totalResults: results.length,
      discovery: {
        movementTypes: distinctMovementTypes,
        eventTypes: distinctEventTypes,
        movementTypesSnakeCase: distinctMovementTypesSnake,
        eventTypesSnakeCase: distinctEventTypesSnake,
        // Show all top-level field names from first result
        fieldNames: results.length > 0 ? Object.keys(results[0]) : [],
      },
      // Return first 5 results as sample data
      sampleResults: results.slice(0, 5),
      // Pagination info from response
      pagination: {
        count: data?.count,
        next: data?.next,
        previous: data?.previous,
        page: data?.page,
        totalPages: data?.totalPages,
      },
      // Full raw response structure (without results, to keep response small)
      rawResponseKeys: Object.keys(data || {}),
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      status: err.response?.status,
      responseData: err.response?.data,
    });
  }
}));

/**
 * GET /api/vendlive/stock/discover/channels/:machineId
 * Fetches channel data for a machine and returns raw data.
 */
router.get('/discover/channels/:machineId', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'VendLive API token not configured' });
  }

  const machineId = parseInt(req.params.machineId);
  if (isNaN(machineId)) {
    return res.status(400).json({ error: 'Invalid machineId' });
  }

  try {
    const data = await vendliveApi.getChannels(config, { machineId });

    const results = data?.results || data?.data || (Array.isArray(data) ? data : []);

    // Aggregate stock per product
    const productStock = {};
    for (const channel of results) {
      const sku = channel?.product?.externalId || channel?.product?.external_id || String(channel?.product?.id);
      const productName = channel?.product?.name || 'Unknown';
      const stockLevel = parseFloat(channel?.stockLevel || channel?.stock_level || 0);

      if (!productStock[sku]) {
        productStock[sku] = { sku, productName, totalStock: 0, channelCount: 0 };
      }
      productStock[sku].totalStock += stockLevel;
      productStock[sku].channelCount += 1;
    }

    res.json({
      machineId,
      totalChannels: results.length,
      discovery: {
        fieldNames: results.length > 0 ? Object.keys(results[0]) : [],
        productFieldNames: results.length > 0 && results[0]?.product ? Object.keys(results[0].product) : [],
      },
      // Aggregated stock per product
      stockByProduct: Object.values(productStock),
      // First 3 channels as sample
      sampleChannels: results.slice(0, 3),
      // Pagination info
      pagination: {
        count: data?.count,
        next: data?.next,
        previous: data?.previous,
      },
      rawResponseKeys: Object.keys(data || {}),
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
      status: err.response?.status,
      responseData: err.response?.data,
    });
  }
}));

/**
 * GET /api/vendlive/stock/discover/machines
 * Lists all machine mappings with their VendLive IDs so you know which machineId to use.
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
