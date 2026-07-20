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
 * Prisma operations that decrement a location's stock for a newly ingested
 * sale, clamped at 0. Returned as an OP ARRAY so callers include them in the
 * SAME $transaction as the sale insert — a decrement applied after the insert
 * committed used to be lost forever if the process died in between (the
 * re-poll saw the sale as existing and never replayed the decrement).
 */
function saleStockDecrementOps(locationId, sku, qty) {
  return [
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
  ];
}

/**
 * Mirror image of saleStockDecrementOps for refund flips (isRefunded
 * false→true restores the unit). No clamp needed for increments. Same
 * include-in-the-caller's-transaction contract.
 */
function saleStockIncrementOps(locationId, sku, qty) {
  return [
    prisma.locationStock.upsert({
      where: { locationId_sku: { locationId, sku } },
      create: { locationId, sku, quantity: qty },
      update: { quantity: { increment: qty } },
    }),
  ];
}

/** Expand a "locationId|sku" -> qty map into transaction ops. */
function stockOpsFromMaps(decrements, increments) {
  const ops = [];
  for (const [key, qty] of decrements) {
    const [locationId, sku] = key.split('|');
    ops.push(...saleStockDecrementOps(locationId, sku, qty));
  }
  for (const [key, qty] of increments) {
    const [locationId, sku] = key.split('|');
    ops.push(...saleStockIncrementOps(locationId, sku, qty));
  }
  return ops;
}

// ============ MACHINE MAPPING RESOLUTION ============

/**
 * Resolve (and heal) the mapping row for a machine seen on the sales feed.
 *
 * VendLive exposes the same physical machine under TWO numeric ids: the
 * /machines/ API id (vendliveMachineId, used by stock sync) and the
 * order-sales/webhook feed id (salesMachineId, carried on Sale rows). One row
 * per physical machine holds both; the friendly machineName is the only key
 * that matches across namespaces, so that is what we look up by here.
 *
 * - Duplicate rows for a name (legacy namespace bug): prefer the one actually
 *   mapped to a location, then the oldest, deterministically.
 * - Backfill: when the chosen row is missing (or disagrees on) the sales-feed
 *   id, write it — fire-and-forget, this run resolves by name either way, but
 *   the SQL-side join (vmm.sales_machine_id = s.vendlive_machine_id) needs it.
 * - No row at all: create one holding the sales-feed id in BOTH columns
 *   (machine-list auto-detect corrects vendliveMachineId to the /machines/
 *   namespace id when it runs). Never creates a second row for a known name.
 *
 * Returns the mapping (location included) or null.
 */
export async function resolveSalesMachineMapping(machineName, salesMachineId) {
  if (!machineName) return null;

  const rows = await prisma.vendliveMachineMapping.findMany({
    where: { machineName },
    include: { location: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const mapping = rows.find(r => r.locationId) || rows[0] || null;

  if (mapping) {
    if (salesMachineId && mapping.salesMachineId !== salesMachineId) {
      prisma.vendliveMachineMapping.update({
        where: { id: mapping.id },
        data: { salesMachineId },
      }).catch(err => {
        console.error(`VendLive sync: failed to backfill salesMachineId ${salesMachineId} on mapping "${machineName}":`, err.message);
      });
    }
    return mapping;
  }

  if (!salesMachineId) return null;

  try {
    return await prisma.vendliveMachineMapping.create({
      data: {
        vendliveMachineId: salesMachineId,
        salesMachineId,
        machineName,
        autoCreated: true,
      },
      include: { location: { select: { id: true, name: true } } },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      // Raced a concurrent ingest — fetch whichever row won.
      return prisma.vendliveMachineMapping.findFirst({
        where: { machineName },
        include: { location: { select: { id: true, name: true } } },
      });
    }
    console.error(`VendLive sync: failed to auto-create mapping for machine "${machineName}" (${salesMachineId}):`, err.message);
    return null;
  }
}

// ============ UNKNOWN-SKU QUARANTINE ============

/**
 * Park a sale whose SKU has no product (auto-create disabled) for later
 * replay, instead of dropping it — the old skip-and-advance behaviour lost
 * the sale forever once lastPollSaleId moved past it. The payload is the
 * exact Sale create row, so POST /api/vendlive/quarantine/replay is a plain
 * insert once the product exists. Upsert: re-syncs refresh the payload
 * rather than erroring. Throws on failure — callers decide whether that
 * holds the poll checkpoint.
 */
async function quarantineUnknownSkuSale(orderData, item, locationName, syncSource) {
  const sku = item.productExternalId;
  const saleData = buildSaleData(
    orderData,
    item,
    { sku, name: item.productName || sku, unitCost: null },
    locationName,
    syncSource
  );
  await prisma.vendliveQuarantinedSale.upsert({
    where: { id: saleData.id },
    create: {
      id: saleData.id,
      vendliveOrderSaleId: orderData.orderSaleId,
      vendliveProductSaleId: item.productSaleId,
      payload: saleData,
      reason: 'unknown_sku',
      sku,
      productName: item.productName || null,
      machineName: orderData.machineName,
      timestamp: saleData.timestamp,
    },
    update: { payload: saleData },
  });
}

// ============ SALE PROCESSING (webhook path) ============

/**
 * Process a single VendLive order and create Sale records for each product sale item.
 * Newly created sales decrement LocationStock via the machine→location mapping;
 * refund flips restore it. Unknown SKUs (auto-create off) are quarantined.
 * Returns { created, skipped, quarantined, errored, errors: string[] }
 */
export async function processVendliveOrder(orderData, syncSource, config) {
  const result = { created: 0, skipped: 0, quarantined: 0, errored: 0, errors: [] };
  const productMap = new Map();
  const pricedItems = [];

  // Resolve the machine mapping ONCE per order, by friendly name (the sale
  // items carry the sales-feed machine id, a different namespace from the
  // /machines id — see resolveSalesMachineMapping, which also backfills the
  // sales id onto the row and auto-creates mappings for brand-new machines).
  const salesMachineId = orderData.items.map(i => i.machineId).find(id => id != null) || null;
  const mapping = await resolveSalesMachineMapping(orderData.machineName, salesMachineId);
  const locationName = mapping?.location?.name || orderData.locationName;
  const locationId = mapping?.location?.id || null;

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
        // guess (unconfirmed) so Frive flavours surface in the review queue. The
        // VendLive category (poll payloads carry it; webhooks don't) is both
        // stored and fed to the classifier — a "Fresh Meals" category flags a
        // flavour even when its name has no recognisable dish keyword.
        const meal = guessFreshMeal(item.productName || sku, { category: item.productCategory });
        product = await prisma.product.create({
          data: {
            sku,
            name: item.productName || sku,
            category: item.productCategory || null,
            unitCost: item.costPrice || null,
            salePrice: item.price || null,
            isFreshMeal: meal.isFreshMeal,
            mealType: meal.mealType,
          },
        });
      }

      if (!product) {
        // Unknown SKU with auto-create off: park the normalized sale for
        // replay once the product exists, instead of dropping it.
        await quarantineUnknownSkuSale(orderData, item, locationName, syncSource);
        result.quarantined++;
        continue;
      }

      // Track for the post-loop pricing refresh (also for re-synced sales —
      // a price fixed in VendLive must reach the catalog either way).
      productMap.set(sku, product);
      pricedItems.push(item);

      const existing = await prisma.sale.findUnique({
        where: {
          vendliveOrderSaleId_vendliveProductSaleId: {
            vendliveOrderSaleId: orderData.orderSaleId,
            vendliveProductSaleId: item.productSaleId,
          },
        },
        select: { id: true, isRefunded: true, quantity: true },
      });

      if (existing) {
        // Re-sync of a known sale: keep mutable fields current (a sale
        // refunded in VendLive after first ingest must not stay frozen).
        const nowRefunded = item.isRefunded || false;
        if (existing.isRefunded !== nowRefunded) {
          // Refund flip false→true: the unit never left (or came back), so
          // restore the mapped location's stock — mirror of the ingest
          // decrement, in the SAME transaction as the flag update so the two
          // can never diverge.
          const restore = !existing.isRefunded && nowRefunded && locationId
            ? saleStockIncrementOps(locationId, product.sku, existing.quantity || 1)
            : [];
          await prisma.$transaction([
            prisma.sale.update({
              where: { id: existing.id },
              data: { isRefunded: nowRefunded, vendStatus: item.vendStatusName || null },
            }),
            ...restore,
          ]);
        }
        result.skipped++;
        continue;
      }

      // Sale dispensed from the machine → insert it and decrement that
      // location's stock atomically (a decrement outside this transaction was
      // permanently lost if the process died between the two writes).
      await prisma.$transaction([
        prisma.sale.create({
          data: buildSaleData(orderData, item, product, locationName, syncSource),
        }),
        ...(locationId ? saleStockDecrementOps(locationId, product.sku, 1) : []),
      ]);
      result.created++;
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

  const totals = { created: 0, skipped: 0, quarantined: 0, errored: 0, errors: [] };
  const unknownSkus = new Set();
  const previousLastPollSaleId = config.lastPollSaleId || 0;
  let highestSaleIdSeen = previousLastPollSaleId;

  try {
    const { results, pageCount, truncated } = await vendliveApi.getOrderSales(config, {
      startId: previousLastPollSaleId || undefined,
    });

    // Step 1: Normalize all entries and flatten into sale items.
    // Note: do NOT advance lastPollSaleId based on normalisation alone — that
    // would skip sales that fail to persist. We only update it at the end if
    // every batch succeeded.
    const allItems = [];
    let firstSaleId = null;
    let lastSaleId = null;
    for (const entry of results) {
      const orderData = normalizePollPayload(entry);
      if (firstSaleId === null) firstSaleId = orderData.orderSaleId;
      lastSaleId = orderData.orderSaleId;
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

    // Resolve machine -> location mappings by FRIENDLY NAME, not numeric id:
    // the order-sales feed reports a different machine id namespace from the
    // /machines/ endpoint, and only the friendly name is stable across both
    // (see resolveSalesMachineMapping). Resolution prefers location-mapped
    // rows over unmapped duplicates, backfills the sales-feed id onto the row
    // (so the SQL-side join vmm.sales_machine_id = s.vendlive_machine_id
    // works), and auto-creates a mapping for machines never seen before.
    // A handful of physical machines at most, so per-name queries are fine.
    const salesIdByName = new Map();
    for (const { orderData, item } of allItems) {
      if (!orderData.machineName || salesIdByName.has(orderData.machineName)) continue;
      const salesId = item.machineId || orderData.machineVendliveId || null;
      if (salesId) salesIdByName.set(orderData.machineName, salesId);
    }
    const machineNames = [...new Set(allItems.map(({ orderData }) => orderData.machineName).filter(Boolean))];
    const mappingByName = new Map();
    for (const name of machineNames) {
      const mapping = await resolveSalesMachineMapping(name, salesIdByName.get(name) || null);
      if (mapping) mappingByName.set(name, mapping);
    }

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
              category: item.productCategory || null,
              costPrice: item.costPrice || null,
              salePrice: item.price || null,
            });
          }
        }

        for (const sku of missingSkus) {
          const info = skuNames.get(sku) || { name: sku };
          const meal = guessFreshMeal(info.name, { category: info.category });
          try {
            const created = await prisma.product.create({
              data: {
                sku,
                name: info.name,
                category: info.category || null,
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

    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const chunk = allItems.slice(i, i + BATCH_SIZE);

      // Partition out items whose product is unknown (auto-create disabled).
      // These are QUARANTINED — not dropped — so the checkpoint can advance
      // without losing the sale (blocking on them would make the poll
      // re-fetch the same window forever; skipping lost them for good). If
      // the quarantine write itself fails we DO hold the checkpoint, because
      // then nothing preserves the sale.
      const resolvable = [];
      for (const entry of chunk) {
        const product = productMap.get(entry.item.productExternalId);
        if (!product) {
          unknownSkus.add(entry.item.productExternalId);
          try {
            const mapping = entry.orderData.machineName ? mappingByName.get(entry.orderData.machineName) : null;
            const locationName = mapping?.location?.name || entry.orderData.locationName;
            await quarantineUnknownSkuSale(entry.orderData, entry.item, locationName, 'poll');
            totals.quarantined++;
          } catch (err) {
            console.error(`VendLive sync: failed to quarantine sale for unknown SKU ${entry.item.productExternalId}:`, err.message);
            totals.errored++;
            totals.errors.push(`Quarantine ${entry.item.productExternalId}: ${err.message}`);
            anyBatchFailed = true;
          }
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
          select: { id: true, vendliveOrderSaleId: true, vendliveProductSaleId: true, isRefunded: true, quantity: true },
        });
        const existingByKey = new Map(
          existingSales.map(s => [`${s.vendliveOrderSaleId}-${s.vendliveProductSaleId}`, s])
        );

        const createRows = [];
        const refundUpdates = [];
        // Stock movements ride in the SAME transaction as the sale inserts —
        // a decrement applied after the insert committed was permanently lost
        // if the process died in between (the re-poll saw the sale as
        // existing and never replayed it). A failed chunk rolls back sales
        // AND movements together, so the re-poll re-applies both.
        const chunkDecrements = new Map();
        const chunkIncrements = new Map();

        for (const { orderData, item, product } of resolvable) {
          const mapping = orderData.machineName ? mappingByName.get(orderData.machineName) : null;
          const locationName = mapping?.location?.name || orderData.locationName;
          const existing = existingByKey.get(`${orderData.orderSaleId}-${item.productSaleId}`);

          if (existing) {
            totals.skipped++;
            const nowRefunded = item.isRefunded || false;
            if (existing.isRefunded !== nowRefunded) {
              refundUpdates.push(prisma.sale.update({
                where: { id: existing.id },
                data: { isRefunded: nowRefunded, vendStatus: item.vendStatusName || null },
              }));
              // Refund flip false→true: restore the mapped location's stock —
              // mirror of the decrement taken when the sale was first ingested.
              if (!existing.isRefunded && nowRefunded && mapping?.location?.id) {
                const key = `${mapping.location.id}|${product.sku}`;
                chunkIncrements.set(key, (chunkIncrements.get(key) || 0) + (existing.quantity || 1));
              }
            }
            continue;
          }

          createRows.push(buildSaleData(orderData, item, product, locationName, 'poll'));

          if (mapping?.location?.id) {
            const key = `${mapping.location.id}|${product.sku}`;
            chunkDecrements.set(key, (chunkDecrements.get(key) || 0) + 1);
          }
        }

        if (createRows.length > 0 || refundUpdates.length > 0) {
          const [createResult] = await prisma.$transaction([
            prisma.sale.createMany({ data: createRows, skipDuplicates: true }),
            ...refundUpdates,
            ...stockOpsFromMaps(chunkDecrements, chunkIncrements),
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

    // Refresh catalog pricing from this run's sales (newest sale per SKU
    // wins). Uses items from failed batches too — harmless, since the
    // refresh is idempotent and the re-poll repeats it.
    await applyProductPriceUpdates(allItems.map(({ item }) => item), productMap);

    // A truncated fetch (page cap hit with more data remaining) is only safe
    // to checkpoint past if the feed pages ASCENDING from startId — then the
    // unfetched remainder has higher ids and the next poll continues from
    // highestSaleIdSeen. If the window looks descending (newest first),
    // advancing would permanently skip the unfetched middle, so hold the
    // checkpoint and flag the run instead (inserts are idempotent, nothing is
    // lost — it just re-fetches until the cap is raised).
    const truncatedUnsafely = truncated
      && firstSaleId !== null && lastSaleId !== null && firstSaleId > lastSaleId;
    if (truncatedUnsafely) {
      totals.errors.push(`Fetch truncated at the page cap on a descending feed — checkpoint held at ${previousLastPollSaleId} to avoid skipping unfetched sales`);
      console.error('VendLive sync: truncated fetch appears DESCENDING — holding checkpoint to avoid losing the unfetched window');
    }

    // Only advance lastPollSaleId if every batch succeeded. If any batch failed,
    // keep it where it was so the next poll re-fetches and retries (inserts are
    // idempotent via skipDuplicates). lastPollAt is always updated so the
    // scheduler knows we ran.
    const newLastPollSaleId = (anyBatchFailed || truncatedUnsafely)
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
    if (truncated) {
      // The feed pages ascending from startId, so advancing to the highest
      // FETCHED id is safe — the unfetched remainder has higher ids and the
      // next poll continues from there. Surfaced here (and in the sync log)
      // so a large backlog draining over several polls is visible, not silent.
      console.warn(`VendLive sync: fetch window truncated at the page cap — backlog continues from sale id ${highestSaleIdSeen} on the next poll`);
    }
    if (unknownSkus.size > 0) {
      console.warn(`VendLive sync: quarantined sales for ${unknownSkus.size} unknown SKU(s) (auto-create disabled): ${[...unknownSkus].slice(0, 10).join(', ')}`);
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
          quarantined: totals.quarantined,
          ...(truncated ? { truncated: true } : {}),
          ...(unknownSkus.size > 0 ? { unknownSkus: [...unknownSkus].slice(0, 50) } : {}),
        },
      },
    });

    console.log(`VendLive sync complete: ${totals.created} created, ${totals.skipped} skipped, ${totals.quarantined} quarantined, ${totals.errored} errors`);
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
