import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronRight, MapPin, Search } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import StockCheckForm from './StockCheckForm';

const NAME_STORAGE_KEY = 'hatch_checker_name';

/**
 * Standalone stock-check page (route: /restock/check).
 * Step 1: who's checking + pick a machine. Step 2: StockCheckForm.
 * On complete: variance summary with options to check another machine or
 * continue to the restock wizard.
 */
export default function StockCheck() {
  const { data } = useStock();
  const navigate = useNavigate();

  const [checkerName, setCheckerName] = useState(
    () => localStorage.getItem(NAME_STORAGE_KEY) || ''
  );
  const [locationId, setLocationId] = useState(null);
  const [machineSearch, setMachineSearch] = useState('');
  const [result, setResult] = useState(null);

  const updateName = (value) => {
    setCheckerName(value);
    try {
      localStorage.setItem(NAME_STORAGE_KEY, value);
    } catch {
      // storage unavailable (private mode) — the name just won't persist
    }
  };

  const machines = useMemo(() => {
    const query = machineSearch.trim().toLowerCase();
    return data.locations
      .filter(l => !l.archived && l.status !== 'archived')
      .filter(l => !query || l.name?.toLowerCase().includes(query))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [data.locations, machineSearch]);

  const location = data.locations.find(l => l.id === locationId);
  const nameReady = checkerName.trim().length > 0;

  // Variance summary for the success panel
  const summary = useMemo(() => {
    if (!result) return null;
    const items = result.items || [];
    const discrepancies = items.filter(i => (i.variance ?? 0) !== 0);
    let shortfallUnits = 0;
    let shortfallCost = 0;
    discrepancies.forEach(i => {
      if ((i.variance ?? 0) < 0) {
        const units = -i.variance;
        shortfallUnits += units;
        const product = data.products.find(p => p.sku === i.sku);
        shortfallCost += units * (product?.unitCost || 0);
      }
    });
    return {
      itemCount: items.length,
      discrepancyCount: discrepancies.length,
      shortfallUnits,
      shortfallCost,
    };
  }, [result, data.products]);

  const reset = () => {
    setResult(null);
    setLocationId(null);
    setMachineSearch('');
  };

  // ========== SUCCESS PANEL ==========

  if (result && summary) {
    const allCorrect = summary.discrepancyCount === 0;
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div className={`rounded-2xl border p-6 text-center ${
          allCorrect
            ? 'border-emerald-900/50 bg-emerald-900/20'
            : 'border-zinc-800 bg-zinc-900/50'
        }`}>
          <CheckCircle2 className={`mx-auto h-12 w-12 ${allCorrect ? 'text-emerald-400' : 'text-zinc-300'}`} />
          <h3 className="mt-3 text-lg font-semibold text-zinc-100">Stock check submitted</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {location?.name || result.locationName}
            {checkerName.trim() ? ` · by ${checkerName.trim()}` : ''}
          </p>

          {allCorrect ? (
            <p className="mt-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-400">
              All {summary.itemCount} items correct — no shrinkage found
            </p>
          ) : (
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-xl bg-zinc-800/60 px-4 py-3">
                <span className="text-zinc-400">Discrepancies</span>
                <span className="font-semibold text-zinc-100">
                  {summary.discrepancyCount} of {summary.itemCount} items
                </span>
              </div>
              {summary.shortfallUnits > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-red-500/10 px-4 py-3">
                  <span className="text-red-300">Total shortfall</span>
                  <span className="font-semibold text-red-400">
                    {summary.shortfallUnits} unit{summary.shortfallUnits === 1 ? '' : 's'} · £{summary.shortfallCost.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => navigate('/restock/machine')}
          className="h-14 w-full rounded-xl bg-emerald-500 text-base font-semibold text-zinc-900 hover:bg-emerald-400"
        >
          Continue to restock this machine
        </button>
        <button
          onClick={reset}
          className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
        >
          Check another machine
        </button>
      </div>
    );
  }

  // ========== STEP 2: COUNT ==========

  if (locationId) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLocationId(null)}
            aria-label="Back to machine list"
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-zinc-100">{location?.name}</h2>
            <p className="text-xs text-zinc-500">
              Stock check{checkerName.trim() ? ` · ${checkerName.trim()}` : ''}
            </p>
          </div>
        </div>
        <StockCheckForm
          locationId={locationId}
          performedBy={checkerName.trim() || undefined}
          onComplete={setResult}
          onCancel={() => setLocationId(null)}
        />
      </div>
    );
  }

  // ========== STEP 1: WHO + WHERE ==========

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div>
        <h2 className="text-xl font-semibold">Stock Check</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Audit a machine before restocking — confirm or count every product.
        </p>
      </div>

      <div>
        <label htmlFor="checker-name" className="mb-1.5 block text-xs font-medium text-zinc-500">
          Who&rsquo;s checking?
        </label>
        <input
          id="checker-name"
          type="text"
          value={checkerName}
          onChange={e => updateName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className="h-14 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-base text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-500">Pick a machine</label>
          {!nameReady && (
            <span className="text-xs text-amber-400">Enter your name first</span>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={machineSearch}
            onChange={e => setMachineSearch(e.target.value)}
            placeholder="Search machines…"
            className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>

        {machines.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-600">No machines found</p>
        ) : (
          <div className="space-y-2">
            {machines.map(l => {
              const stock = data.locationStock[l.id] || {};
              const productCount = Object.values(stock).filter(q => q > 0).length;
              return (
                <button
                  key={l.id}
                  onClick={() => nameReady && setLocationId(l.id)}
                  disabled={!nameReady}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left transition-colors hover:border-emerald-500/50 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <MapPin className="h-5 w-5 flex-shrink-0 text-emerald-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-zinc-100">{l.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {productCount > 0
                        ? `${productCount} product${productCount === 1 ? '' : 's'} in stock`
                        : 'No stock recorded'}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-zinc-600" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
