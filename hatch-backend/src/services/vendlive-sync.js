import prisma from '../utils/db.js';
import * as vendliveApi from './vendlive.js';
import { guessFreshMeal } from './meal-classifier.js';

// ============ PAYLOAD NORMALIZERS ============

/**
 * Normalize a webhook payload (snake_case) into a common internal format.
 * Webhook sends: { id, order_product_sales: [...], machine, location_name, charged, created_at, ... }
 */
export function normalizeWebhookPayload(body) {
  const orderSaleId = parseInt(body.id);
  const items = (body.order_product_sales || []).map(item => ({
    productSaleId: parseInt(item.id),
    productExternalId: item.product_external_id || String(item.product_id),
    machineId: item.machine_id != null ? parseInt(item.machine_id) : null,
    vendStatusName: item.vend_status_name,
    timestamp: item.timestamp,
    price: parseFloat(item.price) || 0,
    costPrice: parseFloat(item.cost_price) || 0,
    totalPaid: parseFloat(item.total_paid) || 0,
    discountValue: parseFloat(item.discount_value) || 0,
    vatRate: parseFloat(item.vat_rate) || 0,
    vatAmount: parseFloat(item.vat_amount) || 0,
    promotionId: item.promotion_id || null,
    voucherCode: item.voucher_code || null,
    isRefunded: item.is_refunded || false,
    errorMessage: item.error_message || null,
  }));

  return {
    orderSaleId,
    machineName: body.machine || null,
    locationName: body.location_name || body.location || null,
    charged: body.charged,
    createdAt: body.created_at,
    items,
  };
}

/**
 * Normalize a polling response entry (camelCase) into the common internal format.
 * Real VendLive API returns:
 *   { id, productSales: [...], machine: { id, friendlyName }, locationName, charged, createdAt }
 *   Each productSale: { id, product: { id, name, externalId, category: { name } },
 *     device: { id, name }, vendStatus, timestamp, price, costPrice, ... }
 */
export function normalizePollPayload(entry) {
  const orderSaleId = parseInt(entry.id);
  const productSales = entry.productSales || entry.order_product_sales || [];

  // machine can be an object { id, friendlyName } or a string
  const machineObj = typeof entry.machine === 'object' && entry.machine !== null ? entry.machine : null;

  const items = productSales.map(item => ({
    productSaleId: parseInt(item.id),
    // Real API: item.product.externalId is often null, fall back to item.product.id
    productExternalId: item.product?.externalId || String(item.product?.id || item.productId || item.product_id || ''),
    productName: item.product?.name || null,
    productCategory: item.product?.category?.name || null,
    // machineId from the item, or from the parent entry's machine object
    machineId: item.machineId || item.machine_id || item.device?.id || machineObj?.id || null,
    // vendStatus (camelCase in real API) or vendStatusName or vend_status_name
    vendStatusName: item.vendStatus || item.vendStatusName || item.vend_status_name,
    timestamp: item.timestamp,
    price: parseFloat(item.price) || 0,
    costPrice: parseFloat(item.costPrice || item.cost_price) || 0,
    totalPaid: parseFloat(item.totalPaid || item.total_paid) || 0,
    discountValue: parseFloat(item.discountValue || item.discount_value) || 0,
    vatRate: parseFloat(item.vatRate || item.vat_rate) || 0,
    vatAmount: parseFloat(item.vatAmount || item.vat_amount) || 0,
    promotionId: item.promotionId || item.promotion_id || null,
    voucherCode: item.voucherCode || item.voucher_code || null,
    isRefunded: item.isRefunded ?? item.is_refunded ?? false,
    errorMessage: item.errorMessage || item.error_message || null,
  }));

  return {
    orderSaleId,
    machineName: machineObj?.friendlyName || (typeof entry.machine === 'string' ? entry.machine : null) || entry.machineName || null,
    machineVendliveId: machineObj?.id || null,
    locationName: entry.locationName || entry.location_name || entry.location || null,
    charged: entry.charged,
    createdAt: entry.createdAt || entry.created_at,
    items,
  };
}

/**
 * Amount actually charged for a sale item.
 * - totalPaid > 0: trust it (covers partial discounts).
 * - totalPaid == 0 with a discount: price minus discount (a 100% discount /
 *   free vend is £0, NOT full price — the old `totalPaid || price` fallback
 *   inflated revenue for every free vend).
 * - otherwise: fall back to price (totalPaid missing from some payloads).
 */
export function computeCharged(item) {
  if (item.totalPaid > 0) return item.totalPaid;
  if (item.discountValue > 0) return Math.max(0, item.price - item.discountValue);
  return item.price;
}

// Money values arrive as decimal strings; below this difference two prices
// are considered equal, so float parsing noise never triggers an update.
const PRICE_EPSILON = 0.005;

/**
 * Compute catalog price/cost updates from one ingest run's sale items.
 * VendLive is the source of truth for pricing: the newest sale's list price
 * (item.price — unaffected by discounts, which arrive separately) and cost
 * price win over whatever the catalog holds. Zero/missing values never
 * overwrite. Returns [{ sku, data: { salePrice?, unitCost? } }] only where
 * a change is actually needed.
 */
export function computeProductPriceUpdates(items, productMap) {
  const latestBySku = new Map();
  for (const item of items) {
    const sku = item.productExternalId;
    if (!sku || !productMap.has(sku)) continue;
    const ts = new Date(item.timestamp || 0).getTime() || 0;
    const prev = latestBySku.get(sku);
    if (!prev || ts > prev.ts || (ts === prev.ts && (item.productSaleId || 0) > (prev.item.productSaleId || 0))) {
      latestBySku.set(sku, { item, ts });
    }
  }

  const updates = [];
  for (const [sku, { item }] of latestBySku) {
    const product = productMap.get(sku);
    const data = {};
    if (item.price > 0 && Math.abs((product.salePrice ?? 0) - item.price) > PRICE_EPSILON) {
      data.salePrice = item.price;
    }
    if (item.costPrice > 0 && Math.abs((product.unitCost ?? 0) - item.costPrice) > PRICE_EPSILON) {
      data.unitCost = item.costPrice;
    }
    if (Object.keys(data).length > 0) updates.push({ sku, data });
  }
  return updates;
}

/**
 * Apply computeProductPriceUpdates to the catalog. Failures are logged and
 * swallowed — pricing refresh must never block sale ingestion or the poll
 * checkpoint.
 */
async function applyProductPriceUpdates(items, productMap) {
  try {
    const updates = computeProductPriceUpdates(items, productMap);
    for (const { sku, data } of updates) {
      await prisma.product.update({ where: { sku }, data });
    }
    if (updates.length > 0) {
      console.log(`VendLive sync: refreshed pricing on ${updates.length} product(s): ${updates.map(u => u.sku).join(', ')}`);
    }
  } catch (err) {
    console.error('VendLive sync: product price refresh failed:', err.message);
  }
}

/** Build the Sale create payload for a normalized item. */
function buildSaleData(orderData, item, product, locationName, syncSource) {
  return {
    id: `vl-${orderData.orderSaleId}-${item.productSaleId}`,
    sku: product.sku,
    productName: item.productName || product.name,
    quantity: 1,
    charged: computeCharged(item),
    costPrice: item.costPrice || product.unitCost || null,
    paymentMethod: null,
    locationName,
    machineName: orderData.machineName,
    timestamp: new Date(item.timestamp || orderData.createdAt || Date.now()),
    vendliveOrderSaleId: orderData.orderSaleId,
    vendliveProductSaleId: item.productSaleId,
    vendliveMachineId: item.machineId || null,
    vendStatus: item.vendStatusName || null,
    discountValue: item.discountValue || null,
    vatRate: item.vatRate || null,
    vatAmount: item.vatAmount || null,
    promotionId: item.promotionId || null,
    voucherCode: item.voucherCode || null,
    isRefunded: item.isRefunded || false,
    syncSource,
  };
}

/**
 * Decrement location stock for newly ingested sales, clamped at 0.
 * `decrements` is a Map of "locationId|sku" -> quantity.
 * Idempotency comes from the caller: only sales seen for the FIRST time
 * contribute to this map, so re-syncs never double-decrement.
 */
async function applySaleStockDecrements(decrements) {
  for (const [key, qty] of decrements) {
    const [locationId, sku] = key.split('|');
    try {
      await prisma.$transaction([
        prisma.locationStock.upsert({
          where: { locationId_sku: { locationId, sku } },
          // No tracked stock yet at this location — start the row at 0
          create: { locationId, sku, quantity: 0 },
          update: { quantity: { decrement: qty } },
        }),
        prisma.locationStock.updateMany({
          where: { locationId, sku, quantity: { lt: 0 } },
          data: { quantity: 0 },
        }),
      ]);
    } catch (err) {
      console.error(`Sale stock decrement failed for location ${locationId}, sku ${sku}:`, err.message);
    }
  }
}

// ============ SALE PROCESSING (webhook path) ============

/**
 * Process a single VendLive order and create Sale records for each product sale item.
 * Newly created sales decrement LocationStock via the machine→location mapping.
 * Returns { created: number, skipped: number, errored: number, errors: string[] }
 */
export async function processVendliveOrder(orderData, syncSource, config) {
  const result = { created: 0, skipped: 0, errored: 0, errors: [] };
  const decrements = new Map();
  const productMap = new Map();
  const pricedItems = [];

  for (const item of orderData.items) {
    try {
      // Only process successful vends
      if (item.vendStatusName && item.vendStatusName !== 'Success') {
        result.skipped++;
        continue;
      }

      // Look up product by SKU (product_external_id)
      const sku = item.productExternalId;
      let product = await prisma.product.findUnique({ where: { sku } });

      if (!product && config?.autoCreateProducts) {
        // Auto-create product with real name if available. Best-effort fresh-meal
        // guess (unconfirmed) so Frive flavours surface in the review queue.
        const meal = guessFreshMeal(item.productName || sku);
        product = await prisma.product.create({
          data: {
            sku,
            name: item.productName || sku,
            unitCost: item.costPrice || null,
            salePrice: item.price || null,
            isFreshMeal: meal.isFreshMeal,
            mealType: meal.mealType,
          },
        });
      }

      if (!product) {
        result.errored++;
        result.errors.push(`Product SKU ${sku} not found (auto-create disabled)`);
        continue;
      }

      // Track for the post-loop pricing refresh (also for re-synced sales —
      // a price fixed in VendLive must reach the catalog either way).
      productMap.set(sku, product);
      pricedItems.push(item);

      // Look up machine mapping for location
      let locationName = orderData.locationName;
      let locationId = null;
      if (item.machineId) {
        const mapping = await prisma.vendliveMachineMapping.findUnique({
          where: { vendliveMachineId: item.machineId },
          include: { location: { select: { id: true, name: true } } },
        });
        if (mapping?.location) {
          locationName = mapping.location.name;
          locationId = mapping.location.id;
        }
      }

      const existing = await prisma.sale.findUnique({
        where: {
          vendliveOrderSaleId_vendliveProductSaleId: {
            vendliveOrderSaleId: orderData.orderSaleId,
            vendliveProductSaleId: item.productSaleId,
          },
        },
        select: { id: true, isRefunded: true },
      });

      if (existing) {
        // Re-sync of a known sale: keep mutable fields current (a sale
        // refunded in VendLive after first ingest must not stay frozen).
        if (existing.isRefunded !== (item.isRefunded || false)) {
          await prisma.sale.update({
            where: { id: existing.id },
            data: { isRefunded: item.isRefunded || false, vendStatus: item.vendStatusName || null },
          });
        }
        result.skipped++;
        continue;
      }

      await prisma.sale.create({
        data: buildSaleData(orderData, item, product, locationName, syncSource),
      });
      result.created++;

      // Sale dispensed from the machine → decrement that location's stock
      if (locationId) {
        const key = `${locationId}|${product.sku}`;
        decrements.set(key, (decrements.get(key) || 0) + 1);
      }
    } catch (err) {
      // If it's a unique constraint violation, treat as skip (duplicate)
      if (err.code === 'P2002') {
        result.skipped++;
      } else {
        result.errored++;
        result.errors.push(`Order ${orderData.orderSaleId}, item ${item.productSaleId}: ${err.message}`);
        console.error('VendLive sale processing error:', err.message);
      }
    }
  }

  await applySaleStockDecrements(decrements);
  await applyProductPriceUpdates(pricedItems, productMap);

  return result;
}

// ============ POLL SYNC ============

const BATCH_SIZE = 50;

/**
 * Run a poll-based sync against the VendLive order-sales API.
 * Uses batched DB operations to avoid exhausting the connection pool.
 */
export async function runPollSync() {
  const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
  if (!config || !config.salesSyncEnabled || !config.apiToken) {
    return null;
  }

  const totals = { created: 0, skipped: 0, errored: 0, errors: [] };
  const unknownSkus = new Set();
  const previousLastPollSaleId = config.lastPollSaleId || 0;
  let highestSaleIdSeen = previousLastPollSaleId;

  try {
    const { results, pageCount } = await vendliveApi.getOrderSales(config, {
      startId: previousLastPollSaleId || undefined,
    });

    // Step 1: Normalize all entries and flatten into sale items.
    // Note: do NOT advance lastPollSaleId based on normalisation alone — that
    // would skip sales that fail to persist. We only update it at the end if
    // every batch succeeded.
    const allItems = [];
    for (const entry of results) {
      const orderData = normalizePollPayload(entry);
      if (orderData.orderSaleId > highestSaleIdSeen) {
        highestSaleIdSeen = orderData.orderSaleId;
      }
      for (const item of orderData.items) {
        // Skip non-successful vends
        if (item.vendStatusName && item.vendStatusName !== 'Success') {
          totals.skipped++;
          continue;
        }
        allItems.push({ orderData, item });
      }
    }

    console.log(`VendLive sync: ${results.length} orders, ${allItems.length} successful items to process`);

    // Step 2: Pre-fetch all products and machine mappings in bulk
    const uniqueSkus = [...new Set(allItems.map(({ item }) => item.productExternalId).filter(Boolean))];
    const existingProducts = await prisma.product.findMany({
      where: { sku: { in: uniqueSkus } },
    });
    const productMap = new Map(existingProducts.map(p => [p.sku, p]));

    const uniqueMachineIds = [...new Set(allItems.map(({ item }) => item.machineId).filter(Boolean))];
    const existingMappings = uniqueMachineIds.length > 0
      ? await prisma.vendliveMachineMapping.findMany({
          where: { vendliveMachineId: { in: uniqueMachineIds } },
          include: { location: { select: { id: true, name: true } } },
        })
      : [];
    const mappingMap = new Map(existingMappings.map(m => [m.vendliveMachineId, m]));

    // Step 3: Auto-create missing products if enabled
    if (config.autoCreateProducts) {
      const missingSkus = uniqueSkus.filter(sku => !productMap.has(sku));
      if (missingSkus.length > 0) {
        // Find names from items for these SKUs
        const skuNames = new Map();
        for (const { item } of allItems) {
          if (missingSkus.includes(item.productExternalId) && !skuNames.has(item.productExternalId)) {
            skuNames.set(item.productExternalId, {
              name: item.productName || item.productExternalId,
              costPrice: item.costPrice || null,
              salePrice: item.price || null,
            });
          }
        }

        for (const sku of missingSkus) {
          const info = skuNames.get(sku) || { name: sku };
          const meal = guessFreshMeal(info.name);
          try {
            const created = await prisma.product.create({
              data: {
                sku,
                name: info.name,
                unitCost: info.costPrice,
                salePrice: info.salePrice,
                isFreshMeal: meal.isFreshMeal,
                mealType: meal.mealType,
              },
            });
            productMap.set(sku, created);
          } catch (err) {
            if (err.code === 'P2002') {
              // Race condition — another sync created it, fetch it
              const existing = await prisma.product.findUnique({ where: { sku } });
              if (existing) productMap.set(sku, existing);
            }
          }
        }
        console.log(`VendLive sync: auto-created ${missingSkus.length} products`);
      }
    }

    // Step 4: Batch-insert sales in chunks.
    // For each chunk: find which sales already exist, createMany the new ones
    // (createMany's count gives an HONEST created total — the old upsert loop
    // counted re-synced duplicates as "created"), update refund status on
    // existing ones that changed, and decrement location stock for new ones.
    let anyBatchFailed = false;
    const decrements = new Map();

    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const chunk = allItems.slice(i, i + BATCH_SIZE);

      // Partition out items whose product is unknown (auto-create disabled).
      // These are counted as skipped — NOT errors — and logged with their
      // SKUs in metadata, because blocking the checkpoint on them would make
      // the poll re-fetch the same window forever.
      const resolvable = [];
      for (const entry of chunk) {
        const product = productMap.get(entry.item.productExternalId);
        if (!product) {
          totals.skipped++;
          unknownSkus.add(entry.item.productExternalId);
          continue;
        }
        resolvable.push({ ...entry, product });
      }

      if (resolvable.length === 0) continue;

      try {
        const keys = resolvable.map(({ orderData, item }) => ({
          vendliveOrderSaleId: orderData.orderSaleId,
          vendliveProductSaleId: item.productSaleId,
        }));
        const existingSales = await prisma.sale.findMany({
          where: { OR: keys },
          select: { id: true, vendliveOrderSaleId: true, vendliveProductSaleId: true, isRefunded: true },
        });
        const existingByKey = new Map(
          existingSales.map(s => [`${s.vendliveOrderSaleId}-${s.vendliveProductSaleId}`, s])
        );

        const createRows = [];
        const refundUpdates = [];

        for (const { orderData, item, product } of resolvable) {
          const mapping = item.machineId ? mappingMap.get(item.machineId) : null;
          const locationName = mapping?.location?.name || orderData.locationName;
          const existing = existingByKey.get(`${orderData.orderSaleId}-${item.productSaleId}`);

          if (existing) {
            totals.skipped++;
            if (existing.isRefunded !== (item.isRefunded || false)) {
              refundUpdates.push(prisma.sale.update({
                where: { id: existing.id },
                data: { isRefunded: item.isRefunded || false, vendStatus: item.vendStatusName || null },
              }));
            }
            continue;
          }

          createRows.push(buildSaleData(orderData, item, product, locationName, 'poll'));

          if (mapping?.location?.id) {
            const key = `${mapping.location.id}|${product.sku}`;
            decrements.set(key, (decrements.get(key) || 0) + 1);
          }
        }

        if (createRows.length > 0 || refundUpdates.length > 0) {
          const [createResult] = await prisma.$transaction([
            prisma.sale.createMany({ data: createRows, skipDuplicates: true }),
            ...refundUpdates,
          ]);
          totals.created += createResult.count;
          totals.skipped += createRows.length - createResult.count; // raced duplicates
        }
      } catch (err) {
        console.error(`VendLive sync: batch error at chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
        totals.errored += resolvable.length;
        totals.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
        anyBatchFailed = true;
      }

      console.log(`VendLive sync: processed chunk ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allItems.length / BATCH_SIZE)}`);
    }

    // Decrement location stock for newly ingested sales only. If a batch
    // failed, its items contributed nothing to `decrements` (they threw
    // before being counted), and the re-poll will pick them up.
    await applySaleStockDecrements(decrements);

    // Refresh catalog pricing from this run's sales (newest sale per SKU
    // wins). Uses items from failed batches too — harmless, since the
    // refresh is idempotent and the re-poll repeats it.
    await applyProductPriceUpdates(allItems.map(({ item }) => item), productMap);

    // Only advance lastPollSaleId if every batch succeeded. If any batch failed,
    // keep it where it was so the next poll re-fetches and retries (inserts are
    // idempotent via skipDuplicates). lastPollAt is always updated so the
    // scheduler knows we ran.
    const newLastPollSaleId = anyBatchFailed
      ? previousLastPollSaleId
      : (highestSaleIdSeen || previousLastPollSaleId);

    await prisma.vendliveConfig.update({
      where: { id: 'default' },
      data: {
        lastPollSaleId: newLastPollSaleId,
        lastPollAt: new Date(),
      },
    });

    if (anyBatchFailed) {
      console.warn(`VendLive sync: kept lastPollSaleId at ${previousLastPollSaleId} because batch(es) failed; will retry on next poll`);
    }
    if (unknownSkus.size > 0) {
      console.warn(`VendLive sync: skipped sales for ${unknownSkus.size} unknown SKU(s) (auto-create disabled): ${[...unknownSkus].slice(0, 10).join(', ')}`);
    }

    // Log the sync
    const status = totals.errored > 0 ? (totals.created > 0 ? 'partial' : 'error') : 'success';
    await prisma.vendliveSyncLog.create({
      data: {
        syncType: 'poll',
        status,
        salesCreated: totals.created,
        salesSkipped: totals.skipped,
        salesErrored: totals.errored,
        errorMessage: totals.errors.length > 0 ? totals.errors.slice(0, 10).join('; ') : null,
        metadata: {
          pageCount,
          totalResults: results.length,
          ...(unknownSkus.size > 0 ? { unknownSkus: [...unknownSkus].slice(0, 50) } : {}),
        },
      },
    });

    console.log(`VendLive sync complete: ${totals.created} created, ${totals.skipped} skipped, ${totals.errored} errors`);
    return totals;
  } catch (err) {
    console.error('Poll sync error:', err.message);

    await prisma.vendliveSyncLog.create({
      data: {
        syncType: 'poll',
        status: 'error',
        salesCreated: totals.created,
        salesSkipped: totals.skipped,
        salesErrored: totals.errored,
        errorMessage: err.message,
      },
    });

    throw err;
  }
}
