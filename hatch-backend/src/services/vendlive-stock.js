import prisma from '../utils/db.js';
import * as vendliveApi from './vendlive.js';

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

  // Process all products from VendLive
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

    // 5. Update LocationStock to match VendLive's confirmed quantity
    await prisma.locationStock.upsert({
      where: { locationId_sku: { locationId, sku } },
      update: { quantity: confirmed },
      create: { locationId, sku, quantity: confirmed },
    });
    productsUpdated++;
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
