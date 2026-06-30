/**
 * Warehouse stock <-> batch reconciliation helpers.
 *
 * Batches (stock_batches) are the SOURCE OF TRUTH for warehouse quantity. The
 * warehouse_stock.quantity column is a derived cache kept in lock-step with the
 * sum of a product's batch remaining_qty, so the two can never drift. Every
 * mutation of warehouse stock must go through these helpers (or otherwise call
 * recomputeWarehouseStock for the affected (warehouse, sku)) inside the same
 * transaction as the batch change.
 *
 * All functions take a Prisma transaction client `tx`.
 */

/**
 * Recompute warehouse_stock.quantity for a (warehouse, sku) from the SUM of its
 * batches' remaining_qty. Idempotent. Returns the new total.
 */
export async function recomputeWarehouseStock(tx, warehouseId, sku) {
  const agg = await tx.stockBatch.aggregate({
    where: { warehouseId, sku },
    _sum: { remainingQty: true },
  });
  const total = agg._sum.remainingQty || 0;
  await tx.warehouseStock.upsert({
    where: { warehouseId_sku: { warehouseId, sku } },
    create: { warehouseId, sku, quantity: total },
    update: { quantity: total },
  });
  return total;
}

/**
 * Drain `quantity` units from a (warehouse, sku)'s batches, earliest-expiry
 * first (FEFO; batches with no expiry are consumed last, then oldest-received
 * first as a tiebreak). Does NOT recompute the aggregate — the caller decides
 * when to do that (e.g. after also creating batches at a destination).
 *
 * Returns { consumed: [{ batch, take }], shortfall } where shortfall is the
 * amount that could not be covered by existing batches (0 in the normal case).
 */
export async function consumeBatchesFEFO(tx, warehouseId, sku, quantity) {
  let toConsume = quantity;
  const batches = await tx.stockBatch.findMany({
    where: { warehouseId, sku, remainingQty: { gt: 0 } },
    orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });

  const consumed = [];
  for (const batch of batches) {
    if (toConsume <= 0) break;
    const take = Math.min(batch.remainingQty, toConsume);
    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { remainingQty: { decrement: take } },
    });
    consumed.push({ batch, take });
    toConsume -= take;
  }

  return { consumed, shortfall: Math.max(0, toConsume) };
}

/**
 * Set the absolute target quantity for a (warehouse, sku) by materialising the
 * delta as batch changes, then recomputing the aggregate:
 *   - an INCREASE becomes a new no-expiry "adjustment" batch for the difference
 *     (surfaced in the Missing-Expiry list so an expiry can be set later);
 *   - a DECREASE drains existing batches NEWEST-expiry-first, so near-expiry
 *     stock — and its expiry alerts — are preserved for FEFO picking.
 *
 * Used by the absolute "Edit Stock" and CSV bulk-import paths. Per-batch edits
 * are the precise tool; this is the blunt "set the total to N" correction.
 * Returns the new total.
 */
export async function setWarehouseStockAbsolute(tx, warehouseId, sku, target, note = 'Manual stock adjustment') {
  const safeTarget = Math.max(0, target);
  const agg = await tx.stockBatch.aggregate({
    where: { warehouseId, sku },
    _sum: { remainingQty: true },
  });
  const current = agg._sum.remainingQty || 0;
  const delta = safeTarget - current;

  if (delta > 0) {
    await tx.stockBatch.create({
      data: {
        warehouseId,
        sku,
        quantity: delta,
        remainingQty: delta,
        expiryDate: null,
        damageNotes: note,
      },
    });
  } else if (delta < 0) {
    let toRemove = -delta;
    const batches = await tx.stockBatch.findMany({
      where: { warehouseId, sku, remainingQty: { gt: 0 } },
      orderBy: [{ expiryDate: { sort: 'desc', nulls: 'first' } }, { receivedAt: 'desc' }],
    });
    for (const b of batches) {
      if (toRemove <= 0) break;
      const take = Math.min(b.remainingQty, toRemove);
      await tx.stockBatch.update({
        where: { id: b.id },
        data: { remainingQty: { decrement: take } },
      });
      toRemove -= take;
    }
  }

  return recomputeWarehouseStock(tx, warehouseId, sku);
}
