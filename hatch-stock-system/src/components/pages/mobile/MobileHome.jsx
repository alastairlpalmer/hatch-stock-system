import React, { useState, useEffect } from 'react';
import { analyticsService } from '../../../services/analytics.service';
import HeadlineStats from '../analytics/HeadlineStats';
import MachineOverview from './MachineOverview';
import SalesDigest from './SalesDigest';

// --- date helpers (mirrors AnalyticsDashboard's local-time helpers) --------
function ymd(d) {
  const z = new Date(d);
  const y = z.getFullYear();
  const m = String(z.getMonth() + 1).padStart(2, '0');
  const da = String(z.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}
function startOfWeek(ref) {
  const d = new Date(ref);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d;
}
function rangeFor(preset) {
  const now = new Date();
  if (preset === 'this-week') return { startDate: ymd(startOfWeek(now)), endDate: ymd(now) };
  return { startDate: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: ymd(now) };
}

// Headline sales stats with its own fetch, so the section fails independently
// of the rest of the page (machines + digest render from StockContext even
// when the analytics endpoint is down).
function HeadlineSection() {
  const [preset, setPreset] = useState('this-week');
  const [state, setState] = useState({ loading: true, error: null, dashboard: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    analyticsService.getDashboard(rangeFor(preset))
      .then((dashboard) => { if (!cancelled) setState({ loading: false, error: null, dashboard }); })
      .catch(() => {
        if (!cancelled) setState({ loading: false, error: 'Sales stats unavailable right now.', dashboard: null });
      });
    return () => { cancelled = true; };
  }, [preset]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-400">Sales</h2>
        <div className="flex gap-1">
          {[['this-week', 'This week'], ['this-month', 'This month']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPreset(id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                preset === id ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {state.loading ? (
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-zinc-900/50 border border-zinc-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : state.error ? (
        <p className="text-xs text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-2">{state.error}</p>
      ) : (
        <HeadlineStats headline={state.dashboard.headline} period={state.dashboard.period} />
      )}
    </section>
  );
}

// Composite mobile home ("Locations" bottom tab): headline sales → stock in
// machines → recent transactions. Each section loads and fails independently.
export default function MobileHome() {
  return (
    <div className="space-y-6">
      <HeadlineSection />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400">Machines</h2>
        <MachineOverview />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-400">Recent sales</h2>
        <SalesDigest />
      </section>
    </div>
  );
}
