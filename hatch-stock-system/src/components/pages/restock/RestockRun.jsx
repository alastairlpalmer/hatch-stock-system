import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Loader2,
  PackagePlus,
  PartyPopper,
  RotateCcw,
  Truck,
} from 'lucide-react';
import { useRestockRun } from '../../../context/RestockRunContext';
import { pickListsService } from '../../../services/pickLists.service';

// Shared with StockCheck / RestockMachine — "who is doing the run".
const NAME_STORAGE_KEY = 'hatch_checker_name';

function formatTargetDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Small status chip: ✓ + time when done, muted label when not. */
function StatusChip({ done, label, time }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
        done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
      }`}
    >
      {done && <Check size={12} strokeWidth={3} />}
      {label}
      {done && time && <span className="text-emerald-500/80">{time}</span>}
    </span>
  );
}

/**
 * Today's run — mission control for the restock route (route: /restock/run).
 * Shows every machine on the packed pick list with its check/restock status,
 * links into the stock-check and restock flows, and reconciles the van at the
 * end of the day (return leftovers to the warehouse).
 */
export default function RestockRun() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activePickListId, setActivePickListId, markStepComplete } = useRestockRun();

  const qpId = searchParams.get('pickListId') || '';

  // Packed pick lists (selector options)
  const [lists, setLists] = useState(null); // null = loading
  const [listsError, setListsError] = useState(null);

  // Run data for the selected list
  const [run, setRun] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState(null);

  // Reconciliation panel state
  const [skuTableOpen, setSkuTableOpen] = useState(false);
  const [returnItems, setReturnItems] = useState(null); // null = editor closed
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState(null);
  const [returnSuccess, setReturnSuccess] = useState(null);

  // ----- load packed lists -----

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await pickListsService.getAll({ status: 'packed', limit: 10 });
        if (cancelled) return;
        const sorted = [...(result || [])].sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0)
        );
        setLists(sorted);
      } catch (err) {
        if (!cancelled) {
          setLists([]);
          setListsError('Could not load pick lists.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ----- selection: ?pickListId= > remembered choice > most recent packed -----

  const selectedId = qpId || activePickListId || (lists && lists[0]?.id) || '';

  useEffect(() => {
    if (selectedId && selectedId !== activePickListId) {
      setActivePickListId(selectedId);
    }
  }, [selectedId, activePickListId, setActivePickListId]);

  const changeList = (id) => {
    setActivePickListId(id);
    if (qpId) {
      // Drop the query param so the dropdown choice wins.
      const next = new URLSearchParams(searchParams);
      next.delete('pickListId');
      setSearchParams(next, { replace: true });
    }
  };

  // ----- fetch run data -----

  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const fetchRun = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    if (!silent) {
      setRunLoading(true);
      setRunError(null);
    }
    try {
      const result = await pickListsService.getRun(id);
      // Ignore stale responses after the selection changed.
      if (selectedIdRef.current !== id) return;
      setRun(result);
      setRunError(null);
    } catch (err) {
      if (selectedIdRef.current !== id) return;
      // Silent refreshes keep showing the last good data on failure.
      if (!silent) {
        setRunError(
          err.response?.status === 404
            ? 'Pick list not found — it may have been deleted.'
            : 'Could not load the run — check your connection and try again.'
        );
      }
    } finally {
      if (selectedIdRef.current === id) setRunLoading(false);
    }
  }, []);

  useEffect(() => {
    setRun(null);
    setReturnItems(null);
    setReturnError(null);
    setReturnSuccess(null);
    if (selectedId) fetchRun(selectedId);
  }, [selectedId, fetchRun]);

  // The restocker bounces between this page, the stock check and the restock
  // wizard — refetch whenever the page becomes visible again.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && selectedIdRef.current) {
        fetchRun(selectedIdRef.current, { silent: true });
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchRun]);

  // Workflow step 3 completes when every machine is checked + restocked.
  useEffect(() => {
    if (run?.allDone) markStepComplete('machine');
  }, [run?.allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- derived -----

  const locations = run?.locations || [];
  const doneCount = locations.filter((l) => l.restock).length;
  const progressPct = locations.length > 0 ? Math.round((doneCount / locations.length) * 100) : 0;
  const reconciliation = run?.reconciliation;
  const remainingRows = (reconciliation?.perSku || []).filter((r) => (r.remaining || 0) > 0);

  // ----- return leftovers -----

  const openReturnEditor = () => {
    setReturnError(null);
    setReturnSuccess(null);
    setReturnItems(
      remainingRows.map((r) => ({
        sku: r.sku,
        name: r.name || r.sku,
        max: r.remaining,
        quantity: String(r.remaining),
      }))
    );
  };

  const updateReturnQty = (sku, raw) => {
    const cleaned = raw.replace(/[^0-9]/g, '').slice(0, 4);
    setReturnItems((prev) => prev.map((i) => (i.sku === sku ? { ...i, quantity: cleaned } : i)));
  };

  const removeReturnRow = (sku) => {
    setReturnItems((prev) => prev.filter((i) => i.sku !== sku));
  };

  const returnableItems = (returnItems || [])
    .map((i) => ({ sku: i.sku, quantity: parseInt(i.quantity, 10) || 0 }))
    .filter((i) => i.quantity > 0);

  const confirmReturn = async () => {
    if (returnBusy || returnableItems.length === 0) return;
    setReturnBusy(true);
    setReturnError(null);
    try {
      const performedBy = localStorage.getItem(NAME_STORAGE_KEY) || undefined;
      const result = await pickListsService.returnLeftovers(selectedId, returnableItems, performedBy);
      const units = returnableItems.reduce((s, i) => s + i.quantity, 0);
      setReturnSuccess(`${units} unit${units === 1 ? '' : 's'} returned to the warehouse.`);
      setReturnItems(null);
      // Use the fresh reconciliation immediately, then refetch the full run
      // (statuses may have moved while we were away).
      if (result?.reconciliation) {
        setRun((prev) => (prev ? { ...prev, reconciliation: result.reconciliation } : prev));
      }
      fetchRun(selectedId, { silent: true });
    } catch (err) {
      const status = err.response?.status;
      setReturnError(
        err.response?.data?.error ||
          (status === 409
            ? 'This pick list is not packed — leftovers can only be returned on a packed list.'
            : status === 400
              ? 'Return rejected — you cannot return more than is left in the van.'
              : 'Failed to return leftovers — please try again.')
      );
    } finally {
      setReturnBusy(false);
    }
  };

  // ----- render -----

  // Still loading the selector options and nothing selected yet
  if (lists === null && !selectedId) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Loading today&rsquo;s run…
      </div>
    );
  }

  // Empty state: nothing packed, nothing selected
  if (!selectedId) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Today&rsquo;s Run</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Check and restock each machine on the route, then reconcile the van.
          </p>
        </div>
        {listsError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {listsError}
          </div>
        )}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
          <Truck className="mx-auto h-10 w-10 text-zinc-600" />
          <p className="mt-3 text-sm font-medium text-zinc-300">
            No packed pick list — pack one first
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            A run starts from a pick list that has been packed at the warehouse.
          </p>
          <Link
            to="/restock/picklists"
            className="mt-5 inline-flex h-12 items-center justify-center rounded-xl bg-emerald-500 px-6 text-sm font-semibold text-zinc-900 hover:bg-emerald-400"
          >
            Go to pick lists
          </Link>
        </div>
      </div>
    );
  }

  const pickList = run?.pickList;
  const selectorOptions = [...(lists || [])];
  if (selectedId && !selectorOptions.some((l) => l.id === selectedId)) {
    // Keep the current selection visible even if it's no longer in the packed top-10.
    selectorOptions.unshift(
      pickList && pickList.id === selectedId
        ? pickList
        : { id: selectedId, routeName: 'Selected pick list', targetDate: null }
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-6">
      {/* Pick list selector */}
      {selectorOptions.length > 0 && (
        <div>
          <label htmlFor="run-picklist" className="mb-1.5 block text-xs font-medium text-zinc-500">
            Pick list for this run
          </label>
          <select
            id="run-picklist"
            value={selectedId}
            onChange={(e) => changeList(e.target.value)}
            className="h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          >
            {selectorOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.routeName || 'Custom locations') +
                  (l.targetDate ? ` — ${formatTargetDate(l.targetDate)}` : '')}
              </option>
            ))}
          </select>
        </div>
      )}

      {runError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          {runError}
          <button
            onClick={() => fetchRun(selectedId)}
            className="ml-3 font-medium text-red-300 underline underline-offset-2 hover:text-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {runLoading && !run && (
        <div className="flex items-center gap-2 py-10 text-sm text-zinc-500">
          <Loader2 size={16} className="animate-spin" /> Loading run…
        </div>
      )}

      {run && (
        <>
          {/* Sticky header: route, date, progress */}
          <div className="sticky top-0 z-20 -mx-4 bg-zinc-950/95 px-4 pb-3 pt-1 backdrop-blur md:mx-0 md:px-0">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold text-zinc-100">
                  {pickList?.routeName || 'Custom locations'}
                </h2>
                <p className="text-sm text-zinc-500">{formatTargetDate(pickList?.targetDate)}</p>
              </div>
              <span className="flex-shrink-0 text-sm font-medium text-zinc-300 tabular-nums">
                {doneCount} of {locations.length} machines done
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* All done banner */}
          {run.allDone && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
              <PartyPopper className="mx-auto h-8 w-8 text-emerald-400" />
              <p className="mt-2 text-base font-semibold text-emerald-400">Route complete!</p>
              <p className="mt-1 text-sm text-zinc-400">
                Every machine has been checked and restocked. Reconcile the van below to finish the
                day.
              </p>
            </div>
          )}

          {/* Machine rows, in route order */}
          <div className="space-y-2">
            {locations.map((loc) => {
              const restocked = !!loc.restock;
              return (
                <div
                  key={loc.locationId}
                  className={`rounded-2xl border px-4 py-3 transition-colors ${
                    restocked
                      ? 'border-emerald-700/30 bg-emerald-700/5 opacity-70'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className={`flex items-center gap-1.5 truncate text-base font-medium ${
                          restocked ? 'text-zinc-400' : 'text-zinc-100'
                        }`}
                      >
                        {restocked && (
                          <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-400" />
                        )}
                        {loc.locationName}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {loc.plannedUnits} unit{loc.plannedUnits === 1 ? '' : 's'} planned
                        {(loc.trimmedUnits || 0) > 0 && (
                          <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400">
                            {loc.trimmedUnits} short — warehouse ran out
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <StatusChip
                        done={!!loc.stockCheck}
                        label="Check"
                        time={formatTime(loc.stockCheck?.createdAt)}
                      />
                      <StatusChip
                        done={restocked}
                        label="Restock"
                        time={formatTime(loc.restock?.createdAt)}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() =>
                        navigate(
                          `/restock/check?locationId=${loc.locationId}&return=${encodeURIComponent('/restock/run')}`
                        )
                      }
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-medium ${
                        loc.stockCheck
                          ? 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                      }`}
                    >
                      <ClipboardCheck size={16} />
                      Check
                    </button>
                    <button
                      onClick={() =>
                        navigate(
                          `/restock/machine?locationId=${loc.locationId}&pickListId=${pickList?.id || selectedId}`
                        )
                      }
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${
                        restocked
                          ? 'border border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
                          : 'bg-emerald-500 text-zinc-900 hover:bg-emerald-400'
                      }`}
                    >
                      <PackagePlus size={16} />
                      Restock
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Van reconciliation */}
          {reconciliation && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
              <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
                <Truck size={18} className="text-emerald-400" />
                <h3 className="text-sm font-semibold text-zinc-200">Van reconciliation</h3>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums">
                  <span className="text-zinc-400">
                    Packed <span className="font-semibold text-zinc-100">{reconciliation.packedUnits}</span>
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">
                    Loaded <span className="font-semibold text-zinc-100">{reconciliation.loadedUnits}</span>
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">
                    Returned <span className="font-semibold text-zinc-100">{reconciliation.returnedUnits}</span>
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">
                    In van{' '}
                    <span
                      className={`font-semibold ${
                        reconciliation.remainingUnits > 0 ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {reconciliation.remainingUnits}
                    </span>
                  </span>
                </div>

                {/* Per-SKU breakdown */}
                {(reconciliation.perSku?.length || 0) > 0 && (
                  <div>
                    <button
                      onClick={() => setSkuTableOpen((v) => !v)}
                      className="flex h-11 w-full items-center justify-between rounded-lg px-1 text-sm text-zinc-400 hover:text-zinc-200"
                    >
                      <span>Per-product breakdown</span>
                      {skuTableOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {/* Mobile: stacked per-product cards (the 5-col table scrolls sideways on a phone) */}
                    {skuTableOpen && (
                      <div className="md:hidden divide-y divide-zinc-800/50">
                        {reconciliation.perSku.map((row) => {
                          const inVan = (row.remaining || 0) > 0;
                          return (
                            <div key={row.sku} className={`py-2.5 tabular-nums ${inVan ? 'text-zinc-100' : 'text-zinc-500'}`}>
                              <div className="flex items-center justify-between gap-3">
                                <span className="min-w-0 truncate text-sm">{row.name || row.sku}</span>
                                <span className={`shrink-0 text-sm font-semibold ${inVan ? 'text-amber-400' : ''}`}>
                                  {row.remaining} in van
                                </span>
                              </div>
                              <div className="mt-0.5 text-xs text-zinc-500">
                                Packed {row.packed} · Loaded {row.loaded} · Returned {row.returned}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {skuTableOpen && (
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                              <th className="py-2 pr-2 text-left font-medium">Product</th>
                              <th className="px-2 py-2 text-right font-medium">Packed</th>
                              <th className="px-2 py-2 text-right font-medium">Loaded</th>
                              <th className="px-2 py-2 text-right font-medium">Returned</th>
                              <th className="py-2 pl-2 text-right font-medium">In van</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliation.perSku.map((row) => {
                              const inVan = (row.remaining || 0) > 0;
                              return (
                                <tr
                                  key={row.sku}
                                  className={`border-b border-zinc-800/50 tabular-nums ${
                                    inVan ? 'text-zinc-100' : 'text-zinc-500'
                                  }`}
                                >
                                  <td className="max-w-[10rem] truncate py-2 pr-2">
                                    {row.name || row.sku}
                                  </td>
                                  <td className="px-2 py-2 text-right">{row.packed}</td>
                                  <td className="px-2 py-2 text-right">{row.loaded}</td>
                                  <td className="px-2 py-2 text-right">{row.returned}</td>
                                  <td
                                    className={`py-2 pl-2 text-right font-semibold ${
                                      inVan ? 'text-amber-400' : ''
                                    }`}
                                  >
                                    {row.remaining}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {returnSuccess && (
                  <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                    <CheckCircle2 size={16} className="flex-shrink-0" />
                    {returnSuccess}
                  </div>
                )}

                {returnError && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                    {returnError}
                  </div>
                )}

                {/* Return leftovers */}
                {returnItems ? (
                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                    <p className="text-sm font-medium text-zinc-200">
                      Return leftovers to warehouse
                    </p>
                    <p className="text-xs text-zinc-500">
                      Adjust the quantities to match what&rsquo;s actually going back on the shelf.
                    </p>
                    {returnItems.length === 0 ? (
                      <p className="py-3 text-center text-sm text-zinc-600">
                        Nothing left to return.
                      </p>
                    ) : (
                      returnItems.map((item) => (
                        <div key={item.sku} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-zinc-200">{item.name}</p>
                            <p className="text-xs text-zinc-500">{item.max} in van</p>
                          </div>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={item.quantity}
                            onChange={(e) => updateReturnQty(item.sku, e.target.value)}
                            aria-label={`Quantity of ${item.name} to return`}
                            className="h-12 w-[4.5rem] flex-shrink-0 rounded-xl border border-zinc-700 bg-zinc-800 text-center text-lg font-semibold text-zinc-100 focus:border-emerald-500 focus:outline-none"
                          />
                          <button
                            onClick={() => removeReturnRow(item.sku)}
                            aria-label={`Remove ${item.name} from the return`}
                            className="flex h-12 w-11 flex-shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={confirmReturn}
                        disabled={returnBusy || returnableItems.length === 0}
                        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-900 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {returnBusy && <Loader2 size={16} className="animate-spin" />}
                        {returnBusy
                          ? 'Returning…'
                          : `Confirm return (${returnableItems.reduce((s, i) => s + i.quantity, 0)} units)`}
                      </button>
                      <button
                        onClick={() => { setReturnItems(null); setReturnError(null); }}
                        disabled={returnBusy}
                        className="h-12 rounded-xl border border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  reconciliation.remainingUnits > 0 && (
                    <button
                      onClick={openReturnEditor}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-semibold text-zinc-200 hover:bg-zinc-700"
                    >
                      <RotateCcw size={16} />
                      Return leftovers to warehouse
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
