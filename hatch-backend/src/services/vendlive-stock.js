import prisma from '../utils/db.js';
import * as vendliveApi from './vendlive.js';
import { guessFreshMeal } from './meal-classifier.js';

/**
 * Aggregate channel data into per-product stock totals.
 * Handles both externalId and product.id as SKU fallback.
 * Returns: { [sku]: { sku, productName, totalStock, costPrice, channels: [...] } }
 */
function aggregateChannelStock(channels) {
  const productStock = {};

  for (const channel of channels) {
    const product = channel?.product;
    if (!product) continue;

    // Use externalId if available, otherwise fall back to String(product.id)
    const sku = product.externalId || String(product.id);
    const productName = product.name || 'Unknown';
    const stockLevel = parseFloat(channel.stockLevel) || 0;
    const costPrice = parseFloat(product.costPrice) || 0;

    if (!productStock[sku]) {
      productStock[sku] = {
        sku,
        productName,
        costPrice,
        category: product.category?.name || null,
        salePrice: parseFloat(channel?.productPrice) || null,
        totalStock: 0,
        channelCount: 0,
        channels: [],
      };
    }

    productStock[sku].totalStock += stockLevel;
    productStock[sku].channelCount += 1;
    productStock[sku].channels.push({
      channelId: channel.id,
      shelf: channel.shelf,
      stockLevel,
      lowStockLevel: channel.lowStockLevel || 0,
      idealCapacity: channel.idealCapacity || null,
      productPrice: channel.productPrice,
      items: (channel.items || []).map(item => ({
        quantity: item.quantity,
        expiryDate: item.expiryDate || null,
      })),
    });
  }

  return productStock;
}

/**
 * Earliest non-null item expiry across a SKU's aggregated channels (null when
 * no channel reports one). VendLive item expiry dates arrive as strings;
 * unparseable values are skipped rather than poisoning the comparison.
 */
function earliestChannelExpiry(channels) {
  let earliest = null;
  for (const channel of channels || []) {
    for (const item of channel.items || []) {
      if (!item.expiryDate) continue;
      const d = new Date(item.expiryDate);
      if (isNaN(d.getTime())) continue;
      if (!earliest || d < earliest) earliest = d;
    }
  }
  return earliest;
}

/**
 * Sync stock for a single machine.
 * Pulls channel data from VendLive, compares to Hatch LocationStock,
 * updates LocationStock to match VendLive, and calculates shrinkage.
 *
 * Returns: { productsUpdated, totalVariance, varianceCost, items: [...] }
 */
export async function syncMachineStock(vendliveMachineId, locationId, config, syncType = 'manual_pull') {
  console.log(`Stock sync: starting for machine ${vendliveMachineId} → location ${locationId}`);

  // 1. Fetch all channels from VendLive
  const channels = await vendliveApi.getChannels(config, { machineId: vendliveMachineId });
  const vendliveStock = aggregateChannelStock(channels);

  // 2. Load current Hatch location stock
  const hatchStock = await prisma.locationStock.findMany({
    where: { locationId },
    include: { product: { select: { sku: true, name: true, unitCost: true } } },
  });
  const hatchStockMap = {};
  for (const ls of hatchStock) {
    hatchStockMap[ls.sku] = { quantity: ls.quantity, unitCost: ls.product?.unitCost || 0 };
  }

  // 3. Bulk-check which products exist in Hatch
  const allSkus = Object.keys(vendliveStock);
  const existingProducts = await prisma.product.findMany({
    where: { sku: { in: allSkus } },
    select: { sku: true },
  });
  const existingSkuSet = new Set(existingProducts.map(p => p.sku));

  // Auto-create missing products if enabled
  const autoCreate = config.autoCreateProducts ?? false;
  const missingSkus = allSkus.filter(sku => !existingSkuSet.has(sku));

  if (missingSkus.length > 0 && autoCreate) {
    for (const sku of missingSkus) {
      const vl = vendliveStock[sku];
      await prisma.product.create({
        data: {
          sku,
          name: vl.productName,
          category: vl.category || null,
          unitCost: vl.costPrice || null,
          salePrice: vl.salePrice || null,
        },
      }).catch(() => {}); // Ignore if race condition
      existingSkuSet.add(sku);
    }
    console.log(`Stock sync: auto-created ${missingSkus.length} products`);
  } else if (missingSkus.length > 0) {
    console.log(`Stock sync: ${missingSkus.length} products not in Hatch (auto-create disabled): ${missingSkus.slice(0, 5).join(', ')}`);
  }

  // 4. Compare and calculate variance for each product
  const items = [];
  let totalVariance = 0;
  let varianceCost = 0;
  let productsUpdated = 0;
  let productsSkipped = 0;

  // Build variance data AND prepare upsert operations in a single pass.
  // Upserts are batched into $transaction chunks to avoid exhausting the
  // connection pool (same pattern as runPollSync in vendlive-sync.js).
  const upsertOperations = [];

  for (const [sku, vl] of Object.entries(vendliveStock)) {
    // Skip products that don't exist in Hatch
    if (!existingSkuSet.has(sku)) {
      productsSkipped++;
      continue;
    }

    const confirmed = Math.round(vl.totalStock); // VendLive's confirmed stock
    const expected = hatchStockMap[sku]?.quantity ?? 0; // Hatch's expected stock
    const variance = expected - confirmed; // Positive = shrinkage, negative = overage
    const unitCost = hatchStockMap[sku]?.unitCost || vl.costPrice || 0;
    const cost = Math.abs(variance) * unitCost;

    items.push({
      sku,
      productName: vl.productName,
      expected,
      confirmed,
      variance,
      unitCost,
      varianceCost: variance > 0 ? cost : -cost,
    });

    if (variance !== 0) {
      totalVariance += variance;
      varianceCost += variance > 0 ? cost : -cost;
    }

    // Earliest expiry among this SKU's machine channels — refreshed wholesale
    // on every sync (null when VendLive reports none), so a cleared machine
    // doesn't keep a stale alert. Rows the sync doesn't touch keep theirs.
    const earliestExpiry = earliestChannelExpiry(vl.channels);

    upsertOperations.push(
      prisma.locationStock.upsert({
        where: { locationId_sku: { locationId, sku } },
        update: { quantity: confirmed, earliestExpiry },
        create: { locationId, sku, quantity: confirmed, earliestExpiry },
      })
    );
  }

  // 5. Run upserts in batched transactions (chunks of STOCK_BATCH_SIZE)
  const STOCK_BATCH_SIZE = 50;
  for (let i = 0; i < upsertOperations.length; i += STOCK_BATCH_SIZE) {
    const chunk = upsertOperations.slice(i, i + STOCK_BATCH_SIZE);
    try {
      await prisma.$transaction(chunk);
      productsUpdated += chunk.length;
    } catch (err) {
      console.error(`Stock sync: batch ${Math.floor(i / STOCK_BATCH_SIZE) + 1} failed: ${err.message}`);
      throw err; // Surface the error — caller logs and records in VendliveStockSync
    }
  }

  // 5. If auto shrinkage calc is enabled and there's variance, create a StockCheck
  const hasVariance = items.some(i => i.variance !== 0);
  let stockCheckId = null;

  // 6. Create a VendliveStockSync log
  const stockSync = await prisma.vendliveStockSync.create({
    data: {
      vendliveMachineId,
      locationId,
      syncType,
      status: 'success',
      productsUpdated,
      totalVariance,
      varianceCost,
      metadata: {
        channelCount: channels.length,
        productCount: Object.keys(vendliveStock).length,
        items: items.filter(i => i.variance !== 0), // Only store variance items in metadata
      },
    },
  });

  if (hasVariance && config.autoShrinkageCalc) {
    const stockCheck = await prisma.stockCheck.create({
      data: {
        locationId,
        performedBy: 'VendLive Auto-Sync',
        source: 'vendlive',
        vendliveStockSyncId: stockSync.id,
        items: items.filter(i => i.variance !== 0).map(i => ({
          sku: i.sku,
          expected: i.expected,
          counted: i.confirmed,
          variance: i.variance,
          reason: 'unknown', // Operator can categorise later via Shrinkage page
        })),
      },
    });
    stockCheckId = stockCheck.id;
  }

  console.log(`Stock sync: machine ${vendliveMachineId} complete. ${productsUpdated} updated, ${productsSkipped} skipped, variance: ${totalVariance} units, £${varianceCost.toFixed(2)}`);

  return {
    syncId: stockSync.id,
    productsUpdated,
    productsSkipped,
    totalVariance,
    varianceCost,
    stockCheckId,
    items,
  };
}

/**
 * Sync stock for all mapped machines that have a locationId.
 * Returns summary of all syncs.
 */
export async function syncAllMachines(config) {
  const mappings = await prisma.vendliveMachineMapping.findMany({
    where: { locationId: { not: null } },
  });

  if (mappings.length === 0) {
    return { machinesSynced: 0, message: 'No machines mapped to locations' };
  }

  const results = [];
  for (const mapping of mappings) {
    try {
      const result = await syncMachineStock(
        mapping.vendliveMachineId,
        mapping.locationId,
        config,
        'scheduled',
      );
      results.push({ machineId: mapping.vendliveMachineId, machineName: mapping.machineName, ...result });
    } catch (err) {
      console.error(`Stock sync error for machine ${mapping.vendliveMachineId}:`, err.message);
      // Log the error but continue with other machines
      await prisma.vendliveStockSync.create({
        data: {
          vendliveMachineId: mapping.vendliveMachineId,
          locationId: mapping.locationId,
          syncType: 'scheduled',
          status: 'error',
          errorMessage: err.message,
        },
      }).catch(() => {}); // Don't fail if logging fails
      results.push({ machineId: mapping.vendliveMachineId, machineName: mapping.machineName, error: err.message });
    }
  }

  return {
    machinesSynced: results.filter(r => !r.error).length,
    machinesErrored: results.filter(r => r.error).length,
    results,
  };
}

/**
 * Proactively sync the full VendLive product catalog into our products table.
 *
 * Products are normally created lazily — only when first SOLD (sales ingest) or
 * when a mapped machine's stock is synced. That leaves VendLive products that
 * have never sold absent from our DB. This walks EVERY machine's planogram
 * (getChannels PER machineId — the same call the stock sync uses and which is
 * known to work; a bare /channels/ with no machineId does not return reliably)
 * and upserts each distinct product:
 *   - missing products are created (with a best-effort fresh-meal guess, exactly
 *     like the sales-ingest auto-create path);
 *   - existing products have their name / category / cost / sale price refreshed
 *     from VendLive, but their fresh-meal classification is left untouched so a
 *     human-confirmed (or pending-review) mealType is never clobbered.
 *
 * upsert (not create/update) is used so the every-minute stock/sales sync
 * auto-creating the same product concurrently can't trip a unique-key error and
 * fail the whole run. Prices are only written when VendLive reports a positive
 * value, so a real cost/price is never overwritten with 0.
 *
 * Returns { created, updated, total, channelCount, machineCount }.
 */
export async function syncProductCatalog(config) {
  console.log('Product catalog sync: fetching machine list from VendLive...');
  const machines = await vendliveApi.getMachines(config);
  const machineIds = [...new Set((machines || []).map(m => m?.id).filter(Boolean))];
  console.log(`Product catalog sync: scanning ${machineIds.length} machines`);

  // Aggregate every machine's planogram into one product map (first-seen wins —
  // identity/pricing fields are the same across a product's channels).
  const catalog = {};
  let channelCount = 0;
  for (const machineId of machineIds) {
    try {
      const channels = await vendliveApi.getChannels(config, { machineId });
      channelCount += channels.length;
      const perMachine = aggregateChannelStock(channels);
      for (const [sku, vl] of Object.entries(perMachine)) {
        if (!catalog[sku]) catalog[sku] = vl;
      }
    } catch (err) {
      // One bad machine must not sink the whole catalog sync.
      console.error(`Product catalog sync: failed to fetch channels for machine ${machineId}: ${err.message}`);
    }
  }

  const allSkus = Object.keys(catalog);
  console.log(`Product catalog sync: ${allSkus.length} distinct products across ${channelCount} channels`);

  // Classify created vs updated for the returned counts (best-effort: a product
  // created concurrently between this read and the upsert just lands as an
  // "updated" instead — the upsert itself stays correct either way).
  const existing = await prisma.product.findMany({
    where: { sku: { in: allSkus } },
    select: { sku: true },
  });
  const existingSet = new Set(existing.map(p => p.sku));

  let created = 0;
  let updated = 0;
  const ops = [];

  for (const [sku, vl] of Object.entries(catalog)) {
    const meal = guessFreshMeal(vl.productName);
    ops.push(prisma.product.upsert({
      where: { sku },
      create: {
        sku,
        name: vl.productName,
        category: vl.category || null,
        unitCost: vl.costPrice > 0 ? vl.costPrice : null,
        salePrice: vl.salePrice > 0 ? vl.salePrice : null,
        isFreshMeal: meal.isFreshMeal,
        mealType: meal.mealType,
      },
      update: {
        name: vl.productName,
        ...(vl.category != null && { category: vl.category }),
        ...(vl.costPrice > 0 && { unitCost: vl.costPrice }),
        ...(vl.salePrice > 0 && { salePrice: vl.salePrice }),
        // fresh-meal classification intentionally left untouched on update
      },
    }));
    if (existingSet.has(sku)) updated++; else created++;
  }

  // Run in batched transactions to avoid exhausting the connection pool
  // (same chunking pattern as syncMachineStock).
  const CHUNK = 50;
  for (let i = 0; i < ops.length; i += CHUNK) {
    await prisma.$transaction(ops.slice(i, i + CHUNK));
  }

  await prisma.vendliveSyncLog.create({
    data: {
      syncType: 'product_catalog',
      status: 'success',
      salesCreated: created,   // generic counters reused: created products
      salesSkipped: updated,   //                          updated products
      metadata: { created, updated, total: allSkus.length, channelCount, machineCount: machineIds.length },
    },
  }).catch(() => {}); // logging is best-effort, never fail the sync over it

  console.log(`Product catalog sync: complete — ${created} created, ${updated} updated (${allSkus.length} products across ${channelCount} channels, ${machineIds.length} machines)`);
  return { created, updated, total: allSkus.length, channelCount, machineCount: machineIds.length };
}

/**
 * Poll stock movements for a machine and detect restock events.
 * A restock is detected when movementType matches any configured restock type.
 * Returns: { restockDetected: boolean, movements: [...] }
 */
export async function detectRestockEvents(vendliveMachineId, config) {
  const restockTypes = (config.restockMovementTypes || 'In').split(',').map(t => t.trim());

  // Get or create movement tracker
  let tracker = await prisma.vendliveMovementTracker.findUnique({
    where: { vendliveMachineId },
  });

  const startDate = tracker?.lastMovementAt
    ? new Date(tracker.lastMovementAt).toISOString().split('T')[0]
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // Default: last 7 days

  // Fetch movements with full pagination
  const { results: movements } = await vendliveApi.getStockMovements(config, {
    machineId: vendliveMachineId,
    startDate,
  });

  // Filter to only new movements (after the last tracked ID)
  const lastId = tracker?.lastMovementId || 0;
  const newMovements = movements.filter(m => m.id > lastId);

  if (newMovements.length === 0) {
    return { restockDetected: false, newMovements: 0 };
  }

  // Check for restock-type movements
  const restockMovements = newMovements.filter(m => restockTypes.includes(m.movementType));

  // Update tracker with highest movement ID
  const highestId = Math.max(...newMovements.map(m => m.id));
  const latestMovement = newMovements.find(m => m.id === highestId);

  await prisma.vendliveMovementTracker.upsert({
    where: { vendliveMachineId },
    update: {
      lastMovementId: highestId,
      lastMovementAt: new Date(latestMovement.createdAtUtc),
      lastSyncAt: new Date(),
    },
    create: {
      vendliveMachineId,
      lastMovementId: highestId,
      lastMovementAt: new Date(latestMovement.createdAtUtc),
      lastSyncAt: new Date(),
    },
  });

  console.log(`Movement poll: machine ${vendliveMachineId} — ${newMovements.length} new movements, ${restockMovements.length} restock events`);

  return {
    restockDetected: restockMovements.length > 0,
    newMovements: newMovements.length,
    restockMovements: restockMovements.length,
    movementTypes: [...new Set(newMovements.map(m => m.movementType))],
  };
}

/**
 * Run the stock movement polling job.
 * Checks all mapped machines for new movements, triggers sync if restock detected.
 */
export async function runStockPollJob() {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config || !config.stockSyncEnabled || !config.apiToken) {
    return null;
  }

  const mappings = await prisma.vendliveMachineMapping.findMany({
    where: { locationId: { not: null } },
  });

  let syncsTriggered = 0;

  for (const mapping of mappings) {
    try {
      const detection = await detectRestockEvents(mapping.vendliveMachineId, config);

      if (detection.restockDetected) {
        console.log(`Stock poll: restock detected at machine ${mapping.vendliveMachineId}, triggering sync`);
        await syncMachineStock(
          mapping.vendliveMachineId,
          mapping.locationId,
          config,
          'restock_detected',
        );
        syncsTriggered++;
      }
    } catch (err) {
      console.error(`Stock poll error for machine ${mapping.vendliveMachineId}:`, err.message);
    }
  }

  return { machinesChecked: mappings.length, syncsTriggered };
}
