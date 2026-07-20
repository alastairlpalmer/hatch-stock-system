/**
 * Pure analytics helpers — no DB, no Prisma, no I/O. Everything here is
 * deterministic and unit-tested (analytics-math.test.js). The DB-touching code
 * in services/analytics.js calls into these so the maths stays verifiable in
 * isolation and the dashboard + client report compute identical numbers.
 */

/** Day-of-week labels indexed to Postgres EXTRACT(DOW): 0 = Sunday … 6 = Saturday. */
export const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Length of a period in whole days, DAY-INCLUSIVE of both endpoints (a same-day
 * range is 1 day, Mon–Tue is 2) — used as the denominator for sales velocity.
 * Matches the day-inclusive endDate filtering in the sales WHERE clauses, so a
 * range's velocity divides the sales actually counted by the days actually
 * covered. Floored at 1 so velocity never divides by zero.
 */
export function periodDays(start, end) {
  const span = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(span) || span < 0) return 1;
  return Math.floor(span / 86_400_000) + 1;
}

/**
 * The equal-length period immediately preceding [start, end], in whole days and
 * day-inclusive on both sides: it ends the day before `start` and spans
 * periodDays(start, end) days. Returned dates are date-boundary values, so the
 * day-inclusive endDate filtering applies to them the same way as to the
 * current period — the two periods never overlap.
 */
export function previousPeriod(start, end) {
  const days = periodDays(start, end);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);
  return { start: prevStart, end: prevEnd };
}

/**
 * Percentage change of `current` relative to `previous`.
 * Returns null when there is no baseline (previous is 0 / null) — the caller
 * shows "insufficient data" rather than a misleading ∞% or 100%.
 */
export function pctChange(current, previous) {
  if (previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Margin percentage = (revenue − cost) / revenue × 100.
 * Returns null when revenue is non-positive or cost is unknown — margin is
 * undefined there and must surface as "insufficient data", never as 0%.
 */
export function marginPct(revenue, cost) {
  if (revenue == null || cost == null || revenue <= 0) return null;
  return ((revenue - cost) / revenue) * 100;
}

/**
 * Roll per-product stats up into product-family rows (parent products, e.g.
 * "Barebells"). Family totals sum member flavours; margin recomputes on the
 * summed paid basis (never averages member percentages). Members carry
 * unitsSharePct — their share of the family's units — which is the flavour
 * sell-rate the ordering split (phase 3) will consume. Flavours with no sales
 * in the period still appear as zero rows so the full range is visible.
 *
 * parents: [{ id, name, products: [{ sku, name }] }] (from product_parents)
 * products: per-product stats rows from productStats() keyed by sku
 * stockResolved: false when the scope's stock is unknowable → stock fields null
 */
export function aggregateFamilies(parents, products, { stockResolved = true } = {}) {
  const bySku = new Map((products || []).map((p) => [p.sku, p]));

  const families = (parents || []).map((parent) => {
    const members = (parent.products || []).map((m) => {
      const s = bySku.get(m.sku);
      return {
        sku: m.sku,
        name: s?.name || m.name,
        units: s?.units ?? 0,
        revenue: s?.revenue ?? 0,
        transactions: s?.transactions ?? 0,
        paidRevenue: s?.paidRevenue ?? 0,
        paidCost: s?.paidCost ?? 0,
        marginPct: s?.marginPct ?? null,
        stockOnHand: stockResolved ? s?.stockOnHand ?? 0 : null,
      };
    });

    const units = members.reduce((a, m) => a + m.units, 0);
    const revenue = members.reduce((a, m) => a + m.revenue, 0);
    const transactions = members.reduce((a, m) => a + m.transactions, 0);
    const paidRevenue = members.reduce((a, m) => a + m.paidRevenue, 0);
    const paidCost = members.reduce((a, m) => a + m.paidCost, 0);

    members.forEach((m) => {
      m.unitsSharePct = units > 0 ? (m.units / units) * 100 : null;
    });
    members.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));

    return {
      id: parent.id,
      name: parent.name,
      flavourCount: members.length,
      units,
      revenue,
      transactions,
      marginPct: marginPct(paidRevenue, paidCost),
      stockOnHand: stockResolved ? members.reduce((a, m) => a + m.stockOnHand, 0) : null,
      members,
    };
  });

  return families.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/**
 * Linear-interpolated percentile (p in [0,1]) of a numeric array.
 * Ignores non-finite values. Returns null for an empty input.
 */
export function percentile(values, p) {
  const xs = (values || []).filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const idx = (xs.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
}

/**
 * Shape raw timing rows [{ dow, hour, transactions, units }] into the grids the
 * dashboard renders. dow follows Postgres EXTRACT(DOW): 0 = Sunday … 6 = Saturday.
 * Returns per-day totals, per-hour totals, a 7×24 transaction grid (for the
 * heatmap), and the busiest day/hour (null when there's no data).
 */
export function shapeTiming(rows) {
  const byDayOfWeek = Array.from({ length: 7 }, (_, i) => ({ dow: i, label: DOW_LABELS[i], transactions: 0, units: 0 }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, transactions: 0, units: 0 }));
  const byDowHour = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const r of rows || []) {
    const dow = Number(r.dow);
    const hour = Number(r.hour);
    const tx = Number(r.transactions) || 0;
    const units = Number(r.units) || 0;
    if (dow >= 0 && dow < 7) {
      byDayOfWeek[dow].transactions += tx;
      byDayOfWeek[dow].units += units;
    }
    if (hour >= 0 && hour < 24) {
      byHour[hour].transactions += tx;
      byHour[hour].units += units;
    }
    if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
      byDowHour[dow][hour] += tx;
    }
  }

  const hasData = (rows || []).length > 0;
  const busiestDay = hasData ? byDayOfWeek.reduce((a, b) => (b.transactions > a.transactions ? b : a)) : null;
  const busiestHour = hasData ? byHour.reduce((a, b) => (b.transactions > a.transactions ? b : a)) : null;

  return { byDayOfWeek, byHour, byDowHour, busiestDay, busiestHour };
}

/**
 * Rule thresholds for the suggestions panel. Surfaced as named constants so the
 * operator can tune them later (reviewed defaults, 2026-06). Velocity is in
 * units sold per day.
 */
export const SUGGESTION_THRESHOLDS = {
  priceIncreaseMinVelocity: 2, // Rule A: "high velocity" = ≥ 2 units/day
  topQuartile: 0.75, // Rule C: "high velocity" = ≥ 75th-percentile velocity
};

const f = (n) => (Number.isFinite(n) ? n : 0).toFixed(1);
const f2 = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
const money = (n) => `£${f2(n)}`;

/**
 * Rule-based suggestions. Pure: takes the per-product stats array plus context
 * and returns suggestions, each carrying a `calc` string that states exactly
 * which numbers fired the rule (rendered behind an (i) tooltip in the UI).
 *
 * products: [{ sku, name, units, revenue, cost, stockOnHand|null, marginPct|null }]
 *   stockOnHand === null means stock could not be resolved for this scope; the
 *   stock-dependent rules (B, C) are skipped rather than guessing 0.
 *
 * Rules (waste-driven Rule 1 was deferred — write-offs aren't location-scoped):
 *   A price-increase  velocity ≥ threshold AND margin% < portfolio average
 *   B delist/relocate units == 0 AND stockOnHand > 0
 *   C lost-sales      velocity ≥ top-quartile AND stockOnHand == 0
 */
export function computeSuggestions(products, { portfolioMarginPct, periodDays: days, thresholds = SUGGESTION_THRESHOLDS } = {}) {
  if (!Array.isArray(products) || !days || days <= 0) return [];

  const velocities = products.filter((p) => p.units > 0).map((p) => p.units / days);
  const velocityP75 = percentile(velocities, thresholds.topQuartile);

  const out = [];
  for (const p of products) {
    const velocity = p.units / days;
    // Margin is computed on paid vends only (free £0 vends excluded). Use the
    // paid figures for both the rule and its (i) tooltip arithmetic so the
    // numbers shown reconcile with the margin %.
    const mRev = p.paidRevenue != null ? p.paidRevenue : p.revenue;
    const mCost = p.paidCost != null ? p.paidCost : p.cost;
    const m = p.marginPct != null ? p.marginPct : marginPct(mRev, mCost);

    // Rule A — high velocity, below-average margin → candidate for price increase
    if (
      p.units > 0 &&
      velocity >= thresholds.priceIncreaseMinVelocity &&
      m != null &&
      portfolioMarginPct != null &&
      m < portfolioMarginPct
    ) {
      out.push({
        sku: p.sku,
        name: p.name,
        rule: 'price-increase',
        severity: 'opportunity',
        title: 'Candidate for price increase',
        message: `Sells fast (${f(velocity)}/day) but margin ${f(m)}% is below the ${f(portfolioMarginPct)}% portfolio average.`,
        calc:
          `Fires when velocity ≥ ${thresholds.priceIncreaseMinVelocity}/day AND margin% < portfolio average margin. ` +
          `Here: velocity = ${p.units} units ÷ ${f(days)} days = ${f2(velocity)}/day; ` +
          `margin% = (${money(mRev)} − ${money(mCost)}) ÷ ${money(mRev)} = ${f(m)}%; ` +
          `portfolio average margin = ${f(portfolioMarginPct)}%.`,
        metrics: { velocity, marginPct: m, portfolioMarginPct, units: p.units },
      });
    }

    // Rule B — stock on hand but zero sales → delist / relocate
    if (p.units === 0 && p.stockOnHand != null && p.stockOnHand > 0) {
      out.push({
        sku: p.sku,
        name: p.name,
        rule: 'delist-relocate',
        severity: 'warning',
        title: 'Consider delisting or relocating',
        message: `No sales this period but ${p.stockOnHand} unit(s) on hand.`,
        calc:
          `Fires when units sold = 0 in the period AND stock on hand > 0. ` +
          `Here: 0 sales across ${f(days)} days; ${p.stockOnHand} unit(s) currently in location stock.`,
        metrics: { units: 0, stockOnHand: p.stockOnHand },
      });
    }

    // Rule C — top-quartile seller, out of stock → possible lost sales
    if (p.units > 0 && velocityP75 != null && velocity >= velocityP75 && p.stockOnHand === 0) {
      out.push({
        sku: p.sku,
        name: p.name,
        rule: 'lost-sales',
        severity: 'warning',
        title: 'Possible lost sales — restock',
        message: `Top-quartile seller (${f(velocity)}/day) but currently 0 in stock.`,
        calc:
          `Fires when velocity is in the top quartile (≥ ${f2(velocityP75)}/day, the 75th percentile across selling products) ` +
          `AND stock on hand = 0. Here: velocity = ${p.units} ÷ ${f(days)} = ${f2(velocity)}/day; stock on hand = 0.`,
        metrics: { velocity, velocityP75, stockOnHand: 0, units: p.units },
      });
    }
  }

  // Opportunities first, then warnings; within a group, strongest signal first.
  const rank = { opportunity: 0, warning: 1 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.metrics.velocity || 0) - (a.metrics.velocity || 0));
}
