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
    let take = Math.min(batch.remainingQty, toConsume);

    // Guarded decrement: only decrement if the batch still holds `take`, so a
    // concurrent consumer can never drive remainingQty negative. If the guard
    // misses, re-read the batch and take what is actually there (one retry);
    // anything still uncovered falls through to the shortfall.
    const updated = await tx.stockBatch.updateMany({
      where: { id: batch.id, remainingQty: { gte: take } },
      data: { remainingQty: { decrement: take } },
    });
    if (updated.count === 0) {
      const fresh = await tx.stockBatch.findUnique({ where: { id: batch.id } });
      take = Math.min(Math.max(0, fresh?.remainingQty ?? 0), toConsume);
      if (take <= 0) continue;
      const retried = await tx.stockBatch.updateMany({
        where: { id: batch.id, remainingQty: { gte: take } },
        data: { remainingQty: { decrement: take } },
      });
      if (retried.count === 0) continue; // lost the race again — count as shortfall
    }

    consumed.push({ batch, take });
    toConsume -= take;
  }

  return { consumed, shortfall: Math.max(0, toConsume) };
}

/**
 * Drain `quantity` units following a stored allocation PLAN (the batch lines a
 * pick list showed the packer), falling back to FEFO for anything the planned
 * batches can no longer cover. This keeps the system's decrement aligned with
 * the lots the packer physically pulled: before this, completion re-ran FEFO
 * fresh, so if stock moved between generation and completion the packer pulled
 * one lot while the system decremented another.
 *
 * plan: [{ batchId, qty }] in the order the packer saw them.
 * Returns { consumed, shortfall, offPlanQty } — offPlanQty is how many units
 * had to come from batches OUTSIDE the plan (0 when the plan held).
 */
export async function consumePlannedBatches(tx, warehouseId, sku, quantity, plan) {
  let remaining = quantity;
  const consumed = [];

  for (const line of Array.isArray(plan) ? plan : []) {
    if (remaining <= 0) break;
    if (!line?.batchId || !(line.qty > 0)) continue;
    let take = Math.min(line.qty, remaining);

    // Same guarded-decrement discipline as consumeBatchesFEFO.
    const updated = await tx.stockBatch.updateMany({
      where: { id: line.batchId, remainingQty: { gte: take } },
      data: { remainingQty: { decrement: take } },
    });
    if (updated.count === 0) {
      const fresh = await tx.stockBatch.findUnique({ where: { id: line.batchId } });
      take = Math.min(Math.max(0, fresh?.remainingQty ?? 0), remaining);
      if (take <= 0) continue;
      const retried = await tx.stockBatch.updateMany({
        where: { id: line.batchId, remainingQty: { gte: take } },
        data: { remainingQty: { decrement: take } },
      });
      if (retried.count === 0) continue;
    }

    consumed.push({ batchId: line.batchId, take });
    remaining -= take;
  }

  let offPlanQty = 0;
  let shortfall = 0;
  if (remaining > 0) {
    const fallback = await consumeBatchesFEFO(tx, warehouseId, sku, remaining);
    offPlanQty = remaining - fallback.shortfall;
    shortfall = fallback.shortfall;
    consumed.push(...fallback.consumed.map(({ batch, take }) => ({ batchId: batch.id, take })));
  }

  return { consumed, shortfall, offPlanQty };
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
