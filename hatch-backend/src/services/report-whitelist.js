/**
 * HARD SAFEGUARD for the client-facing report.
 *
 * Client reports must NEVER expose revenue, cost, margin, profit, pricing or
 * waste. Rather than trusting every call site to omit those fields, this module
 * is the single gate: toClientSafe() rebuilds a brand-new object containing only
 * an explicit allow-list of fields (units / counts / shares / dates / labels),
 * and assertClientSafe() then re-scans the result and throws if anything
 * forbidden slipped through. The PDF template is only ever handed the output of
 * toClientSafe(), and the report builder calls assertClientSafe() before
 * rendering — so a future edit that accidentally leaks a money field fails loudly
 * instead of shipping to a client.
 */

// Field names that must never appear anywhere in a client report payload.
export const FORBIDDEN_KEYS = [
  'revenue',
  'charged',
  'cost',
  'costprice',
  'cost_price',
  'profit',
  'margin',
  'marginpct',
  'portfoliomarginpct',
  'price',
  'saleprice',
  'sale_price',
  'unitcost',
  'unit_cost',
  'avgtransactionvalue',
  'refundedvalue',
  'waste',
  'wasterate',
  'wastecost',
];

function isForbiddenKey(key) {
  const k = String(key).toLowerCase().replace(/[^a-z]/g, '');
  return FORBIDDEN_KEYS.some((f) => k === f.replace(/[^a-z]/g, '') || k.includes('revenue') || k.includes('margin') || k.includes('profit') || k.includes('waste'));
}

/**
 * Recursively assert an object is free of any forbidden key, and that no string
 * value contains a currency marker (a cheap catch for money accidentally baked
 * into summary text). Throws on the first violation.
 */
export function assertClientSafe(value, path = 'report') {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.includes('£') || /\b(revenue|profit|margin)\b/i.test(value)) {
      throw new Error(`Client report safeguard: forbidden content in string at ${path}: "${value.slice(0, 60)}"`);
    }
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertClientSafe(v, `${path}[${i}]`));
    return value;
  }
  for (const [k, v] of Object.entries(value)) {
    if (isForbiddenKey(k)) {
      throw new Error(`Client report safeguard: forbidden key "${k}" at ${path}`);
    }
    assertClientSafe(v, `${path}.${k}`);
  }
  return value;
}

/**
 * Build the client-safe report DTO from the internal dashboard payload plus a
 * daily transaction series. Only the allow-listed fields are copied; everything
 * money-related is left behind by construction.
 *
 * dashboard: output of analytics.getDashboard()
 * dailyTransactions: [{ date, transactions }]  (NO revenue)
 * meta: { clientName, siteName, periodLabel, periodStart, periodEnd, scopeLabel }
 */
export function toClientSafe(dashboard, dailyTransactions, meta) {
  const h = dashboard.headline || {};
  const timing = dashboard.timing || {};
  const products = dashboard.products || {};

  const activeDays = (dailyTransactions || []).filter((d) => d.transactions > 0).length;
  const totalUnits = (products.categories || []).reduce((a, c) => a + c.units, 0);

  const topProducts = (products.topByUnits || []).slice(0, 8).map((p) => ({
    name: p.name,
    units: p.units,
  }));

  const categoryMix = (products.categories || []).map((c) => ({
    category: c.category,
    units: c.units,
    share: totalUnits > 0 ? Math.round((c.units / totalUnits) * 100) : 0,
  }));

  const dto = {
    meta: {
      clientName: meta.clientName,
      siteName: meta.siteName,
      periodLabel: meta.periodLabel,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      scopeLabel: meta.scopeLabel || null,
    },
    usage: {
      transactions: h.transactions || 0,
      units: h.units || 0,
      activeDays,
      busiestDay: timing.busiestDay ? timing.busiestDay.label : null,
      busiestHour: timing.busiestHour ? timing.busiestHour.hour : null,
      timezone: timing.timezone || 'Europe/London',
    },
    topProducts,
    categoryMix,
    dailyTransactions: (dailyTransactions || []).map((d) => ({ date: d.date, transactions: d.transactions })),
    summary: buildSummary({
      meta,
      transactions: h.transactions || 0,
      units: h.units || 0,
      activeDays,
      busiestDay: timing.busiestDay ? timing.busiestDay.label : null,
      busiestHour: timing.busiestHour ? timing.busiestHour.hour : null,
      topProduct: topProducts[0] || null,
      topCategory: [...categoryMix].sort((a, b) => b.units - a.units)[0] || null,
    }),
  };

  return assertClientSafe(dto);
}

/**
 * Template-based summary paragraph — composed only from the computed counts.
 * No claims that aren't backed by a number, and never any money.
 */
export function buildSummary(s) {
  const hour = (h) => `${String(h).padStart(2, '0')}:00`;
  const parts = [];
  parts.push(
    `During ${s.meta.periodLabel}, the ${s.meta.siteName} machine${s.meta.siteName ? '' : 's'} recorded ` +
      `${s.transactions.toLocaleString('en-GB')} transactions and ${s.units.toLocaleString('en-GB')} items dispensed ` +
      `across ${s.activeDays} active day${s.activeDays === 1 ? '' : 's'}.`,
  );
  if (s.busiestDay && s.busiestHour != null) {
    parts.push(`Demand was highest on ${s.busiestDay}s, typically peaking around ${hour(s.busiestHour)}.`);
  }
  if (s.topProduct) {
    parts.push(`The most popular item was ${s.topProduct.name} (${s.topProduct.units.toLocaleString('en-GB')} units).`);
  }
  if (s.topCategory) {
    parts.push(`${s.topCategory.category} made up the largest share of items at ${s.topCategory.share}%.`);
  }
  return parts.join(' ');
}
