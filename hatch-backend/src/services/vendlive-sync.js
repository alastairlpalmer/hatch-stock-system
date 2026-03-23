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
 * Poll returns: { id, productSales: [...], machine, locationName, ... }
 */
export function normalizePollPayload(entry) {
  const orderSaleId = parseInt(entry.id);
  const productSales = entry.productSales || entry.order_product_sales || [];

  const items = productSales.map(item => ({
    productSaleId: parseInt(item.id),
    productExternalId: item.productExternalId || item.product_external_id || (item.product?.externalId) || String(item.productId || item.product_id || item.product?.id),
    machineId: item.machineId || item.machine_id,
    vendStatusName: item.vendStatusName || item.vend_status_name,
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
    machineName: entry.machine || entry.machineName || null,
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

      // Idempotency check: look for existing sale with same order+product sale IDs
      const existingSale = await prisma.sale.findFirst({
        where: {
          vendliveOrderSaleId: orderData.orderSaleId,
          vendliveProductSaleId: item.productSaleId,
        },
      });

      if (existingSale) {
        result.skipped++;
        continue;
      }

      // Look up product by SKU (product_external_id)
      const sku = item.productExternalId;
      let product = await prisma.product.findUnique({ where: { sku } });

      if (!product && config?.autoCreateProducts) {
        // Auto-create product
        product = await prisma.product.create({
          data: {
            sku,
            name: sku, // Will be updated when more data is available
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

      // Create Sale record
      const saleId = `vl-${orderData.orderSaleId}-${item.productSaleId}`;
      await prisma.sale.create({
        data: {
          id: saleId,
          sku: product.sku,
          productName: product.name,
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
        },
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

/**
 * Run a poll-based sync against the VendLive order-sales API.
 * Fetches new sales since lastPollSaleId, processes them, and updates config.
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

    for (const entry of results) {
      const orderData = normalizePollPayload(entry);
      const result = await processVendliveOrder(orderData, 'poll', config);
      totals.created += result.created;
      totals.skipped += result.skipped;
      totals.errored += result.errored;
      totals.errors.push(...result.errors);

      if (orderData.orderSaleId > highestSaleId) {
        highestSaleId = orderData.orderSaleId;
      }
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
