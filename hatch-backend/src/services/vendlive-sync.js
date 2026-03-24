import prisma from '../utils/db.js';
import * as vendliveApi from './vendlive.js';

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
    machineId: item.machine_id,
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

// ============ SALE PROCESSING ============

/**
 * Process a single VendLive order and create Sale records for each product sale item.
 * Returns { created: number, skipped: number, errored: number, errors: string[] }
 */
export async function processVendliveOrder(orderData, syncSource, config) {
  const result = { created: 0, skipped: 0, errored: 0, errors: [] };

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
        // Auto-create product with real name if available
        product = await prisma.product.create({
          data: {
            sku,
            name: item.productName || sku,
            unitCost: item.costPrice || null,
            salePrice: item.price || null,
          },
        });
      }

      if (!product) {
        result.errored++;
        result.errors.push(`Product SKU ${sku} not found (auto-create disabled)`);
        continue;
      }

      // Look up machine mapping for location
      let locationName = orderData.locationName;
      if (item.machineId) {
        const mapping = await prisma.vendliveMachineMapping.findUnique({
          where: { vendliveMachineId: item.machineId },
          include: { location: { select: { name: true } } },
        });
        if (mapping?.location?.name) {
          locationName = mapping.location.name;
        }
      }

      // Determine the charged amount — use totalPaid if discounted, otherwise price
      const charged = item.totalPaid > 0 ? item.totalPaid : item.price;

      // Upsert Sale record — handles re-syncs gracefully
      const saleId = `vl-${orderData.orderSaleId}-${item.productSaleId}`;
      const saleData = {
        id: saleId,
        sku: product.sku,
        productName: item.productName || product.name,
        quantity: 1,
        charged,
        costPrice: item.costPrice || product.unitCost || null,
        paymentMethod: null,
        locationName,
        machineName: orderData.machineName,
        timestamp: new Date(item.timestamp || orderData.createdAt),
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

      await prisma.sale.upsert({
        where: {
          vendliveOrderSaleId_vendliveProductSaleId: {
            vendliveOrderSaleId: orderData.orderSaleId,
            vendliveProductSaleId: item.productSaleId,
          },
        },
        create: saleData,
        update: {}, // Already exists, no update needed
      });

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
  let highestSaleId = config.lastPollSaleId || 0;

  try {
    const { results, pageCount } = await vendliveApi.getOrderSales(config, {
      startId: config.lastPollSaleId || undefined,
    });

    // Step 1: Normalize all entries and flatten into sale items
    const allItems = [];
    for (const entry of results) {
      const orderData = normalizePollPayload(entry);
      if (orderData.orderSaleId > highestSaleId) {
        highestSaleId = orderData.orderSaleId;
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
          include: { location: { select: { name: true } } },
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
          try {
            const created = await prisma.product.create({
              data: {
                sku,
                name: info.name,
                unitCost: info.costPrice,
                salePrice: info.salePrice,
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

    // Step 4: Batch upsert sales in chunks using transactions
    for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
      const chunk = allItems.slice(i, i + BATCH_SIZE);
      const operations = [];

      for (const { orderData, item } of chunk) {
        const sku = item.productExternalId;
        const product = productMap.get(sku);

        if (!product) {
          totals.errored++;
          totals.errors.push(`Product SKU ${sku} not found`);
          continue;
        }

        const mapping = item.machineId ? mappingMap.get(item.machineId) : null;
        const locationName = mapping?.location?.name || orderData.locationName;
        const charged = item.totalPaid > 0 ? item.totalPaid : item.price;
        const saleId = `vl-${orderData.orderSaleId}-${item.productSaleId}`;

        operations.push(
          prisma.sale.upsert({
            where: {
              vendliveOrderSaleId_vendliveProductSaleId: {
                vendliveOrderSaleId: orderData.orderSaleId,
                vendliveProductSaleId: item.productSaleId,
              },
            },
            create: {
              id: saleId,
              sku: product.sku,
              productName: item.productName || product.name,
              quantity: 1,
              charged,
              costPrice: item.costPrice || product.unitCost || null,
              paymentMethod: null,
              locationName,
              machineName: orderData.machineName,
              timestamp: new Date(item.timestamp || orderData.createdAt),
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
              syncSource: 'poll',
            },
            update: {},
          })
        );
      }

      if (operations.length > 0) {
        try {
          await prisma.$transaction(operations);
          totals.created += operations.length;
        } catch (err) {
          console.error(`VendLive sync: batch error at chunk ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
          totals.errored += operations.length;
          totals.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${err.message}`);
        }
      }

      console.log(`VendLive sync: processed chunk ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allItems.length / BATCH_SIZE)}`);
    }

    // Update config with latest poll state
    await prisma.vendliveConfig.update({
      where: { id: 'default' },
      data: {
        lastPollSaleId: highestSaleId || config.lastPollSaleId,
        lastPollAt: new Date(),
      },
    });

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
        metadata: { pageCount, totalResults: results.length },
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
