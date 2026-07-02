import React, { useMemo, useState } from 'react';
import { Check, Search, Plus, ArrowLeft, Loader2, PackageSearch, ClipboardCheck } from 'lucide-react';
import { useStock } from '../../../context/StockContext';

/**
 * Mobile-first stock-check form used at the machine.
 *
 * For each product the restocker either taps the big tick ("count is correct —
 * I found exactly what the system expected") or types the number actually
 * found. Submission goes through the API contract: confirmed rows are sent as
 * { sku, confirmed: true }, counted rows as { sku, counted } — the server
 * computes expected and variance from live stock.
 *
 * Props: { locationId, performedBy?, onComplete(check), onCancel? }
 */
export default function StockCheckForm({ locationId, performedBy, onComplete, onCancel }) {
  const { data, submitStockCheck } = useStock();

  // { [sku]: { confirmed: bool, counted: string } }
  const [entries, setEntries] = useState({});
  // Unexpected items added from the catalogue search
  const [extraSkus, setExtraSkus] = useState([]);
  const [search, setSearch] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const locationStock = data.locationStock[locationId] || {};
  const location = data.locations.find(l => l.id === locationId);

  const productsBySku = useMemo(() => {
    const map = {};
    data.products.forEach(p => { map[p.sku] = p; });
    return map;
  }, [data.products]);

  // ITEM SCOPE: union of SKUs with current stock > 0 and the location's
  // assigned items, plus any extras the user added from the catalogue.
  const rows = useMemo(() => {
    const skus = new Set();
    Object.entries(locationStock).forEach(([sku, qty]) => {
      if (qty > 0) skus.add(sku);
    });
    (location?.assignedItems || []).forEach(sku => skus.add(sku));
    extraSkus.forEach(sku => skus.add(sku));

    return [...skus]
      .map(sku => {
        const product = productsBySku[sku];
        return {
          sku,
          name: product?.name || sku,
          unitCost: product?.unitCost || 0,
          expected: locationStock[sku] || 0,
          isExtra: extraSkus.includes(sku),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [locationStock, location, extraSkus, productsBySku]);

  const scopeSkus = useMemo(() => new Set(rows.map(r => r.sku)), [rows]);

  const query = search.trim().toLowerCase();
  const filteredRows = useMemo(() => {
    if (!query) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(query) || r.sku.toLowerCase().includes(query)
    );
  }, [rows, query]);

  // When the search finds nothing in scope, offer whole-catalogue matches so
  // an unexpected item can be added as an extra row.
  const catalogueMatches = useMemo(() => {
    if (!query || filteredRows.length > 0) return [];
    return data.products
      .filter(p =>
        !scopeSkus.has(p.sku) &&
        (p.name?.toLowerCase().includes(query) || p.sku?.toLowerCase().includes(query))
      )
      .slice(0, 8);
  }, [query, filteredRows.length, data.products, scopeSkus]);

  const getEntry = (sku) => entries[sku] || { confirmed: false, counted: '' };
  const isAddressed = (sku) => {
    const e = getEntry(sku);
    return e.confirmed || e.counted !== '';
  };

  const addressedCount = rows.filter(r => isAddressed(r.sku)).length;
  const remainingCount = rows.length - addressedCount;
  const allAddressed = rows.length > 0 && remainingCount === 0;
  const progressPct = rows.length > 0 ? Math.round((addressedCount / rows.length) * 100) : 0;

  const toggleConfirm = (sku) => {
    setEntries(prev => {
      const cur = prev[sku] || { confirmed: false, counted: '' };
      return { ...prev, [sku]: cur.confirmed
        ? { confirmed: false, counted: '' }
        : { confirmed: true, counted: '' } };
    });
  };

  const setCounted = (sku, raw) => {
    const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 4);
    setEntries(prev => ({ ...prev, [sku]: { confirmed: false, counted: cleaned } }));
  };

  const confirmRemaining = () => {
    setEntries(prev => {
      const next = { ...prev };
      rows.forEach(r => {
        const e = next[r.sku] || { confirmed: false, counted: '' };
        if (!e.confirmed && e.counted === '') {
          next[r.sku] = { confirmed: true, counted: '' };
        }
      });
      return next;
    });
  };

  const addExtraRow = (sku) => {
    setExtraSkus(prev => (prev.includes(sku) ? prev : [...prev, sku]));
    setSearch('');
  };

  // Resolved result lines (used by the review panel)
  const resultLines = useMemo(() => rows.map(row => {
    const e = getEntry(row.sku);
    const counted = e.confirmed ? row.expected : (e.counted === '' ? null : parseInt(e.counted, 10));
    const variance = counted === null ? null : counted - row.expected;
    return { ...row, confirmed: e.confirmed, counted, variance };
  }), [rows, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  const discrepancies = resultLines.filter(l => l.variance !== null && l.variance !== 0);
  const correctCount = resultLines.filter(l => l.variance === 0).length;
  const shortfallUnits = discrepancies.reduce((s, l) => s + (l.variance < 0 ? -l.variance : 0), 0);
  const shortfallCost = discrepancies.reduce(
    (s, l) => s + (l.variance < 0 ? -l.variance * l.unitCost : 0), 0
  );

  const handleSubmit = async () => {
    if (!allAddressed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const items = rows.map(row => {
        const e = getEntry(row.sku);
        return e.confirmed
          ? { sku: row.sku, confirmed: true }
          : { sku: row.sku, counted: parseInt(e.counted, 10) };
      });
      const check = await submitStockCheck({
        locationId,
        ...(performedBy ? { performedBy } : {}),
        items,
      });
      onComplete?.(check);
    } catch (err) {
      setSubmitError(err.message || 'Failed to submit the stock check — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const deltaChip = (variance) => (
    <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
      variance < 0 ? 'bg-red-500/15 text-red-400' : 'bg-sky-500/15 text-sky-400'
    }`}>
      {variance > 0 ? '+' : ''}{variance}
    </span>
  );

  // ========== REVIEW STEP ==========

  if (reviewing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReviewing(false)}
            className="flex h-11 min-w-[44px] items-center gap-1 rounded-lg px-2 text-sm text-zinc-400 hover:text-zinc-200"
          >
            <ArrowLeft className="h-5 w-5" />
            Back
          </button>
          <h3 className="font-medium text-zinc-200">Review stock check</h3>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-2 text-emerald-400">
            <ClipboardCheck className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-medium">{correctCount} confirmed correct</span>
          </div>
        </div>

        {discrepancies.length === 0 ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
            No discrepancies — everything matches what the system expected.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-zinc-400">
              {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'}
            </p>
            {discrepancies.map(line => (
              <div key={line.sku} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-100">{line.name}</p>
                  <p className="text-xs text-zinc-500">
                    Found <span className="font-semibold text-zinc-300">{line.counted}</span>
                    {' · '}Expected <span className="font-semibold text-zinc-300">{line.expected}</span>
                  </p>
                </div>
                {deltaChip(line.variance)}
                <span className={`w-16 flex-shrink-0 text-right text-sm font-medium ${
                  line.variance < 0 ? 'text-red-400' : 'text-sky-400'
                }`}>
                  {line.variance < 0 ? '−' : '+'}£{(Math.abs(line.variance) * line.unitCost).toFixed(2)}
                </span>
              </div>
            ))}
            {shortfallUnits > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
                <span className="text-red-300">Total shortfall</span>
                <span className="font-semibold text-red-400">
                  {shortfallUnits} unit{shortfallUnits === 1 ? '' : 's'} · £{shortfallCost.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {submitError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
            {submitError}
          </div>
        )}

        <div className="sticky bottom-0 z-20 border-t border-zinc-800 bg-zinc-950/95 pb-1 pt-3 backdrop-blur">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 text-base font-semibold text-zinc-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
            {submitting ? 'Submitting…' : 'Submit stock check'}
          </button>
        </div>
      </div>
    );
  }

  // ========== COUNTING STEP ==========

  return (
    <div className="space-y-3">
      {/* Sticky top: progress + search */}
      <div className="sticky top-0 z-20 space-y-2 bg-zinc-950/95 pb-2 pt-1 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-zinc-300">
            {addressedCount} of {rows.length} checked
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex h-11 items-center rounded-lg px-3 text-sm text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          )}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search products…"
            className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 pl-10 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Empty scope */}
      {rows.length === 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 text-center">
          <PackageSearch className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-3 text-sm text-zinc-300">
            Nothing is expected in this machine yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Search the catalogue above to add what you find on the shelves.
          </p>
        </div>
      )}

      {/* Product rows */}
      <div className="space-y-2">
        {filteredRows.map(row => {
          const entry = getEntry(row.sku);
          const addressed = isAddressed(row.sku);
          const counted = entry.counted === '' ? null : parseInt(entry.counted, 10);
          const variance = counted === null ? null : counted - row.expected;
          return (
            <div
              key={row.sku}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors ${
                addressed
                  ? 'border-zinc-800/70 bg-zinc-900/30'
                  : 'border-zinc-700 bg-zinc-900/80'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-medium ${addressed ? 'text-zinc-500' : 'text-zinc-100'}`}>
                  {row.name}
                </p>
                <p className="text-xs text-zinc-500">
                  Expect{' '}
                  <span className={`text-lg font-bold ${addressed ? 'text-zinc-500' : 'text-zinc-200'}`}>
                    {row.expected}
                  </span>
                  {row.isExtra && (
                    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                      Unexpected
                    </span>
                  )}
                </p>
              </div>

              {variance !== null && variance !== 0 && deltaChip(variance)}

              <button
                onClick={() => toggleConfirm(row.sku)}
                aria-label={entry.confirmed ? `Un-confirm ${row.name}` : `Confirm ${row.name} count is correct`}
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border transition-colors ${
                  entry.confirmed
                    ? 'border-emerald-500 bg-emerald-500 text-zinc-900'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-500 active:bg-zinc-700'
                }`}
              >
                <Check className="h-6 w-6" strokeWidth={3} />
              </button>

              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={entry.counted}
                onChange={e => setCounted(row.sku, e.target.value)}
                placeholder="Found"
                aria-label={`Quantity found for ${row.name}`}
                className={`h-12 w-[4.5rem] flex-shrink-0 rounded-xl border bg-zinc-800 text-center text-lg font-semibold text-zinc-100 placeholder:text-xs placeholder:font-normal placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none ${
                  entry.counted !== '' ? 'border-emerald-500/60' : 'border-zinc-700'
                }`}
              />
            </div>
          );
        })}
      </div>

      {/* No scope match: whole-catalogue search results */}
      {catalogueMatches.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Not expected here — add from the catalogue:
          </p>
          {catalogueMatches.map(p => (
            <button
              key={p.sku}
              onClick={() => addExtraRow(p.sku)}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 px-3 py-2.5 text-left hover:border-emerald-500/50"
            >
              <Plus className="h-5 w-5 flex-shrink-0 text-emerald-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-zinc-200">{p.name}</span>
                <span className="block text-xs text-zinc-500">{p.sku}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {query && filteredRows.length === 0 && catalogueMatches.length === 0 && rows.length > 0 && (
        <p className="py-4 text-center text-sm text-zinc-600">
          No products match &ldquo;{search.trim()}&rdquo;
        </p>
      )}

      {/* Sticky bottom bar */}
      {rows.length > 0 && (
        <div className="sticky bottom-0 z-20 space-y-2 border-t border-zinc-800 bg-zinc-950/95 pb-1 pt-3 backdrop-blur">
          {remainingCount > 0 && (
            <button
              onClick={confirmRemaining}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
            >
              <Check className="h-4 w-4" />
              Confirm remaining as correct ({remainingCount})
            </button>
          )}
          <button
            onClick={() => { setSubmitError(null); setReviewing(true); }}
            disabled={!allAddressed}
            className="h-14 w-full rounded-xl bg-emerald-500 text-base font-semibold text-zinc-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
          >
            Review
          </button>
        </div>
      )}
    </div>
  );
}
