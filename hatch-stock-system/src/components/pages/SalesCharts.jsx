import React, { useMemo, useState } from 'react';
import InfoTip from '../ui/InfoTip';

/**
 * Two professional, dependency-free SVG charts for the Sales Overview:
 *
 *   1. RevenueByCategoryChart — stacked bars showing where each day's revenue
 *      comes from (by product category).
 *   2. RevenueProfitAreaChart — a layered area chart with the Revenue line on
 *      top and Profit shown as a solid fill beneath it (the band between the
 *      two reads as cost of goods).
 *
 * Both share the app's dark zinc + emerald aesthetic, render crisp at any width
 * via a fixed viewBox, and expose an interactive hover tooltip with a guide
 * line so figures can be read precisely.
 */

// --- shared helpers ------------------------------------------------------------

// A curated palette that stays legible on the dark background. The first entry
// is emerald (the app's money colour); the rest are chosen for contrast.
const CATEGORY_COLORS = [
  '#34d399', // emerald
  '#38bdf8', // sky
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#fb7185', // rose
  '#2dd4bf', // teal
  '#fb923c', // orange
];
const OTHER_COLOR = '#64748b'; // slate — the rolled-up "Other" bucket

// Round an axis maximum up to a clean value so gridline labels read nicely.
function niceMax(v) {
  if (!v || v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  let m;
  if (n <= 1) m = 1;
  else if (n <= 2) m = 2;
  else if (n <= 2.5) m = 2.5;
  else if (n <= 5) m = 5;
  else m = 10;
  return m * pow;
}

// Compact money for axis ticks: £1.2k, £850, £0
function fmtAxis(v) {
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `£${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `£${Math.round(v)}`;
}

// Full money for tooltips
function fmtMoney(v) {
  return `£${(v || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDateShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fmtDateFull(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Tooltip heading: exact day normally, "Week of …" when bucketed weekly
function fmtBucketDate(dateStr, weekly) {
  return weekly ? `Week of ${fmtDateShort(dateStr)}` : fmtDateFull(dateStr);
}

// --- date-range scoping ----------------------------------------------------

const RANGE_OPTIONS = [
  { id: '14', label: '14D', days: 14 },
  { id: '30', label: '30D', days: 30 },
  { id: '90', label: '90D', days: 90 },
  { id: 'all', label: 'All', days: null },
];

// Beyond this many distinct days, daily bars become slivers — group weekly
const WEEKLY_THRESHOLD_DAYS = 112;

// Monday of the week containing the given YYYY-MM-DD date
function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d)) return dateStr;
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return d.toISOString().split('T')[0];
}

// Keep the trailing N days of rows, anchored to the newest date present (not
// "today") so the charts never render empty just because sales are stale.
function applyRange(rows, days) {
  if (!days || rows.length === 0) return rows;
  const last = rows.reduce((max, r) => (r.date > max ? r.date : max), rows[0].date);
  const cutoffDate = new Date(`${last}T00:00:00`);
  cutoffDate.setDate(cutoffDate.getDate() - (days - 1));
  const cutoff = cutoffDate.toISOString().split('T')[0];
  return rows.filter((r) => r.date >= cutoff);
}

// Evenly pick ~count indices from [0, n) for thinned axis labels (always
// includes the last point).
function tickIndices(n, count) {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (count - 1);
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.round(i * step));
  return [...new Set(out)];
}

// Shared card chrome
function ChartCard({ title, tip, right, children }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <h3 className="text-sm font-medium text-zinc-400">
          {title}
          {tip && <InfoTip text={tip} width="w-72" />}
        </h3>
        {right}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ children }) {
  return <p className="text-sm text-zinc-500 py-8 text-center">{children}</p>;
}

// Floating HTML tooltip positioned by percentage across the chart container.
function HoverTooltip({ xPct, children }) {
  // Flip to the left of the cursor when near the right edge so it never clips.
  const flip = xPct > 62;
  return (
    <div
      className="pointer-events-none absolute top-2 z-20"
      style={{ left: `${xPct}%`, transform: flip ? 'translateX(-100%)' : 'translateX(0)' }}
    >
      <div className={`bg-zinc-800/95 backdrop-blur border border-zinc-700 rounded-lg shadow-xl px-3 py-2 text-xs ${flip ? 'mr-2' : 'ml-2'}`}>
        {children}
      </div>
    </div>
  );
}

// --- 1. Stacked revenue-by-category chart --------------------------------------

const VB_W = 820;
const VB_H = 300;
const PAD = { t: 14, r: 18, b: 34, l: 56 };
const PLOT_W = VB_W - PAD.l - PAD.r;
const PLOT_H = VB_H - PAD.t - PAD.b;

export function RevenueByCategoryChart({ dailyByCategory = [], weekly = false }) {
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!dailyByCategory.length) return null;

    // Rank categories by total revenue; keep the top 7, roll the rest into
    // "Other" so the legend and stack stay readable.
    const catTotals = {};
    for (const r of dailyByCategory) {
      catTotals[r.category] = (catTotals[r.category] || 0) + (r.revenue || 0);
    }
    const ranked = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
    const topCats = ranked.slice(0, CATEGORY_COLORS.length);
    const hasOther = ranked.length > topCats.length;
    const catOf = (c) => (topCats.includes(c) ? c : 'Other');

    const series = hasOther ? [...topCats, 'Other'] : topCats;
    const colorFor = (c) =>
      c === 'Other' ? OTHER_COLOR : CATEGORY_COLORS[topCats.indexOf(c) % CATEGORY_COLORS.length];

    // Pivot into { date -> { category -> revenue } }
    const byDate = new Map();
    for (const r of dailyByCategory) {
      if (!byDate.has(r.date)) byDate.set(r.date, {});
      const bucket = byDate.get(r.date);
      const c = catOf(r.category);
      bucket[c] = (bucket[c] || 0) + (r.revenue || 0);
    }

    const days = [...byDate.keys()].sort().map((date) => {
      const bucket = byDate.get(date);
      const total = series.reduce((s, c) => s + (bucket[c] || 0), 0);
      return { date, bucket, total };
    });

    const maxTotal = Math.max(...days.map((d) => d.total), 0);
    const yMax = niceMax(maxTotal);

    return { series, colorFor, days, yMax };
  }, [dailyByCategory]);

  if (!model || model.days.length === 0) {
    return (
      <ChartCard
        title="Revenue by Category"
        tip="How each day's takings split across product categories. Refunds are excluded and Frive fresh-meal flavours roll up into their meal-type bucket."
      >
        <EmptyState>No sales in the selected period.</EmptyState>
      </ChartCard>
    );
  }

  const { series, colorFor, days, yMax } = model;
  const n = days.length;
  const slotW = PLOT_W / n;
  const barW = Math.max(1, Math.min(slotW * 0.72, 46));
  const yScale = (v) => PAD.t + PLOT_H - (v / yMax) * PLOT_H;

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const labelIdx = new Set(tickIndices(n, Math.min(n, 8)));

  const hovered = hover != null ? days[hover] : null;
  const hoverXPct = hover != null ? ((PAD.l + (hover + 0.5) * slotW) / VB_W) * 100 : 0;

  return (
    <ChartCard
      title="Revenue by Category"
      tip="How each day's takings split across product categories (stacked). Refunds are excluded and Frive fresh-meal flavours roll up into their meal-type bucket. Top categories are shown individually; the rest are grouped as “Other”."
      right={
        <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap justify-end max-w-[60%]">
          {series.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colorFor(c) }} />
              {c}
            </span>
          ))}
        </div>
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" preserveAspectRatio="none">
          {/* gridlines + y labels */}
          {gridVals.map((v, i) => (
            <g key={i}>
              <line
                x1={PAD.l}
                x2={VB_W - PAD.r}
                y1={yScale(v)}
                y2={yScale(v)}
                stroke="#27272a"
                strokeWidth="1"
              />
              <text x={PAD.l - 8} y={yScale(v) + 3} textAnchor="end" className="fill-zinc-600" fontSize="10">
                {fmtAxis(v)}
              </text>
            </g>
          ))}

          {/* stacked bars */}
          {days.map((d, i) => {
            let yTop = yScale(0);
            const x = PAD.l + i * slotW + (slotW - barW) / 2;
            return (
              <g key={d.date}>
                {series.map((c) => {
                  const val = d.bucket[c] || 0;
                  if (val <= 0) return null;
                  const h = (val / yMax) * PLOT_H;
                  yTop -= h;
                  return (
                    <rect
                      key={c}
                      x={x}
                      y={yTop}
                      width={barW}
                      height={h}
                      fill={colorFor(c)}
                      opacity={hover == null || hover === i ? 0.92 : 0.32}
                      style={{ transition: 'opacity 120ms' }}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* x labels */}
          {days.map((d, i) =>
            labelIdx.has(i) ? (
              <text
                key={d.date}
                x={PAD.l + i * slotW + slotW / 2}
                y={VB_H - 12}
                textAnchor="middle"
                className="fill-zinc-600"
                fontSize="10"
              >
                {fmtDateShort(d.date)}
              </text>
            ) : null
          )}

          {/* hover capture (transparent columns) */}
          {days.map((d, i) => (
            <rect
              key={d.date}
              x={PAD.l + i * slotW}
              y={PAD.t}
              width={slotW}
              height={PLOT_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            />
          ))}
        </svg>

        {hovered && (
          <HoverTooltip xPct={hoverXPct}>
            <div className="font-medium text-zinc-200 mb-1.5">{fmtBucketDate(hovered.date, weekly)}</div>
            <div className="space-y-1 min-w-[9rem]">
              {series
                .filter((c) => (hovered.bucket[c] || 0) > 0)
                .sort((a, b) => (hovered.bucket[b] || 0) - (hovered.bucket[a] || 0))
                .map((c) => (
                  <div key={c} className="flex items-center justify-between gap-4">
                    <span className="inline-flex items-center gap-1.5 text-zinc-400">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colorFor(c) }} />
                      {c}
                    </span>
                    <span className="text-zinc-200 tabular-nums">{fmtMoney(hovered.bucket[c])}</span>
                  </div>
                ))}
              <div className="flex items-center justify-between gap-4 pt-1 mt-1 border-t border-zinc-700">
                <span className="text-zinc-400">Total</span>
                <span className="text-emerald-400 font-medium tabular-nums">{fmtMoney(hovered.total)}</span>
              </div>
            </div>
          </HoverTooltip>
        )}
      </div>
    </ChartCard>
  );
}

// --- 2. Revenue + profit area chart --------------------------------------------

export function RevenueProfitAreaChart({ daily = [], weekly = false }) {
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    if (!daily.length) return null;
    const days = [...daily]
      .map((d) => ({
        date: d.date,
        revenue: d.revenue || 0,
        // profit may be absent in the offline fallback — derive if needed
        profit: d.profit != null ? d.profit : (d.revenue || 0) - (d.cost || 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const maxRevenue = Math.max(...days.map((d) => d.revenue), 0);
    const yMax = niceMax(maxRevenue);
    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);
    const totalProfit = days.reduce((s, d) => s + d.profit, 0);
    return { days, yMax, totalRevenue, totalProfit };
  }, [daily]);

  if (!model || model.days.length === 0) {
    return (
      <ChartCard
        title="Revenue & Profit Trend"
        tip="Daily revenue with gross profit filled beneath. Refunds are excluded; profit is revenue minus cost of goods."
      >
        <EmptyState>No sales in the selected period.</EmptyState>
      </ChartCard>
    );
  }

  const { days, yMax, totalRevenue, totalProfit } = model;
  const n = days.length;
  // Guard the single-point case so scaling still works.
  const xScale = (i) => (n === 1 ? PAD.l + PLOT_W / 2 : PAD.l + (i / (n - 1)) * PLOT_W);
  const yScale = (v) => PAD.t + PLOT_H - (Math.max(0, v) / yMax) * PLOT_H;
  const baseY = PAD.t + PLOT_H;

  const areaPath = (key) => {
    const top = days.map((d, i) => `${xScale(i)},${yScale(d[key])}`);
    return `M${PAD.l},${baseY} L${top.join(' L')} L${xScale(n - 1)},${baseY} Z`;
  };
  const linePath = (key) => days.map((d, i) => `${i === 0 ? 'M' : 'L'}${xScale(i)},${yScale(d[key])}`).join(' ');

  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const labelIdx = new Set(tickIndices(n, Math.min(n, 8)));

  const hovered = hover != null ? days[hover] : null;
  const hoverXPct = hover != null ? (xScale(hover) / VB_W) * 100 : 0;
  const margin = hovered && hovered.revenue > 0 ? (hovered.profit / hovered.revenue) * 100 : 0;

  return (
    <ChartCard
      title="Revenue & Profit Trend"
      tip="Daily revenue drawn as the top line, with gross profit filled beneath it — the lighter band between the two is cost of goods. Refunds are excluded; profit is revenue minus cost price × units, so days with missing cost prices show inflated profit."
      right={
        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <span className="w-3 h-[3px] rounded-full" style={{ backgroundColor: '#34d399' }} />
            Revenue <span className="text-zinc-500 tabular-nums">{fmtMoney(totalRevenue)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#059669' }} />
            Profit <span className="text-zinc-500 tabular-nums">{fmtMoney(totalProfit)}</span>
          </span>
        </div>
      }
    >
      <div className="relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto" preserveAspectRatio="none">
          <defs>
            <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="profitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.18" />
            </linearGradient>
          </defs>

          {/* gridlines + y labels */}
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={VB_W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="#27272a" strokeWidth="1" />
              <text x={PAD.l - 8} y={yScale(v) + 3} textAnchor="end" className="fill-zinc-600" fontSize="10">
                {fmtAxis(v)}
              </text>
            </g>
          ))}

          {/* revenue area + profit area (profit drawn on top so it reads as a fill within revenue) */}
          <path d={areaPath('revenue')} fill="url(#revFill)" />
          <path d={areaPath('profit')} fill="url(#profitFill)" />

          {/* profit line then revenue line on top */}
          <path d={linePath('profit')} fill="none" stroke="#059669" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
          <path d={linePath('revenue')} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* x labels */}
          {days.map((d, i) =>
            labelIdx.has(i) ? (
              <text key={d.date} x={xScale(i)} y={VB_H - 12} textAnchor="middle" className="fill-zinc-600" fontSize="10">
                {fmtDateShort(d.date)}
              </text>
            ) : null
          )}

          {/* hover guide + markers */}
          {hovered && (
            <g>
              <line x1={xScale(hover)} x2={xScale(hover)} y1={PAD.t} y2={baseY} stroke="#52525b" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={xScale(hover)} cy={yScale(hovered.revenue)} r="3.5" fill="#34d399" stroke="#0a0a0a" strokeWidth="1.5" />
              <circle cx={xScale(hover)} cy={yScale(hovered.profit)} r="3.5" fill="#059669" stroke="#0a0a0a" strokeWidth="1.5" />
            </g>
          )}

          {/* hover capture */}
          {days.map((d, i) => {
            const w = n === 1 ? PLOT_W : PLOT_W / (n - 1);
            return (
              <rect
                key={d.date}
                x={xScale(i) - w / 2}
                y={PAD.t}
                width={w}
                height={PLOT_H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              />
            );
          })}
        </svg>

        {hovered && (
          <HoverTooltip xPct={hoverXPct}>
            <div className="font-medium text-zinc-200 mb-1.5">{fmtBucketDate(hovered.date, weekly)}</div>
            <div className="space-y-1 min-w-[9rem]">
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#34d399' }} />
                  Revenue
                </span>
                <span className="text-zinc-200 tabular-nums">{fmtMoney(hovered.revenue)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5 text-zinc-400">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: '#059669' }} />
                  Profit
                </span>
                <span className="text-zinc-200 tabular-nums">{fmtMoney(hovered.profit)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 pt-1 mt-1 border-t border-zinc-700">
                <span className="text-zinc-400">Margin</span>
                <span className="text-emerald-400 font-medium tabular-nums">{margin.toFixed(1)}%</span>
              </div>
            </div>
          </HoverTooltip>
        )}
      </div>
    </ChartCard>
  );
}

export default function SalesCharts({ daily = [], dailyByCategory = [] }) {
  // The page fetches effectively-all history when no date filter is set, so
  // the charts scope themselves: a trailing-window toggle, plus automatic
  // weekly grouping when the window is still too wide for daily bars.
  const [range, setRange] = useState('30');
  const rangeDays = RANGE_OPTIONS.find((o) => o.id === range)?.days ?? 30;

  const { dailyRows, categoryRows, weekly } = useMemo(() => {
    const d = applyRange(daily, rangeDays);
    const c = applyRange(dailyByCategory, rangeDays);
    const span = new Set(d.map((r) => r.date)).size;
    if (span <= WEEKLY_THRESHOLD_DAYS) {
      return { dailyRows: d, categoryRows: c, weekly: false };
    }

    const byWeek = {};
    for (const r of d) {
      const key = weekStart(r.date);
      if (!byWeek[key]) byWeek[key] = { date: key, revenue: 0, profit: 0 };
      byWeek[key].revenue += r.revenue || 0;
      byWeek[key].profit += r.profit != null ? r.profit : (r.revenue || 0) - (r.cost || 0);
    }
    const byWeekCat = {};
    for (const r of c) {
      const week = weekStart(r.date);
      const key = `${week}|${r.category}`;
      if (!byWeekCat[key]) byWeekCat[key] = { date: week, category: r.category, revenue: 0 };
      byWeekCat[key].revenue += r.revenue || 0;
    }
    return {
      dailyRows: Object.values(byWeek).sort((a, b) => a.date.localeCompare(b.date)),
      categoryRows: Object.values(byWeekCat),
      weekly: true,
    };
  }, [daily, dailyByCategory, rangeDays]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2 -mb-2">
        <span className="text-xs text-zinc-500">
          {weekly ? 'Grouped by week — the range is too long for daily bars' : ''}
        </span>
        <div className="flex rounded-lg bg-zinc-800 border border-zinc-700 p-0.5">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setRange(o.id)}
              className={`px-3 py-1 rounded-md text-xs transition-colors ${
                range === o.id
                  ? 'bg-emerald-500 text-zinc-900 font-medium'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <RevenueProfitAreaChart daily={dailyRows} weekly={weekly} />
      <RevenueByCategoryChart dailyByCategory={categoryRows} weekly={weekly} />
    </div>
  );
}
