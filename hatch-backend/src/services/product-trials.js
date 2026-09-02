/**
 * Product trials — the lane for products we do not yet sell.
 *
 * The suggestion engine is a REORDER engine and gates every line three times:
 * the product must be assigned to the location, it must be slotted on that
 * location's planogram, and it must have enough sales history to produce a
 * velocity (computeSuggestion returns null at zero demand with no min). A
 * product we have never stocked fails all three, so nothing new could ever
 * appear on a buying list. Buying and placing a new product was therefore
 * entirely manual, and judging whether it worked was a spreadsheet job.
 *
 * A trial bypasses all three gates for a named set of machines and a fixed
 * per-machine target, then — once it has run long enough — judges the product
 * against what a typical facing in those same machines earns.
 *
 * This module is the pure half: window arithmetic, the benchmark, and the
 * verdict. Data fetching and persistence live in routes/product-trials.js.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// A trial is judged on money per selling day, not units: a 40p-margin protein
// bar selling three a day beats a 12p-margin drink selling five, and units
// alone would pick the wrong one.
//
// Thresholds are ratios against the benchmark facing:
//   >= ADOPT   — holding its own against a typical facing, keep it
//   >= MARGINAL— worth a decision, not an automatic drop (a seasonal line, or
//                one still building recognition)
//   <  MARGINAL— it is earning less than half a normal facing, drop it
//
// ADOPT is deliberately below 1.0. The benchmark is the MEDIAN facing, and by
// construction half of a working machine's facings sit below the median —
// demanding better than median would reject products that are performing
// perfectly acceptably.
export const ADOPT_RATIO = 0.8;
export const MARGINAL_RATIO = 0.5;

// Guards against judging noise. A verdict needs both enough selling days and
// enough units: two weeks of trading, and enough sales that one good afternoon
// can't carry the result.
export const MIN_TRADING_DAYS = 10;
export const MIN_UNITS = 8;

// With no benchmark to compare against (a brand-new machine, or no other
// product has sold), fall back to an absolute bar: a facing that shifts less
// than this per selling day is not paying for its space.
export const ABSOLUTE_UNITS_PER_DAY = 0.5;

const MS_PER_DAY = 86_400_000;

/**
 * Where a trial is in its run.
 *
 * The clock starts at startedAt — when trial stock first reached a machine —
 * not at creation or ordering. A product bought in March and left in the
 * warehouse until June has had no trial at all, and dating the window from the
 * PO would silently mark it failed.
 *
 * `weeks` is in TRADING weeks (the machines only sell Mon–Fri), so the planned
 * length in trading days is weeks × 5.
 *
 * countTradingDays is injected (utils/trading-days.js countTradingDaysInWindow)
 * and counts INCLUSIVE of both ends, which is what we want here: a product put
 * in on Monday morning was on sale that Monday.
 *
 * Pure; exported for tests.
 * @returns {{ started: boolean, plannedTradingDays: number, tradingDaysElapsed: number,
 *             calendarDaysElapsed: number, windowComplete: boolean, progressPct: number }}
 */
export function trialWindow(trial, now = new Date(), countTradingDays) {
  const plannedTradingDays = Math.max(1, (trial.weeks || 4) * 5);
  if (!trial.startedAt) {
    return {
      started: false,
      plannedTradingDays,
      tradingDaysElapsed: 0,
      calendarDaysElapsed: 0,
      windowComplete: false,
      progressPct: 0,
    };
  }
  const start = new Date(trial.startedAt);
  const calendarDaysElapsed = Math.max(0, Math.floor((now.getTime() - start.getTime()) / MS_PER_DAY));
  const tradingDaysElapsed = Math.max(0, countTradingDays(start, now));
  return {
    started: true,
    plannedTradingDays,
    tradingDaysElapsed,
    calendarDaysElapsed,
    windowComplete: tradingDaysElapsed >= plannedTradingDays,
    progressPct: Math.min(100, Math.round((tradingDaysElapsed / plannedTradingDays) * 100)),
  };
}

/**
 * Margin per unit. Falls back to null (not 0) when either side is unknown —
 * a missing cost must produce "can't judge", never a confident £0 margin that
 * would reject the product.
 * Pure; exported for tests.
 */
export function marginPerUnit(product) {
  const sale = product?.salePrice;
  const cost = product?.unitCost;
  if (sale == null || cost == null) return null;
  return round2(sale - cost);
}

/**
 * The bar the trial has to clear: the MEDIAN money-per-selling-day earned by
 * the other products in the same machines over the same period.
 *
 * Median rather than mean, because one runaway best-seller would drag a mean
 * up far enough to reject everything else. Products with no sales at all are
 * EXCLUDED: a machine carrying dead facings would otherwise drag the bar to
 * zero and make any trial look like a triumph.
 *
 * Pure; exported for tests.
 * @param {Array<{ sku, unitsSold, marginPerUnit }>} peers
 * @param {number} tradingDays
 * @returns {number|null} £ per trading day, or null when there is nothing to compare against
 */
export function benchmarkMarginPerDay(peers = [], tradingDays = 1) {
  const days = Math.max(1, tradingDays);
  const values = peers
    .filter((p) => (p.unitsSold || 0) > 0 && p.marginPerUnit != null)
    .map((p) => (p.unitsSold * p.marginPerUnit) / days)
    .sort((a, b) => a - b);
  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 1
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
  return round2(median);
}

/**
 * Judge a trial.
 *
 * Returns one of:
 *  - too_early    not enough selling days or units yet to mean anything
 *  - no_sales     the product is sitting in the machines and not ONE sale has
 *                 been recorded — almost always because the SKU was never set
 *                 up in VendLive, so its sales never reach us. Called out
 *                 separately because the naive reading is "nobody wants it",
 *                 and dropping a product over a missing VendLive record is the
 *                 exact mistake this lane exists to prevent
 *  - no_margin    we don't know the product's cost or sale price, so we cannot
 *                 judge it on money — a data gap, not a failure
 *  - adopt        earning at least ADOPT_RATIO of a typical facing
 *  - marginal     between the two ratios — a human decision
 *  - reject       earning less than half a typical facing
 *
 * `reason` is written to be shown verbatim to the operator: a verdict nobody
 * understands is a verdict nobody trusts.
 *
 * Pure; exported for tests.
 */
export function computeTrialVerdict({
  unitsSold = 0,
  marginPerUnit: margin = null,
  tradingDaysElapsed = 0,
  benchmark = null,
  windowComplete = false,
  // Units of the trial product currently sitting in the trial machines. Used
  // only to tell "in the machine and not selling" apart from "never actually
  // made it into the machine".
  stockInMachines = 0,
  minTradingDays = MIN_TRADING_DAYS,
  minUnits = MIN_UNITS,
}) {
  const days = Math.max(1, tradingDaysElapsed);
  const unitsPerDay = round2(unitsSold / days);

  // Not enough evidence yet. The window being complete does NOT override the
  // units guard — a product that sold four units in four weeks has been judged
  // by its own silence, and that IS the answer, so let it through once the
  // window is done.
  if (tradingDaysElapsed < minTradingDays) {
    return {
      verdict: 'too_early',
      unitsPerDay,
      marginPerDay: null,
      ratio: null,
      reason: `Only ${tradingDaysElapsed} selling day${tradingDaysElapsed === 1 ? '' : 's'} so far — needs ${minTradingDays} before the numbers mean anything.`,
    };
  }
  if (unitsSold < minUnits && !windowComplete) {
    return {
      verdict: 'too_early',
      unitsPerDay,
      marginPerDay: null,
      ratio: null,
      reason: `Only ${unitsSold} sold so far — too few to call, and the trial has not finished.`,
    };
  }

  // Stock is on the shelf, the window has run, and not one sale has come back.
  // A product genuinely nobody wants still records the occasional sale; a flat
  // zero is nearly always a SKU that was never set up in VendLive, so its sales
  // never reach us at all. Say so instead of quietly recommending a drop.
  if (unitsSold === 0 && stockInMachines > 0) {
    return {
      verdict: 'no_sales',
      unitsPerDay: 0,
      marginPerDay: null,
      ratio: null,
      reason: `${stockInMachines} unit${stockInMachines === 1 ? ' is' : 's are'} sitting in the machines and not one sale has come back in ${tradingDaysElapsed} selling days. Check the product is set up in VendLive before writing it off — an unmapped SKU records no sales at all.`,
    };
  }

  if (margin == null) {
    return {
      verdict: 'no_margin',
      unitsPerDay,
      marginPerDay: null,
      ratio: null,
      reason: 'No cost or sale price on the product, so there is no margin to judge it on. Fill those in and check back.',
    };
  }

  const marginPerDay = round2((unitsSold * margin) / days);

  // No peers to compare against — judge on absolute movement instead.
  if (benchmark == null || benchmark <= 0) {
    const passes = unitsPerDay >= ABSOLUTE_UNITS_PER_DAY;
    return {
      verdict: passes ? 'adopt' : 'reject',
      unitsPerDay,
      marginPerDay,
      ratio: null,
      reason: passes
        ? `Selling ${unitsPerDay}/day (£${marginPerDay.toFixed(2)} margin/day). Nothing else in these machines has sales to compare against, so this is judged on movement alone.`
        : `Selling only ${unitsPerDay}/day. Nothing else in these machines has sales to compare against, so this is judged on movement alone — and it is not shifting.`,
    };
  }

  const ratio = round2(marginPerDay / benchmark);
  const pct = Math.round(ratio * 100);
  const shared = `£${marginPerDay.toFixed(2)} margin a day against £${benchmark.toFixed(2)} for a typical facing in these machines (${pct}%)`;

  if (ratio >= ADOPT_RATIO) {
    return { verdict: 'adopt', unitsPerDay, marginPerDay, ratio, reason: `Earning ${shared}. Worth a permanent slot.` };
  }
  if (ratio >= MARGINAL_RATIO) {
    return { verdict: 'marginal', unitsPerDay, marginPerDay, ratio, reason: `Earning ${shared}. Below a normal facing but not dead — your call.` };
  }
  return { verdict: 'reject', unitsPerDay, marginPerDay, ratio, reason: `Earning ${shared}. Less than half a normal facing — the space is worth more to something else.` };
}

/**
 * Per-machine target for a trial at one location: fill to trialQty, netted
 * against what is already in that machine.
 *
 * Deliberately identical in shape to the planogram capacity path so the trial
 * lane behaves like every other line downstream — trialQty simply stands in
 * for slot capacity until the product earns a real slot.
 *
 * Pure; exported for tests.
 */
export function trialNeedAtLocation({ trialQty = 0, machineStock = 0 }) {
  return Math.max(0, trialQty - machineStock);
}

/**
 * Which trials apply at each location, keyed by location id.
 *
 * Only trials that should still be BOUGHT and PLACED count: planned, ordered
 * and live. An adopted trial's product is `active` and ordered through the
 * normal engine; a rejected one must stop being ordered immediately.
 *
 * Pure; exported for tests.
 * @param {Array} trials
 * @returns {Map<string, Array<{ trialId, sku, trialQty }>>}
 */
export const ACTIVE_TRIAL_STATUSES = ['planned', 'ordered', 'live'];

export function trialsByLocation(trials = []) {
  const map = new Map();
  for (const trial of trials) {
    if (!ACTIVE_TRIAL_STATUSES.includes(trial.status)) continue;
    const ids = Array.isArray(trial.locationIds) ? trial.locationIds : [];
    for (const locationId of ids) {
      const list = map.get(locationId) || [];
      list.push({ trialId: trial.id, sku: trial.sku, trialQty: trial.trialQty || 0 });
      map.set(locationId, list);
    }
  }
  return map;
}
