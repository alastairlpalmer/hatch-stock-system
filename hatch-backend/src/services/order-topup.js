/**
 * Minimum-order top-up.
 *
 * Suppliers impose a floor — £150 minimum, 10 cases minimum, free delivery
 * over £200. The buying list already WARNED when a supplier group fell short,
 * in three separate places, and then left the operator to fix it by scrolling
 * the catalogue guessing at what to pad the order with. Guessing badly is
 * expensive in both directions: pad with the wrong thing and it sits in the
 * warehouse until it expires; don't pad at all and either the order bounces or
 * we pay a delivery charge that was avoidable.
 *
 * The insight that makes this decidable: buying MORE of something that turns
 * over quickly costs almost nothing — it just arrives a week early. Buying
 * anything that does not move is dead money. So candidates are ranked by the
 * DAYS OF COVER each box adds, cheapest-in-time first, and nothing is ever
 * pushed past a cover ceiling.
 *
 * This module is the pure half: ranking and the greedy fill. Fetching the
 * candidates lives in routes/orders.js.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Never push a product past this many trading days of cover to satisfy a
// minimum. Four selling weeks is already a lot of stock for a vending machine;
// beyond it we are solving the supplier's problem by creating our own.
export const DEFAULT_MAX_COVER_DAYS = 20;

// A supplier minimum can be a value, a unit count, or both, and a free-delivery
// threshold is a separate (softer) target above them. Kept as one shape so the
// caller never has to care which combination a given supplier uses.
export const NO_SHORTFALL = { value: 0, units: 0 };

/**
 * What a supplier group is short by.
 *
 * `freeDelivery` is reported separately and NEVER folded into the blocking
 * shortfall: missing a free-delivery threshold costs a delivery fee, missing a
 * minimum means the order will not be accepted at all. Presenting them as the
 * same urgency trains the operator to ignore both.
 *
 * Pure; exported for tests.
 */
export function computeShortfall({
  subtotal = 0,
  totalUnits = 0,
  minOrderValue = null,
  minOrderUnits = null,
  freeDeliveryValue = null,
}) {
  const value = minOrderValue != null ? Math.max(0, round2(minOrderValue - subtotal)) : 0;
  const units = minOrderUnits != null ? Math.max(0, minOrderUnits - totalUnits) : 0;
  const freeDelivery = freeDeliveryValue != null
    ? Math.max(0, round2(freeDeliveryValue - subtotal))
    : 0;
  return {
    value,
    units,
    freeDelivery,
    blocked: value > 0 || units > 0,
    meetsFreeDelivery: freeDeliveryValue != null && freeDelivery === 0,
  };
}

/**
 * Days of cover one more box would add to a candidate.
 *
 * A candidate with no velocity has infinite cover — it is not that a box lasts
 * a long time, it is that we have no evidence it would ever sell, which is
 * exactly the thing a top-up must not buy. Returning Infinity keeps it sorted
 * last and lets the cover ceiling reject it without a special case.
 *
 * Pure; exported for tests.
 */
export function coverPerBox(candidate) {
  const box = candidate.unitsPerBox > 0 ? candidate.unitsPerBox : 1;
  const v = candidate.velocityPerDay || 0;
  return v > 0 ? box / v : Infinity;
}

/**
 * Rank top-up candidates: least cover added per box first, then the product we
 * are shortest of, then SKU for a stable order.
 *
 * Ties broken by CURRENT cover ascending so that, between two equally
 * fast-moving products, the one we are closer to running out of is padded
 * first — the top-up doubles as a top-up.
 *
 * Pure; exported for tests.
 */
export function rankTopupCandidates(candidates = []) {
  return [...candidates].sort((a, b) => {
    const ca = coverPerBox(a);
    const cb = coverPerBox(b);
    if (ca !== cb) return ca - cb;
    const cca = currentCover(a);
    const ccb = currentCover(b);
    if (cca !== ccb) return cca - ccb;
    return String(a.sku).localeCompare(String(b.sku));
  });
}

function currentCover(candidate) {
  const v = candidate.velocityPerDay || 0;
  return v > 0 ? (candidate.currentUnits || 0) / v : Infinity;
}

/**
 * Plan the smallest sensible set of additions that clears a supplier's
 * minimum.
 *
 * Greedy, one box at a time, always taking whichever candidate adds the least
 * cover next. Boxes, not units — a supplier minimum cannot be met with a
 * quantity they will not sell us.
 *
 * Stops as soon as BOTH shortfalls are satisfied. Overshoot in £ is accepted
 * without trying to minimise it: box granularity makes some overshoot
 * unavoidable, and on a product picked precisely because it turns over fast,
 * overshoot is a week of early arrival rather than a cost.
 *
 * `exhausted` is true when the plan ran out of candidates that could take
 * another box within the cover ceiling — the honest answer is then "this
 * order cannot reach the minimum without buying stock you'll regret", which
 * is a decision for a human, not something to solve by ignoring the ceiling.
 *
 * Pure; exported for tests.
 */
export function planTopup({
  candidates = [],
  valueShortfall = 0,
  unitsShortfall = 0,
  maxCoverDays = DEFAULT_MAX_COVER_DAYS,
}) {
  const needValue = Math.max(0, valueShortfall);
  const needUnits = Math.max(0, unitsShortfall);

  if (needValue <= 0 && needUnits <= 0) {
    return {
      additions: [],
      valueAdded: 0,
      unitsAdded: 0,
      valueRemaining: 0,
      unitsRemaining: 0,
      exhausted: false,
    };
  }

  // A candidate with no cost cannot help hit a VALUE minimum — we would be
  // proposing a line whose contribution we can't compute. It is still fine for
  // a units-only minimum.
  const usable = candidates.filter((c) => {
    if ((c.velocityPerDay || 0) <= 0) return false;
    if (needValue > 0 && (c.unitCost == null || c.unitCost <= 0)) return false;
    return true;
  });

  const ranked = rankTopupCandidates(usable);
  const state = new Map(ranked.map((c) => [c.sku, { ...c, boxes: 0, units: 0 }]));

  const boxOf = (c) => (c.unitsPerBox > 0 ? c.unitsPerBox : 1);
  const coverAfterAnotherBox = (entry) => {
    const v = entry.velocityPerDay || 0;
    if (v <= 0) return Infinity;
    return ((entry.currentUnits || 0) + entry.units + boxOf(entry)) / v;
  };

  let valueAdded = 0;
  let unitsAdded = 0;
  let exhausted = false;

  const satisfied = () => valueAdded >= needValue - 0.005 && unitsAdded >= needUnits;

  while (!satisfied()) {
    // Ranked order is stable, so the first entry that still fits the ceiling
    // is the least-cover box available.
    const next = ranked
      .map((c) => state.get(c.sku))
      .find((entry) => coverAfterAnotherBox(entry) <= maxCoverDays);

    if (!next) { exhausted = true; break; }

    next.boxes += 1;
    next.units += boxOf(next);
    unitsAdded += boxOf(next);
    valueAdded = round2(valueAdded + boxOf(next) * (next.unitCost || 0));
  }

  const additions = [...state.values()]
    .filter((e) => e.boxes > 0)
    .map((e) => {
      const v = e.velocityPerDay || 0;
      const coverAfter = v > 0 ? round2(((e.currentUnits || 0) + e.units) / v) : null;
      return {
        sku: e.sku,
        name: e.name,
        boxes: e.boxes,
        units: e.units,
        unitsPerBox: boxOf(e),
        unitCost: e.unitCost ?? null,
        lineTotal: round2(e.units * (e.unitCost || 0)),
        velocityPerDay: round2(v),
        currentUnits: e.currentUnits || 0,
        coverAfterDays: coverAfter,
        // Written for the operator, not the log: the whole proposal has to be
        // legible at a glance or it will not be trusted enough to accept.
        reason: coverAfter != null
          ? `Sells ${round2(v)}/day — ${e.units} more takes it to ${coverAfter} days of cover.`
          : `${e.units} more units.`,
      };
    })
    // Biggest contribution first: the operator reads the top of the list and
    // sees what is actually doing the work.
    .sort((a, b) => b.lineTotal - a.lineTotal || String(a.sku).localeCompare(String(b.sku)));

  return {
    additions,
    valueAdded: round2(valueAdded),
    unitsAdded,
    valueRemaining: Math.max(0, round2(needValue - valueAdded)),
    unitsRemaining: Math.max(0, needUnits - unitsAdded),
    exhausted,
  };
}
