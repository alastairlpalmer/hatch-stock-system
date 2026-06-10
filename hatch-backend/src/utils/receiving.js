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
