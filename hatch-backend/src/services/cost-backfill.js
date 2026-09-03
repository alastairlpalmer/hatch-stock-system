/**
 * Restate historical sale costs from the invoice trail.
 *
 * `sales.cost_price` is a snapshot taken at ingest, and every margin figure in
 * the app is computed from it (services/analytics.js). Until invoices were
 * reconcilable that snapshot could only ever be VendLive's costPrice — a
 * number typed into VendLive, not one we could prove. Reconciling invoices now
 * produces a real cost trail in `price_history`, but only NEW sales pick it
 * up; everything already ingested still reports margin against the old guess.
 *
 * This module restates those rows: for each sale, the invoice-proved cost that
 * was in force on the day it sold.
 *
 * Two rules make it safe to run on real data:
 *
 *  - Only `source = 'invoice'` history counts. The 'manual' baseline rows
 *    seeded by manual-sql/033 were copied FROM products.unit_cost, which is
 *    the very number we are trying to correct — restating a sale from one
 *    would be laundering the guess, not fixing it.
 *  - The cost in force is the latest invoice row with effective_from <= the
 *    sale's timestamp. A price rise in August must not rewrite what June's
 *    sales cost us, or the restatement destroys exactly the history it exists
 *    to make trustworthy.
 *
 * The pure half lives here; the route wraps it with a dry run.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
// Below this, a restatement is float noise rather than a real correction and
// would only churn rows. Matches PRICE_EPSILON in vendlive-sync.js.
export const COST_EPSILON = 0.005;

/**
 * The invoice-proved cost in force for a SKU at a moment in time.
 *
 * `history` must be that SKU's rows, source-filtered, sorted by effectiveFrom
 * ASCENDING. Returns null when no invoice predates the sale — a sale from
 * before we ever reconciled an invoice for that product has no proved cost and
 * must be left exactly as it is.
 *
 * Pure; exported for tests.
 */
export function costInForceAt(history, at) {
  const t = new Date(at).getTime();
  let found = null;
  for (const row of history) {
    if (new Date(row.effectiveFrom).getTime() <= t) found = row;
    else break; // ascending, so nothing later can qualify
  }
  return found ? found.unitCost : null;
}

/**
 * Work out which sales need restating.
 *
 * Reports the margin consequence as well as the row count: restating costs
 * moves reported profit, and doing that to historical figures without saying
 * by how much is how a reconciliation tool loses trust.
 *
 * Pure; exported for tests.
 *
 * @param {Array} sales   [{ id, sku, quantity, charged, costPrice, timestamp }]
 * @param {Object} historyBySku { [sku]: [{ unitCost, effectiveFrom }] } ascending
 * @returns {{ changes, unchanged, noHistory, costDelta, marginDeltaPct }}
 */
export function planCostBackfill(sales = [], historyBySku = {}) {
  const changes = [];
  let unchanged = 0;
  let noHistory = 0;
  let oldCostTotal = 0;
  let newCostTotal = 0;
  let revenueTotal = 0;

  for (const sale of sales) {
    const history = historyBySku[sale.sku];
    if (!history || history.length === 0) { noHistory++; continue; }

    const proved = costInForceAt(history, sale.timestamp);
    if (proved == null) { noHistory++; continue; }

    const current = sale.costPrice;
    if (current != null && Math.abs(current - proved) <= COST_EPSILON) { unchanged++; continue; }

    const qty = sale.quantity || 1;
    oldCostTotal += (current || 0) * qty;
    newCostTotal += proved * qty;
    // Refunded rows still carry a cost and still move the totals; the caller
    // decides whether to include them (the route excludes them by default).
    revenueTotal += (sale.charged || 0);

    changes.push({
      id: sale.id,
      sku: sale.sku,
      timestamp: sale.timestamp,
      quantity: qty,
      from: current,
      to: proved,
      costDelta: round2((proved - (current || 0)) * qty),
    });
  }

  const costDelta = round2(newCostTotal - oldCostTotal);
  return {
    changes,
    unchanged,
    noHistory,
    costDelta,
    // What the restatement does to reported profit on the affected rows: a
    // positive costDelta means we were UNDER-stating cost, so profit falls.
    profitDelta: round2(-costDelta),
    revenueAffected: round2(revenueTotal),
    // Margin points moved across the affected rows. Null when nothing was
    // charged (an all-free-vend selection), where a percentage is meaningless.
    marginDeltaPct: revenueTotal > 0
      ? round2((-costDelta / revenueTotal) * 100)
      : null,
  };
}
