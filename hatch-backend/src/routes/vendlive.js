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
  const { apiToken, accountId, baseUrl, webhookSecret, salesSyncEnabled, pollIntervalMin, autoCreateProducts, productSyncEnabled, productSyncIntervalMin } = req.body;

  const data = {};
  if (accountId !== undefined) data.accountId = accountId;
  if (baseUrl !== undefined) data.baseUrl = baseUrl;
  if (salesSyncEnabled !== undefined) data.salesSyncEnabled = salesSyncEnabled;
  if (pollIntervalMin !== undefined) data.pollIntervalMin = parseInt(pollIntervalMin);
  if (autoCreateProducts !== undefined) data.autoCreateProducts = autoCreateProducts;
  if (productSyncEnabled !== undefined) data.productSyncEnabled = productSyncEnabled;
  if (productSyncIntervalMin !== undefined) data.productSyncIntervalMin = parseInt(productSyncIntervalMin);

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
  let existing = 0;

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

    await prisma.vendliveMachineMapping.create({
      data: {
        vendliveMachineId: machineId,
        machineName: name,
        autoCreated: true,
      },
    });
    created++;
  }

  res.json({ created, existing, total: machines.length });
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
    const result = await processVendliveOrder(orderData, 'webhook', config);

    // Auto-create machine mapping if we see a new machine. Use upsert to
    // avoid the findUnique+create race condition when webhooks arrive
    // concurrently for a new machine.
    const uniqueMachineIds = [...new Set(orderData.items.map(i => i.machineId).filter(Boolean))];
    for (const machineId of uniqueMachineIds) {
      await prisma.vendliveMachineMapping.upsert({
        where: { vendliveMachineId: machineId },
        create: {
          vendliveMachineId: machineId,
          machineName: orderData.machineName || `Machine ${machineId}`,
          autoCreated: true,
        },
        update: {}, // Existing mappings are left untouched
      }).catch(err => {
        console.error(`VendLive webhook: failed to upsert mapping for machine ${machineId}:`, err.message);
      });
    }

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
        metadata: { orderSaleId: orderData.orderSaleId, itemCount: orderData.items.length },
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
    take: parseInt(limit),
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

export default router;
