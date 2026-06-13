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

// WHERE fragment for the sales table. Deliberately duplicated from sales.js's
// analyticsWhere (not imported) so this module doesn't couple to the in-flight
// edits on that file — TODO: dedupe into utils/sales-filter.js once that lands.
function salesWhere({ startDate, endDate, names }, { includeRefunded = false } = {}) {
  const cond = [includeRefunded ? Prisma.sql`s.is_refunded = true` : Prisma.sql`s.is_refunded = false`];
  if (startDate) cond.push(Prisma.sql`s."timestamp" >= ${new Date(startDate)}`);
  if (endDate) cond.push(Prisma.sql`s."timestamp" <= ${new Date(endDate)}`);

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
           COALESCE(SUM(s.charged), 0)::float                            AS revenue,
           COALESCE(SUM(COALESCE(s.cost_price, 0) * s.quantity), 0)::float AS cost,
           COALESCE(SUM(s.quantity), 0)::int                             AS units,
           COUNT(*)::int                                                 AS transactions
    FROM sales s
    LEFT JOIN products p ON p.sku = s.sku
    WHERE ${where}
    GROUP BY s.sku
  `;

  const stock = await stockOnHandBySku(scope);
  const list = rows.map((r) => ({
    sku: r.sku,
    name: r.name,
    category: r.category,
    revenue: r.revenue,
    cost: r.cost,
    profit: r.revenue - r.cost,
    units: r.units,
    transactions: r.transactions,
    marginPct: marginPct(r.revenue, r.cost),
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
        select: { sku: true, name: true, category: true },
      });
      const pm = new Map(prods.map((p) => [p.sku, p]));
      for (const sku of missing) {
        const p = pm.get(sku);
        list.push({
          sku,
          name: p?.name || sku,
          category: p?.category || 'Other',
          revenue: 0,
          cost: 0,
          profit: 0,
          units: 0,
          transactions: 0,
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

  const [head, time, products, noSales] = await Promise.all([
    headline(range, scope.names),
    timing(range, scope.names),
    productStats(range, scope),
    namesWithNoSales(range, scope.names),
  ]);

  const sumRevenue = products.reduce((a, p) => a + p.revenue, 0);
  const sumCost = products.reduce((a, p) => a + p.cost, 0);
  const portfolioMarginPct = marginPct(sumRevenue, sumCost);

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

  const marginable = withSales.filter((p) => p.marginPct != null);
  const byLowestMargin = [...marginable].sort((a, b) => a.marginPct - b.marginPct).slice(0, 10);
  const byHighestVolume = [...withSales].sort((a, b) => b.units - a.units).slice(0, 10);

  const stockResolved = scope.isAll || (scope.locationIds && scope.locationIds.length > 0);
  const suggestions = days ? computeSuggestions(products, { portfolioMarginPct, periodDays: days }) : [];

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
    margin: { portfolioMarginPct, byLowestMargin, byHighestVolume },
    suggestions,
    insufficientData: {
      sales: head.insufficientData,
      stock: !stockResolved,
      comparison: !days,
    },
  };
}
