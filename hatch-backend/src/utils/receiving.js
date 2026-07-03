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
 * ORDER-LINE sku. Lines may repeat a SKU (one line per expiry lot), so the
 * check is on the per-line SUM: it must not exceed what is still outstanding
 * on the order (ordered quantity minus what earlier receipts already booked
 * in).
 *
 * A line may carry `forSku`: the units are counted against THAT order line
 * while the batch is booked under the line's own (actual) sku. This is how
 * fresh-meal placeholder lines (ordered at meal-type level because the Frive
 * menu rotates weekly) get allocated to the real flavour SKUs found in the
 * box at receiving time.
 *
 * Pure function (no DB) so partial-receiving rules are unit-testable.
 * Returns { sums, itemBySku, error } — sums is a Map of ORDER sku → total
 * received against it in this receipt, itemBySku maps order sku → its
 * OrderItem, error is a human-readable message (null when valid).
 */
export function validateReceiptLines(orderItems, lines) {
  const itemBySku = new Map();
  for (const oi of orderItems) {
    if (!itemBySku.has(oi.sku)) itemBySku.set(oi.sku, oi);
  }

  const sums = new Map();
  for (const line of lines) {
    const orderSku = line.forSku || line.sku;
    if (!itemBySku.has(orderSku)) {
      return { sums, itemBySku, error: `SKU ${orderSku} is not on this order` };
    }
    if (line.forSku && line.forSku === line.sku) {
      return { sums, itemBySku, error: `forSku must name a different order line than ${line.sku}` };
    }
    sums.set(orderSku, (sums.get(orderSku) || 0) + line.quantity);
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
