/**
 * Map a received order item to the StockBatch create input.
 *
 * A missing/blank expiry must NOT block receiving — the batch is created with
 * expiryDate: null and surfaced by the expiry tracking views as "missing" so
 * it can be corrected later via PUT /inventory/batches/:id.
 */
export function batchInputFromReceivedItem(item, warehouseId) {
  return {
    warehouseId,
    sku: item.sku,
    quantity: item.quantity,
    remainingQty: item.quantity,
    expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
    hasDamage: item.hasDamage || false,
    damageNotes: item.damageNotes,
  };
}

/**
 * Validate a receipt's lines against an order's items and aggregate them per
 * SKU. Lines may repeat a SKU (one line per expiry lot), so the check is on
 * the per-SKU SUM: it must not exceed what is still outstanding on the order
 * (ordered quantity minus what earlier receipts already booked in).
 *
 * Pure function (no DB) so partial-receiving rules are unit-testable.
 * Returns { sums, itemBySku, error } — sums is a Map of sku → total received
 * in this receipt, itemBySku maps sku → its OrderItem, error is a
 * human-readable message (null when the receipt is valid).
 */
export function validateReceiptLines(orderItems, lines) {
  const itemBySku = new Map();
  for (const oi of orderItems) {
    if (!itemBySku.has(oi.sku)) itemBySku.set(oi.sku, oi);
  }

  const sums = new Map();
  for (const line of lines) {
    if (!itemBySku.has(line.sku)) {
      return { sums, itemBySku, error: `SKU ${line.sku} is not on this order` };
    }
    sums.set(line.sku, (sums.get(line.sku) || 0) + line.quantity);
  }

  for (const [sku, sum] of sums) {
    const oi = itemBySku.get(sku);
    const outstanding = oi.quantity - (oi.receivedQty || 0);
    if (sum > outstanding) {
      return {
        sums,
        itemBySku,
        error: `Received quantity for ${sku} (${sum}) exceeds outstanding quantity (${outstanding})`,
      };
    }
  }

  return { sums, itemBySku, error: null };
}
