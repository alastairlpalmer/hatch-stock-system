import React, { useState, useEffect, useMemo } from 'react';
import { analyticsService } from '../../../services/analytics.service';
import HeadlineStats from './HeadlineStats';
import SalesTiming from './SalesTiming';
import ProductPerformance from './ProductPerformance';
import ProductFamilies from './ProductFamilies';
import MarginAnalysis from './MarginAnalysis';
import SuggestionsPanel from './SuggestionsPanel';

// --- date helpers (local time) -------------------------------------------------
function ymd(d) {
  const z = new Date(d);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, '0');
  const da = String(z.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
// Monday-based start of week
function startOfWeek(ref) {
  const d = new Date(ref);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}
function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case 'this-week':
      return { start: ymd(startOfWeek(now)), end: ymd(now) };
    case 'last-week': {
      const s = startOfWeek(now);
      const ls = new Date(s); ls.setDate(ls.getDate() - 7);
      const le = new Date(s); le.setDate(le.getDate() - 1);
      return { start: ymd(ls), end: ymd(le) };
    }
    case 'this-month':
      return { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end: ymd(now) };
    case 'last-month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: ymd(s), end: ymd(e) };
    }
    default:
      return null;
  }
}

const PRESETS = [
  { id: 'this-week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

/**
 * Sales analytics dashboard (Feature 1). Self-contained: owns its date/location/
 * route filter and pulls everything from /api/analytics/dashboard so every
 * section is computed from one consistent scope.
 *
 * Props: locationOptions (string[] of sales location names), routes ([{id,name}]).
 */
export default function AnalyticsDashboard({ locationOptions = [], routes = [] }) {
  const [preset, setPreset] = useState('this-month');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [locations, setLocations] = useState([]); // selected location names
  const [routeId, setRouteId] = useState('');
  const [locOpen, setLocOpen] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Resolve the active range from preset (or custom inputs).
  const range = useMemo(() => {
    if (preset === 'custom') {
      return custom.start && custom.end ? { start: custom.start, end: custom.end } : null;
    }
    return presetRange(preset);
  }, [preset, custom.start, custom.end]);

  const toggleLocation = (name) =>
    setLocations((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));

  // Route and explicit locations are mutually exclusive scopes.
  const selectRoute = (id) => {
    setRouteId(id);
    if (id) setLocations([]);
  };
  const onToggleLocation = (name) => {
    if (routeId) setRouteId('');
    toggleLocation(name);
  };

  const params = useMemo(() => {
    const p = {};
    if (range) {
      p.startDate = `${range.start}T00:00:00`;
      p.endDate = `${range.end}T23:59:59.999`;
    }
    if (routeId) p.routeId = routeId;
    else if (locations.length > 0) p.locationName = locations;
    return p;
  }, [range, routeId, locations]);

  const paramsKey = JSON.stringify(params);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    analyticsService
      .getDashboard(params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e?.response?.data?.error || e.message || 'Failed to load analytics'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const locLabel =
    locations.length === 0 ? 'All locations'
      : locations.length === 1 ? locations[0]
      : `${locations.length} locations combined`;

  const noSales = data?.scope?.namesWithNoSales || [];
  const stockKnown = data ? !data.insufficientData?.stock : true;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded text-sm transition-colors ${
                preset === p.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={custom.start}
                onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
              />
              <span className="text-zinc-600 text-sm">→</span>
              <input
                type="date"
                value={custom.end}
                onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Location multi-select */}
          <div className="flex items-center gap-2 relative">
            <span className="text-zinc-500 text-sm">Locations:</span>
            <button
              onClick={() => setLocOpen((o) => !o)}
              disabled={!!routeId}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 hover:border-zinc-500 text-left min-w-[10rem] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {locLabel}
              <span className="ml-2 text-zinc-500 text-xs">▾</span>
            </button>
            {locOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLocOpen(false)} />
                <div className="absolute top-full left-0 mt-2 z-20 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 space-y-0.5 max-h-80 overflow-y-auto">
                  <button
                    onClick={() => { setLocations([]); setLocOpen(false); }}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-zinc-700 ${locations.length === 0 ? 'text-emerald-400' : 'text-zinc-300'}`}
                  >
                    All locations
                  </button>
                  <div className="border-t border-zinc-700 my-1" />
                  {locationOptions.map((loc) => (
                    <label key={loc} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-zinc-700 cursor-pointer text-sm text-zinc-300">
                      <input
                        type="checkbox"
                        checked={locations.includes(loc)}
                        onChange={() => onToggleLocation(loc)}
                        className="w-4 h-4 rounded border-zinc-600 accent-emerald-500"
                      />
                      <span className="truncate">{loc}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Route select */}
          <div className="flex items-center gap-2">
            <span className="text-zinc-500 text-sm">Route:</span>
            <select
              value={routeId}
              onChange={(e) => selectRoute(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">— none —</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {(routeId || locations.length > 0) && (
            <button
              onClick={() => { setRouteId(''); setLocations([]); }}
              className="text-zinc-400 hover:text-white text-sm"
            >
              Clear scope
            </button>
          )}
          {data?.scope?.routeName && (
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
              Route: {data.scope.routeName} ({data.scope.names.length} locations)
            </span>
          )}
        </div>
      </div>

      {/* States */}
      {loading && <div className="text-sm text-zinc-500">Loading analytics…</div>}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-4 text-sm">
          Couldn’t load analytics: {error}
        </div>
      )}

      {data && !error && (
        <div className="space-y-6">
          {/* Honesty banners */}
          {data.insufficientData?.sales && (
            <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 text-sm text-zinc-400">
              Insufficient data — there are no non-refunded sales in the selected period/scope. Metrics below show zero.
            </div>
          )}
          {noSales.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
              No sales found for: {noSales.join(', ')}. These selected location name(s) may be aliases — check the
              Merge Location Names tool in Admin.
            </div>
          )}

          <HeadlineStats headline={data.headline} period={data.period} />
          <SalesTiming timing={data.timing} />
          <ProductPerformance products={data.products} stockKnown={stockKnown} />
          {/* Only render when the backend is new enough to send families. */}
          {data.families && <ProductFamilies families={data.families} stockKnown={stockKnown} />}
          <MarginAnalysis margin={data.margin} />
          <SuggestionsPanel suggestions={data.suggestions} insufficientData={data.insufficientData} />
        </div>
      )}
    </div>
  );
}
