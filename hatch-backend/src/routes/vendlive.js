import express from 'express';
import crypto from 'crypto';
import prisma from '../utils/db.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { encrypt, decrypt, hasEncryptionKey } from '../utils/encryption.js';
import * as vendliveApi from '../services/vendlive.js';
import { normalizeWebhookPayload, processVendliveOrder, runPollSync } from '../services/vendlive-sync.js';
import { syncProductCatalog } from '../services/vendlive-stock.js';

const router = express.Router();

/**
 * Verify a webhook signature using HMAC-SHA256.
 *
 * Supports the common pattern `X-<vendor>-Signature: sha256=<hex>` OR a bare
 * hex string. The signature is computed as HMAC-SHA256 of the raw request body
 * using the configured webhookSecret.
 *
 * FAILS CLOSED: if no webhookSecret is configured the request is rejected.
 * The previous skip-when-unconfigured behaviour meant anyone who knew the URL
 * could inject fake sales. Set the secret in Admin > VendLive (and in the
 * VendLive dashboard) before enabling the webhook.
 */
function verifyWebhookSignature(req, webhookSecret) {
  if (!webhookSecret) {
    console.error('VendLive webhook: webhookSecret not configured — rejecting unsigned request. Configure it in Admin > VendLive.');
    return false;
  }
  if (!req.rawBody) {
    console.error('VendLive webhook: no raw body captured for signature verification');
    return false;
  }

  // Look for a signature in any of the common header names
  const headerValue =
    req.get('X-Vendlive-Signature') ||
    req.get('X-Webhook-Signature') ||
    req.get('X-Signature');

  if (!headerValue) {
    console.error('VendLive webhook: no signature header found');
    return false;
  }

  // Strip an optional "sha256=" prefix
  const provided = headerValue.replace(/^sha256=/, '').trim();

  let secret;
  try {
    // webhookSecret may be stored encrypted; attempt decrypt, fall back to raw
    secret = webhookSecret.includes(':') ? decrypt(webhookSecret) : webhookSecret;
  } catch {
    secret = webhookSecret;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  // Constant-time comparison
  const providedBuf = Buffer.from(provided, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

// ============ CONFIG ============

// GET /api/vendlive/config — return current config (token masked)
router.get('/config', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });

  if (!config) {
    return res.json({
      apiToken: null,
      accountId: null,
      baseUrl: 'https://vendlive.com/api/2.0',
      webhookSecret: null,
      salesSyncEnabled: false,
      pollIntervalMin: 15,
      autoCreateProducts: true,
      lastPollSaleId: null,
      lastPollAt: null,
    });
  }

  res.json({
    ...config,
    apiToken: config.apiToken ? '***' : null,
    webhookSecret: config.webhookSecret ? '***' : null,
  });
}));

// PUT /api/vendlive/config — update config
router.put('/config', asyncHandler(async (req, res) => {
  const {
    apiToken, accountId, baseUrl, webhookSecret, salesSyncEnabled, pollIntervalMin,
    autoCreateProducts, productSyncEnabled, productSyncIntervalMin,
    // These three were accepted by the Admin UI but silently DROPPED here —
    // the stock-sync toggle looked like it worked while the DB never changed
    // (the root cause of stock sync being off for a week in July 2026).
    stockSyncEnabled, stockPollIntervalMin, autoShrinkageCalc, restockMovementTypes,
  } = req.body;

  const data = {};
  if (accountId !== undefined) data.accountId = accountId;
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (salesSyncEnabled !== undefined) data.salesSyncEnabled = salesSyncEnabled;
  if (pollIntervalMin !== undefined) data.pollIntervalMin = parseInt(pollIntervalMin);
  if (autoCreateProducts !== undefined) data.autoCreateProducts = autoCreateProducts;
  if (productSyncEnabled !== undefined) data.productSyncEnabled = productSyncEnabled;
  if (productSyncIntervalMin !== undefined) data.productSyncIntervalMin = parseInt(productSyncIntervalMin);
  if (stockSyncEnabled !== undefined) data.stockSyncEnabled = stockSyncEnabled;
  if (stockPollIntervalMin !== undefined) data.stockPollIntervalMin = parseInt(stockPollIntervalMin);
  if (autoShrinkageCalc !== undefined) data.autoShrinkageCalc = autoShrinkageCalc;
  if (restockMovementTypes !== undefined) data.restockMovementTypes = restockMovementTypes;

  // Encrypt token if provided and not the masked value
  if (apiToken && apiToken !== '***') {
    if (!hasEncryptionKey()) {
      return res.status(400).json({ error: 'VENDLIVE_ENCRYPTION_KEY is not configured on the server' });
    }
    data.apiToken = encrypt(apiToken);
  }

  if (webhookSecret && webhookSecret !== '***') {
    if (!hasEncryptionKey()) {
      return res.status(400).json({ error: 'VENDLIVE_ENCRYPTION_KEY is not configured on the server' });
    }
    data.webhookSecret = encrypt(webhookSecret);
  }

  const config = await prisma.vendliveConfig.upsert({
    where: { id: 'default' },
    update: data,
    create: { id: 'default', ...data },
  });

  res.json({
    ...config,
    apiToken: config.apiToken ? '***' : null,
    webhookSecret: config.webhookSecret ? '***' : null,
  });
}));

// ============ CONNECTION TEST ============

// POST /api/vendlive/test-connection
router.post('/test-connection', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ success: false, error: 'API token not configured' });
  }

  const result = await vendliveApi.testConnection(config);
  res.json(result);
}));

// ============ MACHINES ============

// GET /api/vendlive/machines — proxy VendLive machines list
router.get('/machines', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'API token not configured' });
  }

  const machines = await vendliveApi.getMachines(config);
  res.json(machines);
}));

// ============ MACHINE MAPPINGS ============

// GET /api/vendlive/machine-mappings
router.get('/machine-mappings', asyncHandler(async (req, res) => {
  const mappings = await prisma.vendliveMachineMapping.findMany({
    include: {
      location: { select: { id: true, name: true, type: true } },
    },
    orderBy: { machineName: 'asc' },
  });
  res.json(mappings);
}));

// PUT /api/vendlive/machine-mappings/:vendliveMachineId
router.put('/machine-mappings/:vendliveMachineId', asyncHandler(async (req, res) => {
  const vendliveMachineId = parseInt(req.params.vendliveMachineId);
  if (isNaN(vendliveMachineId)) {
    return res.status(400).json({ error: 'Invalid vendliveMachineId' });
  }
  const { machineName, locationId } = req.body;

  const mapping = await prisma.vendliveMachineMapping.upsert({
    where: { vendliveMachineId },
    update: { locationId: locationId || null, machineName: machineName || undefined },
    create: {
      vendliveMachineId,
      machineName: machineName || `Machine ${vendliveMachineId}`,
      locationId: locationId || null,
    },
    include: {
      location: { select: { id: true, name: true, type: true } },
    },
  });

  res.json(mapping);
}));

// POST /api/vendlive/machine-mappings/auto-detect — fetch machines and create mapping entries
router.post('/machine-mappings/auto-detect', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'API token not configured' });
  }

  const machines = await vendliveApi.getMachines(config);
  let created = 0;
  let updated = 0;
  let existing = 0;
  let conflicts = 0;

  for (const machine of machines) {
    const machineId = machine.id || machine.pk;
    const name = machine.friendly_name || machine.friendlyName || machine.name || `Machine ${machineId}`;

    const exists = await prisma.vendliveMachineMapping.findUnique({
      where: { vendliveMachineId: machineId },
    });

    if (exists) {
      existing++;
      continue;
    }

    // The sales-feed ingest may have created this machine's row first, keyed
    // by name with the SALES-namespace id sitting in vendliveMachineId. Adopt
    // that row — point vendliveMachineId at the /machines/ namespace id —
    // instead of creating a duplicate. Prefer a location-mapped row when the
    // old namespace bug left duplicates behind.
    const byName = await prisma.vendliveMachineMapping.findMany({
      where: { machineName: name },
      orderBy: { createdAt: 'asc' },
    });
    const adopt = byName.find(m => m.locationId) || byName[0] || null;

    if (adopt) {
      const data = { vendliveMachineId: machineId };
      if (adopt.salesMachineId == null && adopt.autoCreated && adopt.vendliveMachineId !== machineId) {
        // Sales-created row that was never backfilled: its vendliveMachineId
        // IS the sales-feed id — preserve it before overwriting.
        data.salesMachineId = adopt.vendliveMachineId;
      }
      try {
        await prisma.vendliveMachineMapping.update({ where: { id: adopt.id }, data });
        updated++;
      } catch (err) {
        if (err.code === 'P2002') {
          // Another row already holds one of these ids — needs a manual
          // merge; log and carry on rather than failing the whole detect.
          console.error(`VendLive auto-detect: id conflict adopting mapping "${name}" (machine ${machineId}): ${err.message}`);
          conflicts++;
        } else {
          throw err;
        }
      }
      continue;
    }

    await prisma.vendliveMachineMapping.create({
      data: {
        vendliveMachineId: machineId,
        machineName: name,
        autoCreated: true,
      },
    });
    created++;
  }

  res.json({ created, updated, existing, conflicts, total: machines.length });
}));

// ============ WEBHOOK ============

// POST /api/vendlive/webhook/sales — VendLive order_sales webhook receiver
router.post('/webhook/sales', async (req, res) => {
  // Verify signature BEFORE responding. If verification fails we 401 so
  // VendLive's dashboard surfaces the problem rather than silently dropping.
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });

  if (!verifyWebhookSignature(req, config?.webhookSecret)) {
    console.warn('VendLive webhook: rejected request with invalid or missing signature');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Always return 200 immediately to prevent VendLive from retrying
  res.status(200).json({ received: true });

  // Process asynchronously
  try {
    if (!config?.salesSyncEnabled) {
      console.log('VendLive webhook received but sync is disabled');
      return;
    }

    const orderData = normalizeWebhookPayload(req.body);
    // Machine mapping resolution (name-keyed lookup, sales-feed id backfill,
    // auto-create for brand-new machines — never a second row for a known
    // name) happens inside processVendliveOrder via resolveSalesMachineMapping.
    const result = await processVendliveOrder(orderData, 'webhook', config);

    // Log the sync
    const status = result.errored > 0 ? (result.created > 0 ? 'partial' : 'error') : 'success';
    await prisma.vendliveSyncLog.create({
      data: {
        syncType: 'webhook',
        status,
        salesCreated: result.created,
        salesSkipped: result.skipped,
        salesErrored: result.errored,
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : null,
        metadata: {
          orderSaleId: orderData.orderSaleId,
          itemCount: orderData.items.length,
          quarantined: result.quarantined,
        },
      },
    });
  } catch (err) {
    console.error('Webhook processing error:', err);
    await prisma.vendliveSyncLog.create({
      data: {
        syncType: 'webhook',
        status: 'error',
        errorMessage: err.message,
      },
    }).catch(() => {}); // Don't let logging errors propagate
  }
});

// ============ SYNC ============

// POST /api/vendlive/sync/sales — manual poll sync trigger
router.post('/sync/sales', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'API token not configured' });
  }

  try {
    const result = await runPollSync();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}));

// POST /api/vendlive/sync/products — proactively pull the full product catalog
// from VendLive so products exist in our DB before they are ever sold.
router.post('/sync/products', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(400).json({ error: 'API token not configured' });
  }

  try {
    const result = await syncProductCatalog(config);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Product catalog sync failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}));

// GET /api/vendlive/sync/logs — recent sync history
router.get('/sync/logs', asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;

  const logs = await prisma.vendliveSyncLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(parseInt(limit) || 50, 500),
  });

  res.json(logs);
}));

// GET /api/vendlive/sync/status — quick status for frontend status bar
router.get('/sync/status', asyncHandler(async (req, res) => {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });

  // Get today's VendLive sales
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todaySales = await prisma.sale.aggregate({
    where: {
      syncSource: { in: ['webhook', 'poll'] },
      timestamp: { gte: todayStart },
    },
    _count: true,
    _sum: { charged: true },
  });

  // Get last sync log
  const lastSync = await prisma.vendliveSyncLog.findFirst({
    where: { status: 'success' },
    orderBy: { createdAt: 'desc' },
  });

  // Get latest VendLive sale timestamp
  const lastSale = await prisma.sale.findFirst({
    where: { syncSource: { in: ['webhook', 'poll'] } },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });

  res.json({
    active: config?.salesSyncEnabled || false,
    connected: !!(config?.apiToken),
    lastSyncAt: lastSync?.createdAt || null,
    lastSaleAt: lastSale?.timestamp || null,
    todaySalesCount: todaySales._count || 0,
    todaySalesRevenue: todaySales._sum?.charged || 0,
  });
}));

// ============ QUARANTINE ============

// GET /api/vendlive/quarantine — quarantined sales, unresolved first (newest
// first within each group), plus the unresolved count for badges.
router.get('/quarantine', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);

  const [unresolvedCount, unresolvedRows] = await Promise.all([
    prisma.vendliveQuarantinedSale.count({ where: { resolvedAt: null } }),
    prisma.vendliveQuarantinedSale.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const remaining = limit - unresolvedRows.length;
  const resolvedRows = remaining > 0
    ? await prisma.vendliveQuarantinedSale.findMany({
        where: { resolvedAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: remaining,
      })
    : [];

  res.json({ unresolved: unresolvedCount, rows: [...unresolvedRows, ...resolvedRows] });
}));

// POST /api/vendlive/quarantine/replay — book every unresolved quarantined
// sale whose SKU now exists in the catalog (by sku, with a barcode fallback —
// both unique columns, so the lookups are cheap). The payload IS the Sale
// create row, so replay is a plain insert. Deliberately does NOT decrement
// location stock: the machine already vended the unit long ago, and a later
// full machine stock sync reflects reality — retro-decrementing now would
// double-count.
router.post('/quarantine/replay', asyncHandler(async (req, res) => {
  const rows = await prisma.vendliveQuarantinedSale.findMany({
    where: { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
  });

  let replayed = 0;
  let stillUnknown = 0;
  let alreadyExisted = 0;

  for (const row of rows) {
    const payload = row.payload;
    const sku = payload?.sku || row.sku;
    if (!sku) {
      stillUnknown++;
      continue;
    }

    let product = await prisma.product.findUnique({ where: { sku } });
    if (!product) {
      product = await prisma.product.findUnique({ where: { barcode: sku } });
    }
    if (!product) {
      stillUnknown++;
      continue;
    }

    try {
      await prisma.sale.create({
        data: {
          ...payload,
          sku: product.sku, // barcode match: book under the catalog SKU
          timestamp: new Date(payload.timestamp),
        },
      });
      replayed++;
    } catch (err) {
      if (err.code !== 'P2002') {
        console.error(`VendLive quarantine replay failed for ${row.id}:`, err.message);
        stillUnknown++;
        continue;
      }
      alreadyExisted++; // duplicate — the sale got in some other way
    }

    await prisma.vendliveQuarantinedSale.update({
      where: { id: row.id },
      data: { resolvedAt: new Date() },
    });
  }

  res.json({ replayed, stillUnknown, alreadyExisted });
}));

// DELETE /api/vendlive/quarantine/:id — discard a quarantined sale for good.
router.delete('/quarantine/:id', asyncHandler(async (req, res) => {
  try {
    await prisma.vendliveQuarantinedSale.delete({ where: { id: req.params.id } });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Quarantined sale not found' });
    }
    throw err;
  }
  res.json({ deleted: true });
}));

// ============ HEALTH ============

// GET /api/vendlive/health — one cheap endpoint answering "is the VendLive
// integration actually working?": sales-sync freshness (counting partials
// that still created sales — /sync/status ignores those), stock-sync
// freshness, quarantine backlog, unmapped machines and recent errors.
router.get('/health', asyncHandler(async (req, res) => {
  const now = Date.now();
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });

  const [lastSalesSync, lastSale, lastStockSync, quarantineUnresolved, unmappedMachines, errorsLast24h] = await Promise.all([
    // A 'partial' run with salesCreated > 0 is still a working pipeline —
    // only counting 'success' would flag a healthy-but-noisy sync as dead.
    prisma.vendliveSyncLog.findFirst({
      where: {
        OR: [
          { status: 'success' },
          { status: 'partial', salesCreated: { gt: 0 } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.sale.findFirst({
      where: { syncSource: { in: ['webhook', 'poll'] } },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    }),
    prisma.vendliveStockSync.findFirst({
      where: { status: 'success' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
    prisma.vendliveQuarantinedSale.count({ where: { resolvedAt: null } }),
    prisma.vendliveMachineMapping.count({ where: { locationId: null } }),
    prisma.vendliveSyncLog.count({
      where: { status: 'error', createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  const salesEnabled = config?.salesSyncEnabled || false;
  const pollIntervalMin = config?.pollIntervalMin || 15;
  const salesStaleAfterMs = Math.max(3 * pollIntervalMin, 30) * 60 * 1000;
  const salesStale = salesEnabled &&
    (!lastSalesSync || now - lastSalesSync.createdAt.getTime() > salesStaleAfterMs);

  const stockEnabled = config?.stockSyncEnabled || false;
  // 24h staleness window (was 4 days — long enough to hide a whole broken
  // week). The poll job's 6h staleness-fallback sync means a healthy system
  // never comes close to this threshold, weekends included.
  const stockStale = stockEnabled &&
    (!lastStockSync || now - lastStockSync.createdAt.getTime() > 24 * 60 * 60 * 1000);

  const productSyncEnabled = config?.productSyncEnabled || false;

  // A disabled sync is a LOUD condition, not a quiet one: with stock or
  // product sync off, quantities drift and each week's new rotating flavours
  // never enter the catalog — and nothing else in the app says why.
  const syncsDisabled = [
    !salesEnabled && 'sales',
    !stockEnabled && 'stock',
    !productSyncEnabled && 'products',
  ].filter(Boolean);

  res.json({
    salesSync: {
      enabled: salesEnabled,
      lastSuccessAt: lastSalesSync?.createdAt || null,
      lastSaleAt: lastSale?.timestamp || null,
      pollIntervalMin,
      stale: salesStale,
    },
    stockSync: {
      enabled: stockEnabled,
      lastSyncAt: lastStockSync?.createdAt || null,
      stale: stockStale,
    },
    productSync: {
      enabled: productSyncEnabled,
      lastSyncAt: config?.lastProductSyncAt || null,
    },
    syncsDisabled,
    quarantine: { unresolved: quarantineUnresolved },
    unmappedMachines,
    errorsLast24h,
    ok: !salesStale && !stockStale && syncsDisabled.length === 0 &&
      quarantineUnresolved === 0 && unmappedMachines === 0,
  });
}));

// ============ PREDICTIONS ============

// VendLive's own restock predictions for a location's machines — an
// informational cross-check against our ordering engine, never merged into
// suggestion lines. Wraps /stock-report/?predictions (previously dead code in
// services/vendlive.js). Upstream failures surface as 502, not 500: the
// feature is best-effort by design.
router.get('/predictions', asyncHandler(async (req, res) => {
  const { locationId } = req.query;
  if (!locationId) {
    return res.status(400).json({ error: 'locationId required' });
  }

  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config?.apiToken) {
    return res.status(409).json({ error: 'VendLive not configured' });
  }

  const mappings = await prisma.vendliveMachineMapping.findMany({
    where: { locationId },
  });
  if (mappings.length === 0) {
    return res.status(404).json({ error: 'No machines mapped to this location' });
  }

  try {
    const machines = [];
    for (const mapping of mappings) {
      const data = await vendliveApi.getStockReport(config, {
        machineId: mapping.vendliveMachineId,
        predictions: true,
      });
      machines.push({
        machineId: mapping.vendliveMachineId,
        machineName: mapping.machineName,
        products: vendliveApi.normalizeStockReport(data),
      });
    }
    res.json({ locationId, machines });
  } catch (err) {
    res.status(502).json({ error: 'VendLive predictions unavailable', detail: err.message });
  }
}));

export default router;
