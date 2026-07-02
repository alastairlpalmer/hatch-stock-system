import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ClipboardList, Loader2, MapPin, PackageCheck } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { pickListsService } from '../../../services/pickLists.service';

// Next Monday from today (if today is Monday, the one a week out —
// pick lists are packed Sunday night for the Monday run).
function nextMondayISO() {
  const d = new Date();
  const daysUntil = ((8 - d.getDay()) % 7) || 7;
  d.setDate(d.getDate() + daysUntil);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', opts);
}

const STATUS_STYLES = {
  draft: 'bg-zinc-800 text-zinc-300 border border-zinc-700',
  packed: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/30',
};

export function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        STATUS_STYLES[status] || STATUS_STYLES.draft
      }`}
    >
      {status}
    </span>
  );
}

export default function PickLists() {
  const { data } = useStock();
  const navigate = useNavigate();

  const routes = (data.restockRoutes || []).filter((r) => r.type !== 'adhoc');
  const warehouses = data.warehouses || [];
  const locations = data.locations || [];

  // ---- Generator state ----
  const [routeChoice, setRouteChoice] = useState('');
  const [customLocationIds, setCustomLocationIds] = useState([]);
  const [warehouseId, setWarehouseId] = useState(warehouses.length === 1 ? warehouses[0].id : '');
  const [targetDate, setTargetDate] = useState(nextMondayISO);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);

  // Preselect the warehouse once data arrives, when there is only one.
  useEffect(() => {
    if (warehouses.length === 1 && !warehouseId) {
      setWarehouseId(warehouses[0].id);
    }
  }, [warehouses, warehouseId]);

  // ---- Index state ----
  const [lists, setLists] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listsError, setListsError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await pickListsService.getAll();
        if (!cancelled) setLists(Array.isArray(result) ? result : []);
      } catch (err) {
        if (!cancelled) setListsError('Could not load pick lists.');
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const sortedLists = useMemo(
    () => [...lists].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)),
    [lists]
  );

  const isCustom = routeChoice === 'custom';
  const canGenerate =
    warehouseId &&
    targetDate &&
    (isCustom ? customLocationIds.length > 0 : !!routeChoice) &&
    !generating;

  const toggleCustomLocation = (locId) => {
    setCustomLocationIds((prev) =>
      prev.includes(locId) ? prev.filter((id) => id !== locId) : [...prev, locId]
    );
  };

  const generate = async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const params = { warehouseId, targetDate };
      if (isCustom) {
        params.locationIds = customLocationIds;
      } else {
        params.routeId = routeChoice;
      }
      const created = await pickListsService.generate(params);
      navigate(`/restock/picklists/${created.id}`);
    } catch (err) {
      setGenerateError(
        err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to generate pick list.'
      );
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Pick Lists</h2>
        <p className="text-zinc-500 text-sm mt-1">
          Generate what to pack for a run — quantities per product with the warehouse batch (soonest
          expiry) to pull from.
        </p>
      </div>

      {/* Generator */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2 text-zinc-200 font-medium">
          <ClipboardList size={18} className="text-emerald-400" />
          New pick list
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Route</label>
            <select
              value={routeChoice}
              onChange={(e) => setRouteChoice(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select route</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.locationIds?.length || 0} locations)
                </option>
              ))}
              <option value="custom">Custom — pick locations…</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select warehouse</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Target date</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        {isCustom && (
          <div>
            <label className="block text-xs text-zinc-500 mb-2">
              Locations ({customLocationIds.length} selected)
            </label>
            {locations.length === 0 ? (
              <p className="text-sm text-zinc-500">No locations configured.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {locations.map((loc) => {
                  const checked = customLocationIds.includes(loc.id);
                  return (
                    <label
                      key={loc.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm transition-colors ${
                        checked
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-zinc-100'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleCustomLocation(loc.id)}
                        className="accent-emerald-500"
                      />
                      <MapPin size={14} className="shrink-0 text-zinc-500" />
                      <span className="truncate">{loc.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {generateError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
            {generateError}
          </div>
        )}

        <button
          onClick={generate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating && <Loader2 size={16} className="animate-spin" />}
          {generating ? 'Generating…' : 'Generate pick list'}
        </button>
      </div>

      {/* Index */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-400">Recent pick lists</h3>

        {listsError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded p-3 text-red-400 text-sm">
            {listsError}
          </div>
        )}

        {loadingLists ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-6">
            <Loader2 size={16} className="animate-spin" /> Loading pick lists…
          </div>
        ) : sortedLists.length === 0 && !listsError ? (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
            <PackageCheck size={28} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-zinc-400 text-sm">No pick lists yet.</p>
            <p className="text-zinc-600 text-xs mt-1">
              Generate one above to plan what to pack for the next run.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedLists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => navigate(`/restock/picklists/${pl.id}`)}
                className="w-full text-left bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-emerald-500/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-zinc-100 font-medium truncate">
                        {pl.routeName || 'Custom locations'}
                      </span>
                      <StatusChip status={pl.status} />
                      {(pl.shortfalls?.length || 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 text-amber-400 text-xs"
                          title="Not enough warehouse stock for some products"
                        >
                          <AlertTriangle size={14} />
                          {pl.shortfalls.length} short
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      For {formatDate(pl.targetDate)} · {pl.items?.length || 0} products · created{' '}
                      {formatDate(pl.createdAt, { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                  <span className="text-zinc-500 shrink-0">→</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
