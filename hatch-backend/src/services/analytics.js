import { Prisma } from '@prisma/client';
import prisma from '../utils/db.js';
import { resolveLocationScope } from './location-resolver.js';
import {
  periodDays,
  previousPeriod,
  pctChange,
  marginPct,
  shapeTiming,
  computeSuggestions,
  aggregateFamilies,
} from '../utils/analytics-math.js';

/**
 * Analytics aggregation — the single source of truth for the Sales dashboard
 * (Feature 1) and the client report (Feature 2). All figures come straight from
 * sales / products / location_stock; nothing is estimated. Refunds are excluded
 * from every revenue/unit total.
 *
 * Timestamps are stored as `timestamp without time zone` holding UTC wall-clock,
 * so day-of-week / hour-of-day bucketing converts UTC → Europe/London (DST-safe)
 * before extracting the local part.
 */

/**
 * Effective category for reporting. Frive fresh-meal flavours roll up into their
 * meal-type bucket (e.g. "Frive Meat") instead of their raw category, so the
 * dashboard category mix and the client PDF show the meaningful Meat vs Veg/Vegan
 * split rather than a churn of weekly flavours. Mirrors the SQL CASE used in
 * sales.js — keep the two in lockstep.
 */
export function effectiveCategory({ isFreshMeal, mealType, category }) {
  if (isFreshMeal) return mealType ? `Frive ${mealType}` : 'Frive (unclassified)';
  return category || 'Other';
}

// WHERE fragment for the sales table. Deliberately duplicated from sales.js's
// analyticsWhere (not imported) so this module doesn't couple to the in-flight
// edits on that file — TODO: dedupe into utils/sales-filter.js once that lands.
function salesWhere({ startDate, endDate, names }, { includeRefunded = false } = {}) {
  const cond = [includeRefunded ? Prisma.sql`s.is_refunded = true` : Prisma.sql`s.is_refunded = false`];
  if (startDate) cond.push(Prisma.sql`s."timestamp" >= ${new Date(startDate)}`);
  if (endDate) {
    // endDate is a date-only string; new Date() parses it as midnight at the
    // START of that day, which would exclude the whole final day. Bound with an
    // exclusive < next-day instead so endDate stays day-inclusive.
    const end = new Date(endDate);
    end.setDate(end.getDate() + 1);
    cond.push(Prisma.sql`s."timestamp" < ${end}`);
  }

  const list = (names || []).filter((n) => n && n !== 'all');
  if (list.length > 0) {
    const parts = list.map((n) =>
      n === 'Unknown'
        ? Prisma.sql`(s.location_name IS NULL OR s.location_name = 'Unknown')`
        : Prisma.sql`s.location_name = ${n}`,
    );
    cond.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
  }
  return Prisma.join(cond, ' AND ');
}

async function totals(startDate, endDate, names) {
  const where = salesWhere({ startDate, endDate, names });
  const [row] = await prisma.$queryRaw`
    SELECT COUNT(*)::int                        AS transactions,
           COALESCE(SUM(s.charged), 0)::float   AS revenue,
           COALESCE(SUM(s.quantity), 0)::int    AS units
    FROM sales s
    WHERE ${where}
  `;
  return { transactions: row.transactions, revenue: row.revenue, units: row.units };
}

async function headline({ startDate, endDate }, names) {
  const cur = await totals(startDate, endDate, names);
  const avg = cur.transactions > 0 ? cur.revenue / cur.transactions : 0;

  // Comparison needs a bounded current period to mirror; skip it for open ranges.
  let previous = null;
  let change = null;
  if (startDate && endDate) {
    const prevRange = previousPeriod(startDate, endDate);
    const prev = await totals(prevRange.start, prevRange.end, names);
    const prevAvg = prev.transactions > 0 ? prev.revenue / prev.transactions : 0;
    previous = { ...prev, avgTransactionValue: prevAvg, startDate: prevRange.start, endDate: prevRange.end };
    change = {
      unitsPct: pctChange(cur.units, prev.units),
      revenuePct: pctChange(cur.revenue, prev.revenue),
      transactionsPct: pctChange(cur.transactions, prev.transactions),
      avgTransactionPct: pctChange(avg, prevAvg),
    };
  }

  return {
    units: cur.units,
    revenue: cur.revenue,
    transactions: cur.transactions,
    avgTransactionValue: avg,
    previous,
    change,
    insufficientData: cur.transactions === 0,
  };
}

async function timing({ startDate, endDate }, names) {
  const where = salesWhere({ startDate, endDate, names });
  // Interpret the naive UTC timestamp as UTC, then convert to London local time.
  const rows = await prisma.$queryRaw`
    SELECT EXTRACT(DOW  FROM (s."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::int AS dow,
           EXTRACT(HOUR FROM (s."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London')::int AS hour,
           COUNT(*)::int                     AS transactions,
           COALESCE(SUM(s.quantity), 0)::int AS units
    FROM sales s
    WHERE ${where}
    GROUP BY 1, 2
  `;
  return { timezone: 'Europe/London', ...shapeTiming(rows) };
}

// Stock on hand per SKU for the scope. Returns a Map(sku -> qty), or null when
// the scope's stock is unresolvable (named locations matched no locations row).
async function stockOnHandBySku(scope) {
  if (scope.isAll) {
    const rows = await prisma.$queryRaw`SELECT sku, SUM(quantity)::int AS qty FROM location_stock GROUP BY sku`;
    return new Map(rows.map((r) => [r.sku, r.qty]));
  }
  if (!scope.locationIds || scope.locationIds.length === 0) return null;
  const rows = await prisma.$queryRaw`
    SELECT sku, SUM(quantity)::int AS qty
    FROM location_stock
    WHERE location_id IN (${Prisma.join(scope.locationIds)})
    GROUP BY sku
  `;
  return new Map(rows.map((r) => [r.sku, r.qty]));
}

/**
 * Per-product stats — the core dataset feeding product performance, margin
 * analysis, slow movers and the suggestion rules, so every panel agrees.
 * Includes products with stock but zero sales (needed for delist/relocate).
 */
async function productStats({ startDate, endDate }, scope) {
  const where = salesWhere({ startDate, endDate, names: scope.names });
  const rows = await prisma.$queryRaw`
    SELECT s.sku,
           COALESCE(MAX(s.product_name), s.sku)                            AS name,
           COALESCE(MAX(p.category), 'Other')                             AS category,
           bool_or(COALESCE(p.is_fresh_meal, false))                      AS is_fresh_meal,
           MAX(p.meal_type)                                               AS meal_type,
           COALESCE(SUM(s.charged), 0)::float                            AS revenue,
           COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS cost,
           COALESCE(SUM(s.quantity), 0)::int                             AS units,
           COUNT(*)::int                                                 AS transactions,
           -- Margin basis: PAID vends only (charged > 0). Free £0 vends — early
           -- test dispenses and ongoing free vends — carry full cost but no
           -- revenue, so including them turns margin wildly negative and makes
           -- the avg "price" meaningless. Tracked separately via free_vends.
           COALESCE(SUM(s.charged) FILTER (WHERE s.charged > 0), 0)::float                            AS paid_revenue,
           COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity) FILTER (WHERE s.charged > 0), 0)::float AS paid_cost,
           COALESCE(SUM(s.quantity) FILTER (WHERE s.charged > 0), 0)::int                             AS paid_units,
           COUNT(*) FILTER (WHERE s.charged = 0)::int                                                 AS free_vends,
           COUNT(*) FILTER (WHERE COALESCE(s.discount_value, 0) > 0 AND s.charged > 0)::int           AS discounted_vends
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY s.sku
  `;

  const stock = await stockOnHandBySku(scope);
  const list = rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    // Fresh-meal flavours roll up to their bucket; everything else keeps its category.
    category: effectiveCategory({ isFreshMeal: r.is_fresh_meal, mealType: r.meal_type, category: r.category }),
    revenue: r.revenue,
    cost: r.cost,
    profit: r.revenue - r.cost,
    units: r.units,
    transactions: r.transactions,
    // Paid-only basis drives margin; free/promo vends are counted for callouts.
    paidRevenue: r.paid_revenue,
    paidCost: r.paid_cost,
    paidUnits: r.paid_units,
    freeVends: r.free_vends,
    discountedVends: r.discounted_vends,
    marginPct: marginPct(r.paid_revenue, r.paid_cost),
    stockOnHand: stock ? stock.get(r.sku) ?? 0 : null,
  }));

  // Add products that have stock on hand but no sales in the period — they don't
  // appear in the sales query but the delist/relocate rule needs them.
  if (stock) {
    const present = new Set(rows.map((r) => r.sku));
    const missing = [...stock.keys()].filter((sku) => !present.has(sku) && stock.get(sku) > 0);
    if (missing.length) {
      const prods = await prisma.product.findMany({
        where: { sku: { in: missing } },
        select: { sku: true, name: true, category: true, isFreshMeal: true, mealType: true },
      });
      const pm = new Map(prods.map((p) => [p.sku, p]));
      for (const sku of missing) {
        const p = pm.get(sku);
        list.push({
          sku,
          name: p?.name || sku,
          category: effectiveCategory({ isFreshMeal: p?.isFreshMeal, mealType: p?.mealType, category: p?.category }),
          revenue: 0,
          cost: 0,
          profit: 0,
          units: 0,
          transactions: 0,
          paidRevenue: 0,
          paidCost: 0,
          paidUnits: 0,
          freeVends: 0,
          discountedVends: 0,
          marginPct: null,
          stockOnHand: stock.get(sku),
        });
      }
    }
  }

  return list;
}

// Which requested names had no sales in the period — surfaced so a route or
// multi-select that silently matches nothing is visible, not hidden.
async function namesWithNoSales({ startDate, endDate }, names) {
  const list = (names || []).filter((n) => n && n !== 'all');
  if (list.length === 0) return [];
  const where = salesWhere({ startDate, endDate, names: list });
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT COALESCE(s.location_name, 'Unknown') AS name FROM sales s WHERE ${where}
  `;
  const present = new Set(rows.map((r) => r.name));
  return list.filter((n) => !present.has(n));
}

/**
 * Daily transaction counts (London local days), refunds excluded. Deliberately
 * client-safe: returns ONLY date + transaction count, never revenue — it feeds
 * the client report's trend chart. Resolves the same location scope as the
 * dashboard.
 *
 * query: { startDate, endDate, locationName (string|array), routeId }
 */
export async function getDailyTransactions(query = {}) {
  const scope = await resolveLocationScope({ locationNames: query.locationName, routeId: query.routeId });
  const where = salesWhere({ startDate: query.startDate, endDate: query.endDate, names: scope.names });
  const rows = await prisma.$queryRaw`
    SELECT to_char((s."timestamp" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS date,
           COUNT(*)::int AS transactions
    FROM sales s
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
  return rows.map((r) => ({ date: r.date, transactions: r.transactions }));
}

/**
 * Full dashboard payload for a date range + location scope. One call so every
 * section shares identical scope and numbers.
 *
 * query: { startDate, endDate, locationName (string|array), routeId }
 */
export async function getDashboard(query = {}) {
  const scope = await resolveLocationScope({ locationNames: query.locationName, routeId: query.routeId });
  const range = { startDate: query.startDate || null, endDate: query.endDate || null };
  const days = range.startDate && range.endDate ? periodDays(range.startDate, range.endDate) : null;

  const [head, time, products, noSales, parents] = await Promise.all([
    headline(range, scope.names),
    timing(range, scope.names),
    productStats(range, scope),
    namesWithNoSales(range, scope.names),
    // Product families (parent products). Fail-soft: if 026_product_parents
    // isn't applied yet the query throws — the dashboard must not 500 for it.
    // But LOG the failure: a silent [] here would make any future schema break
    // read as "no families configured", forever.
    prisma.productParent
      .findMany({
        orderBy: { name: 'asc' },
        // Belt-and-braces: a fresh-meal-flagged product is out of its family
        // everywhere else (ordering, picking, starvation) — the dashboard must
        // agree, even for rows flagged before the invariant was enforced.
        include: { products: { where: { isFreshMeal: false }, select: { sku: true, name: true } } },
      })
      .catch((err) => {
        console.warn('[analytics] product families unavailable, dashboard omits them:', err.message);
        return [];
      }),
  ]);

  // Portfolio margin is computed on the same paid-only basis as per-product
  // margin (free £0 vends excluded) so the "vs portfolio average" comparison in
  // the suggestion rules stays apples-to-apples.
  const sumPaidRevenue = products.reduce((a, p) => a + p.paidRevenue, 0);
  const sumPaidCost = products.reduce((a, p) => a + p.paidCost, 0);
  const portfolioMarginPct = marginPct(sumPaidRevenue, sumPaidCost);

  const withSales = products.filter((p) => p.units > 0);
  const topByUnits = [...withSales].sort((a, b) => b.units - a.units).slice(0, 10);
  const topByRevenue = [...withSales].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const slowMovers = products
    .filter((p) => p.stockOnHand != null && p.stockOnHand > 0)
    .sort((a, b) => a.units - b.units || b.stockOnHand - a.stockOnHand)
    .slice(0, 10);

  const catMap = new Map();
  for (const p of products) {
    const c = catMap.get(p.category) || { category: p.category, units: 0, revenue: 0, transactions: 0 };
    c.units += p.units;
    c.revenue += p.revenue;
    c.transactions += p.transactions;
    catMap.set(p.category, c);
  }
  const categories = [...catMap.values()].sort((a, b) => b.units - a.units);

  // Margin-table rows expose the paid-only basis (revenue/cost/units) so the
  // displayed avg price/cost reflect real paid sales, plus free/promo counts the
  // UI surfaces as badges. Total units stay available for the volume sort.
  const marginRow = (p) => ({
    sku: p.sku,
    name: p.name,
    units: p.units,
    paidUnits: p.paidUnits,
    revenue: p.paidRevenue,
    cost: p.paidCost,
    marginPct: p.marginPct,
    freeVends: p.freeVends,
    discountedVends: p.discountedVends,
  });
  const marginable = withSales.filter((p) => p.marginPct != null);
  const byLowestMargin = [...marginable].sort((a, b) => a.marginPct - b.marginPct).slice(0, 10).map(marginRow);
  const byHighestVolume = [...withSales].sort((a, b) => b.units - a.units).slice(0, 10).map(marginRow);

  const stockResolved = scope.isAll || (scope.locationIds && scope.locationIds.length > 0);
  const suggestions = days ? computeSuggestions(products, { portfolioMarginPct, periodDays: days }) : [];
  const families = aggregateFamilies(parents, products, { stockResolved });

  return {
    period: { startDate: range.startDate, endDate: range.endDate, days },
    scope: {
      names: scope.names,
      locationIds: scope.locationIds,
      routeId: scope.routeId,
      routeName: scope.routeName,
      isAll: scope.isAll,
      namesWithNoSales: noSales,
    },
    headline: head,
    timing: time,
    products: { topByUnits, topByRevenue, slowMovers, categories },
    families,
    margin: { portfolioMarginPct, byLowestMargin, byHighestVolume },
    suggestions,
    insufficientData: {
      sales: head.insufficientData,
      stock: !stockResolved,
      comparison: !days,
    },
  };
}
