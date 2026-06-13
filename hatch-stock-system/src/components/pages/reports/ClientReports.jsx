import React, { useState, useEffect } from 'react';
import { reportsService } from '../../../services/reports.service';
import InfoTip from '../../ui/InfoTip';
import { formatDate } from '../../../utils/helpers';

// Default the date inputs to the previous calendar month.
function previousMonthDefaults() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: ymd(start), end: ymd(end) };
}

/**
 * Client-facing report generator + filing system (Feature 2). Produces a concise,
 * branded PDF for the client whose site hosts the machines. The PDF is strictly
 * client-safe — no revenue, cost, margin or waste (enforced server-side).
 *
 * Props: locationOptions (string[] sales location names), routes ([{id,name}]).
 */
export default function ClientReports({ locationOptions = [], routes = [] }) {
  const defaults = previousMonthDefaults();
  const [form, setForm] = useState({
    clientName: '',
    siteName: '',
    start: defaults.start,
    end: defaults.end,
    locations: [],
    routeId: '',
  });
  const [locOpen, setLocOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [reports, setReports] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  const refresh = () => {
    setLoadingList(true);
    reportsService
      .list()
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoadingList(false));
  };
  useEffect(refresh, []);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const toggleLocation = (name) => {
    if (form.routeId) set({ routeId: '' });
    set({ locations: form.locations.includes(name) ? form.locations.filter((n) => n !== name) : [...form.locations, name] });
  };
  const selectRoute = (id) => set({ routeId: id, locations: id ? [] : form.locations });

  const canGenerate = form.clientName.trim() && form.siteName.trim() && form.start && form.end && !generating;

  const generate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const input = {
        clientName: form.clientName.trim(),
        siteName: form.siteName.trim(),
        startDate: `${form.start}T00:00:00`,
        endDate: `${form.end}T23:59:59.999`,
      };
      if (form.routeId) input.routeId = form.routeId;
      else if (form.locations.length > 0) input.locationName = form.locations;
      await reportsService.generate(input);
      refresh();
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  const locLabel =
    form.locations.length === 0 ? 'All locations'
      : form.locations.length === 1 ? form.locations[0]
      : `${form.locations.length} locations combined`;

  const period = (r) => `${formatDate(r.periodStart)} – ${formatDate(r.periodEnd)}`;

  return (
    <div className="space-y-6">
      {/* Generator */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-zinc-300">
            Generate client report
            <InfoTip
              width="w-80"
              text="Creates a concise, branded PDF for the client whose site hosts the machine(s). It contains usage only — transactions, units, active days, busiest times, top products and category mix — and never revenue, cost, margin or waste. Regenerating for the same site/period creates a new version."
            />
          </h3>
          <p className="text-xs text-zinc-500 mt-1">Client-safe: no revenue, costs, margins or waste are ever included.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs text-zinc-500">Client name</span>
            <input
              type="text"
              value={form.clientName}
              onChange={(e) => set({ clientName: e.target.value })}
              placeholder="e.g. Northgate Facilities Ltd"
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">Site name (shown on cover)</span>
            <input
              type="text"
              value={form.siteName}
              onChange={(e) => set({ siteName: e.target.value })}
              placeholder="e.g. Northgate Business Park — Atrium"
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>

        <div className="flex items-end gap-4 flex-wrap">
          <label className="block">
            <span className="text-xs text-zinc-500">From</span>
            <input type="date" value={form.start} onChange={(e) => set({ start: e.target.value })}
              className="mt-1 block bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />
          </label>
          <label className="block">
            <span className="text-xs text-zinc-500">To</span>
            <input type="date" value={form.end} onChange={(e) => set({ end: e.target.value })}
              className="mt-1 block bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500" />
          </label>

          {/* Location multi-select */}
          <div className="relative">
            <span className="text-xs text-zinc-500 block">Locations</span>
            <button
              onClick={() => setLocOpen((o) => !o)}
              disabled={!!form.routeId}
              className="mt-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm hover:border-zinc-500 text-left min-w-[10rem] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {locLabel}
              <span className="ml-2 text-zinc-500 text-xs">▾</span>
            </button>
            {locOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLocOpen(false)} />
                <div className="absolute top-full left-0 mt-2 z-20 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 space-y-0.5 max-h-72 overflow-y-auto">
                  <button onClick={() => { set({ locations: [] }); setLocOpen(false); }}
                    className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-zinc-700 ${form.locations.length === 0 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                    All locations
                  </button>
                  <div className="border-t border-zinc-700 my-1" />
                  {locationOptions.map((loc) => (
                    <label key={loc} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-zinc-700 cursor-pointer text-sm text-zinc-300">
                      <input type="checkbox" checked={form.locations.includes(loc)} onChange={() => toggleLocation(loc)}
                        className="w-4 h-4 rounded border-zinc-600 accent-emerald-500" />
                      <span className="truncate">{loc}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Route */}
          <label className="block">
            <span className="text-xs text-zinc-500 block">Route</span>
            <select value={form.routeId} onChange={(e) => selectRoute(e.target.value)}
              className="mt-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500">
              <option value="">— none —</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>

          <button
            onClick={generate}
            disabled={!canGenerate}
            className="bg-hatch-green text-hatch-cream px-4 py-2 rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating…' : 'Generate PDF'}
          </button>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded p-3 text-sm">{error}</div>}
      </div>

      {/* Filing system */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-6 pt-6 pb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-zinc-400">
            Reports
            <InfoTip text="Every generated report is filed here. Regenerating for the same site and period creates a new version rather than overwriting." />
          </h3>
          <button onClick={refresh} className="text-xs text-zinc-400 hover:text-white">Refresh</button>
        </div>
        {loadingList ? (
          <p className="px-6 pb-6 text-sm text-zinc-500">Loading…</p>
        ) : reports.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-zinc-500">No reports generated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-zinc-500 font-medium">Client / Site</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Period</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Version</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Generated</th>
                <th className="text-right px-6 py-3 text-zinc-500 font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-6 py-3">
                    <div className="text-zinc-200">{r.siteName}</div>
                    <div className="text-zinc-600 text-xs">{r.clientName}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{period(r)}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded">v{r.version}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">{formatDate(r.generatedAt, { includeTime: true })}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => reportsService.download(r.id, r.fileName)}
                      className="text-emerald-400 hover:text-emerald-300 text-sm"
                    >
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
