import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { useRestockRun } from '../../../context/RestockRunContext';
import { pickListsService } from '../../../services/pickLists.service';
import { StatusChip } from './PickLists';

// ---------- date helpers ----------

function parseDay(iso) {
  if (!iso) return null;
  // Compare on date-only precision regardless of whether the API returns
  // date strings or full ISO timestamps.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDayMonth(iso) {
  const d = parseDay(iso);
  if (!d) return null;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatTargetDate(iso) {
  const d = parseDay(iso);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

// ---------- batch line ----------

function sortedBatches(batches) {
  return [...(batches || [])].sort((a, b) => {
    if (!a.expiryDate && !b.expiryDate) return 0;
    if (!a.expiryDate) return 1; // nulls last
    if (!b.expiryDate) return -1;
    return new Date(a.expiryDate) - new Date(b.expiryDate);
  });
}

function BatchLine({ batches, targetDate, muted }) {
  const target = parseDay(targetDate);
  const sorted = sortedBatches(batches);
  if (sorted.length === 0) return null;
  return (
    <div className={`text-xs mt-1 ${muted ? 'text-zinc-600' : 'text-zinc-400'}`}>
      <span className={muted ? 'text-zinc-600' : 'text-zinc-500'}>Pull: </span>
      {sorted.map((b, i) => {
        const expiry = parseDay(b.expiryDate);
        const expiresBeforeTarget = expiry && target && expiry < target;
        return (
          <span key={b.batchId || i}>
            {i > 0 && <span className="text-zinc-600"> · </span>}
            <span className={expiresBeforeTarget && !muted ? 'text-red-400 font-medium' : ''}>
              {b.qty} ×{' '}
              {b.expiryDate ? `exp ${formatDayMonth(b.expiryDate)}` : 'no expiry recorded'}
              {expiresBeforeTarget && !muted && (
                <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ---------- item row ----------

function ItemRow({ item, targetDate, readOnly, onToggle, onQtyChange }) {
  const [editing, setEditing] = useState(false);
  const ticked = !!item.packed;
  const packedQty = item.packedQty ?? item.totalQty;
  const qtyEdited = packedQty !== item.totalQty;

  return (
    <div
      className={`flex items-start gap-3 px-3 py-3 rounded-lg border transition-colors ${
        ticked
          ? 'border-emerald-700/30 bg-emerald-700/5 opacity-60'
          : 'border-zinc-800 bg-zinc-900/50'
      }`}
    >
      {/* Big tap-target checkbox */}
      <button
        onClick={() => !readOnly && onToggle(item.sku)}
        disabled={readOnly}
        aria-label={ticked ? `Un-tick ${item.name}` : `Tick off ${item.name}`}
        className={`shrink-0 w-11 h-11 rounded-lg border-2 flex items-center justify-center transition-colors ${
          ticked
            ? 'bg-emerald-500 border-emerald-500 text-zinc-900'
            : 'border-zinc-600 text-transparent hover:border-emerald-500'
        } ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <Check size={24} strokeWidth={3} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={`font-medium truncate ${
              ticked ? 'text-zinc-500 line-through' : 'text-zinc-100'
            }`}
          >
            {item.name || item.sku}
          </span>
          <span className="shrink-0 text-right">
            <span
              className={`text-2xl font-bold tabular-nums ${
                ticked ? 'text-zinc-600 line-through' : 'text-zinc-100'
              }`}
            >
              {packedQty}
            </span>
            {qtyEdited && (
              <span className="block text-[10px] text-amber-400 leading-none">of {item.totalQty}</span>
            )}
          </span>
        </div>

        {/* Per-location chips */}
        {(item.perLocation?.length || 0) > 0 && (
          <div className={`text-xs mt-0.5 ${ticked ? 'text-zinc-600' : 'text-zinc-400'}`}>
            {item.perLocation.map((pl, i) => (
              <span key={pl.locationId || i}>
                {i > 0 && <span className="text-zinc-600"> · </span>}
                {pl.locationName} ×{pl.qty}
              </span>
            ))}
          </div>
        )}

        <BatchLine batches={item.batches} targetDate={targetDate} muted={ticked} />

        {/* Qty edit toggle (unticked drafts only) */}
        {!readOnly && !ticked && (
          <div className="mt-2">
            {editing ? (
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">Pack qty</label>
                <input
                  type="number"
                  min="0"
                  value={item.packedQty ?? item.totalQty}
                  onChange={(e) => onQtyChange(item.sku, e.target.value)}
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Done
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300"
              >
                <Pencil size={12} /> Adjust quantity
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- print sheet (portalled to <body> so the app shell can be hidden) ----------

const PRINT_STYLES = `
.pl-print-sheet { display: none; }
@media print {
  #root { display: none !important; }
  body { background: #fff !important; }
  .pl-print-sheet {
    display: block !important;
    color: #000;
    background: #fff;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    padding: 8px 0;
  }
  .pl-print-sheet h1 { font-size: 18px; margin: 0 0 2px; }
  .pl-print-sheet .pl-sub { font-size: 12px; margin: 0 0 12px; color: #000; }
  .pl-print-sheet table { width: 100%; border-collapse: collapse; }
  .pl-print-sheet th, .pl-print-sheet td {
    border-bottom: 1px solid #999;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  .pl-print-sheet th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .pl-print-sheet .pl-box {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid #000; vertical-align: middle;
  }
  .pl-print-sheet .pl-qty { font-size: 16px; font-weight: bold; white-space: nowrap; }
  .pl-print-sheet .pl-small { font-size: 10px; color: #333; }
  .pl-print-sheet .pl-short { margin-top: 12px; font-size: 11px; }
}
@page { margin: 14mm; }
`;

function PrintSheet({ list, warehouseName, items }) {
  return createPortal(
    <div className="pl-print-sheet">
      <style>{PRINT_STYLES}</style>
      <h1>Pick list — {list.routeName || 'Custom locations'}</h1>
      <p className="pl-sub">
        Restock {formatTargetDate(list.targetDate)}
        {warehouseName ? ` · from ${warehouseName}` : ''} · {items.length} products
      </p>
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }}></th>
            <th>Product</th>
            <th style={{ width: 60 }}>Qty</th>
            <th>Locations</th>
            <th>Pull (batch / expiry)</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.sku}>
              <td><span className="pl-box" /></td>
              <td>
                {item.name || item.sku}
                <div className="pl-small">{item.sku}</div>
              </td>
              <td className="pl-qty">{item.packedQty ?? item.totalQty}</td>
              <td className="pl-small">
                {(item.perLocation || [])
                  .map((pl) => `${pl.locationName} ×${pl.qty}`)
                  .join(' · ')}
              </td>
              <td className="pl-small">
                {sortedBatches(item.batches)
                  .map((b) =>
                    b.expiryDate
                      ? `${b.qty} × exp ${formatDayMonth(b.expiryDate)}`
                      : `${b.qty} × no expiry recorded`
                  )
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(list.shortfalls?.length || 0) > 0 && (
        <div className="pl-short">
          <strong>Short on warehouse stock:</strong>{' '}
          {list.shortfalls
            .map((s) => `${s.name || s.sku} (need ${s.requested}, have ${s.available})`)
            .join(' · ')}
        </div>
      )}
    </div>,
    document.body
  );
}

// ---------- main page ----------

export default function PickListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useStock();
  const { markStepComplete } = useRestockRun();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [shortfallsOpen, setShortfallsOpen] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [takenBy, setTakenBy] = useState('');
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);

  const [pendingAction, setPendingAction] = useState(null); // 'delete' | 'cancel' | null
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const persistTimer = useRef(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Fetch (and re-fetch when navigating to a regenerated list).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setList(null);
    setItems([]);
    setConfirmOpen(false);
    setConflict(false);
    setJustCompleted(false);
    setPendingAction(null);
    setCompleteError(null);
    (async () => {
      try {
        const result = await pickListsService.getById(id);
        if (cancelled) return;
        setList(result);
        setItems(
          [...(result.items || [])].sort((a, b) =>
            (a.name || a.sku || '').localeCompare(b.name || b.sku || '')
          )
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err.response?.status === 404 ? 'Pick list not found.' : 'Could not load this pick list.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Clear any pending debounce on unmount.
  useEffect(() => () => clearTimeout(persistTimer.current), []);

  const isDraft = list?.status === 'draft';
  const warehouseName = useMemo(
    () => (data.warehouses || []).find((w) => w.id === list?.warehouseId)?.name || '',
    [data.warehouses, list]
  );

  const packedCount = items.filter((i) => i.packed).length;
  const totalCount = items.length;
  const untickedItems = items.filter((i) => !i.packed);
  const progressPct = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;

  // ----- optimistic tick-off with debounced persistence -----

  const schedulePersist = (nextItems) => {
    clearTimeout(persistTimer.current);
    setSaveState('saving');
    persistTimer.current = setTimeout(async () => {
      try {
        await pickListsService.update(id, { items: nextItems });
        setSaveState('saved');
      } catch (err) {
        setSaveState('error');
      }
    }, 700);
  };

  const applyItems = (updater) => {
    setItems((prev) => {
      const next = prev.map(updater);
      schedulePersist(next);
      return next;
    });
  };

  const toggleItem = (sku) => {
    applyItems((it) =>
      it.sku === sku
        ? { ...it, packed: !it.packed, packedQty: it.packedQty ?? it.totalQty }
        : it
    );
  };

  const changeQty = (sku, value) => {
    const qty = Math.max(0, parseInt(value, 10) || 0);
    applyItems((it) => (it.sku === sku ? { ...it, packedQty: qty } : it));
  };

  // ----- complete flow -----

  const regenerateParams = () => {
    const params = { warehouseId: list.warehouseId, targetDate: list.targetDate };
    if (list.routeId) {
      params.routeId = list.routeId;
    } else {
      const locIds = new Set();
      items.forEach((it) => (it.perLocation || []).forEach((pl) => pl.locationId && locIds.add(pl.locationId)));
      params.locationIds = Array.from(locIds);
    }
    return params;
  };

  const confirmComplete = async () => {
    if (completing) return;
    setCompleting(true);
    setCompleteError(null);
    clearTimeout(persistTimer.current);
    try {
      // Unticked items are excluded: packedQty 0 so complete() skips them.
      const finalItems = itemsRef.current.map((it) =>
        it.packed ? { ...it, packedQty: it.packedQty ?? it.totalQty } : { ...it, packedQty: 0 }
      );
      await pickListsService.update(id, { items: finalItems });
      const result = await pickListsService.complete(id, { takenBy: takenBy.trim() });
      setItems(
        [...((result?.items && result.items.length ? result.items : finalItems))].sort((a, b) =>
          (a.name || a.sku || '').localeCompare(b.name || b.sku || '')
        )
      );
      setList((prev) => ({ ...prev, ...(result && result.id ? result : {}), status: 'packed' }));
      setConfirmOpen(false);
      setJustCompleted(true);
      setSaveState('idle');
      markStepComplete('remove');
    } catch (err) {
      if (err.response?.status === 409) {
        setConflict(true);
        setConfirmOpen(false);
      } else {
        setCompleteError(
          err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to mark as packed.'
        );
      }
    } finally {
      setCompleting(false);
    }
  };

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const created = await pickListsService.generate(regenerateParams());
      navigate(`/restock/picklists/${created.id}`);
    } catch (err) {
      setConflict(false);
      setCompleteError(
        err.response?.data?.error || err.message || 'Failed to regenerate the pick list.'
      );
    } finally {
      setRegenerating(false);
    }
  };

  // ----- draft delete / cancel -----

  const runPendingAction = async () => {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    setActionError(null);
    try {
      if (pendingAction === 'delete') {
        clearTimeout(persistTimer.current);
        await pickListsService.delete(id);
        navigate('/restock/picklists');
        return;
      }
      const result = await pickListsService.update(id, { status: 'cancelled' });
      setList((prev) => ({ ...prev, ...(result && result.id ? result : {}), status: 'cancelled' }));
      setPendingAction(null);
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message ||
          (pendingAction === 'delete' ? 'Failed to delete.' : 'Failed to cancel.')
      );
    } finally {
      setActionBusy(false);
    }
  };

  // ----- render -----

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm py-10">
        <Loader2 size={16} className="animate-spin" /> Loading pick list…
      </div>
    );
  }

  if (loadError || !list) {
    return (
      <div className="space-y-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {loadError || 'Could not load this pick list.'}
        </div>
        <Link to="/restock/picklists" className="inline-flex items-center gap-2 text-sm text-emerald-400 hover:text-emerald-300">
          <ArrowLeft size={16} /> Back to pick lists
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      {/* Header */}
      <div className="space-y-3">
        <Link
          to="/restock/picklists"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
        >
          <ArrowLeft size={15} /> Pick lists
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold text-zinc-100 truncate">
                {list.routeName || 'Custom locations'}
              </h2>
              <StatusChip status={list.status} />
            </div>
            <p className="text-zinc-400 text-sm mt-1">
              Restock {formatTargetDate(list.targetDate)}
              {warehouseName && <span className="text-zinc-500"> · from {warehouseName}</span>}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-600"
            >
              <Printer size={15} /> Print
            </button>
            {isDraft && (
              <>
                <button
                  onClick={() => { setPendingAction('cancel'); setActionError(null); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-600"
                >
                  <Ban size={15} /> Cancel
                </button>
                <button
                  onClick={() => { setPendingAction('delete'); setActionError(null); }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm bg-zinc-800 text-red-400 border border-zinc-700 hover:border-red-500/50"
                >
                  <Trash2 size={15} /> Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Inline delete/cancel confirm */}
        {pendingAction && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-zinc-300 flex-1">
              {pendingAction === 'delete'
                ? 'Delete this draft pick list? This cannot be undone.'
                : 'Cancel this pick list? It will be kept for reference but can no longer be packed.'}
            </p>
            {actionError && <p className="text-sm text-red-400">{actionError}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={runPendingAction}
                disabled={actionBusy}
                className={`px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 ${
                  pendingAction === 'delete'
                    ? 'bg-red-600 text-white hover:bg-red-500'
                    : 'bg-amber-600 text-white hover:bg-amber-500'
                }`}
              >
                {actionBusy ? 'Working…' : pendingAction === 'delete' ? 'Yes, delete' : 'Yes, cancel it'}
              </button>
              <button
                onClick={() => setPendingAction(null)}
                disabled={actionBusy}
                className="px-3 py-1.5 rounded text-sm bg-zinc-800 text-zinc-300 border border-zinc-700"
              >
                Keep it
              </button>
            </div>
          </div>
        )}

        {/* Progress */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-zinc-300 font-medium">
              {packedCount}/{totalCount} packed
            </span>
            <span className="text-xs text-zinc-500">
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Saved'}
              {saveState === 'error' && <span className="text-red-400">Save failed — changes may not persist</span>}
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Success panel */}
      {(justCompleted || (list.status === 'packed' && list.removalId)) && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm">
            <CheckCircle2 size={18} />
            Removal recorded — warehouse stock updated
          </div>
          <p className="text-zinc-400 text-xs mt-1">
            {packedCount} of {totalCount} products packed for {formatTargetDate(list.targetDate)}.
          </p>
          <div className="mt-3 flex items-center gap-4">
            <Link to="/restock/picklists" className="text-sm text-emerald-400 hover:text-emerald-300">
              ← Back to pick lists
            </Link>
            <Link to="/restock" className="text-sm text-zinc-400 hover:text-zinc-200">
              Go to workflow →
            </Link>
          </div>
        </div>
      )}

      {/* 409 conflict banner */}
      {conflict && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-400 font-medium text-sm">
            <AlertTriangle size={16} />
            Warehouse stock has changed since this list was generated
          </div>
          <p className="text-zinc-400 text-xs mt-1">
            The warehouse can no longer cover this list. Regenerate it against current stock — a new
            pick list will be created with the same route, warehouse and date.
          </p>
          <button
            onClick={regenerate}
            disabled={regenerating}
            className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium bg-emerald-500 text-zinc-900 hover:bg-emerald-400 disabled:opacity-50"
          >
            {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {regenerating ? 'Regenerating…' : 'Regenerate pick list'}
          </button>
        </div>
      )}

      {/* Shortfall banner */}
      {(list.shortfalls?.length || 0) > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <button
            onClick={() => setShortfallsOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-4 text-left"
          >
            <span className="flex items-center gap-2 text-amber-400 text-sm font-medium">
              <AlertTriangle size={16} className="shrink-0" />
              Not enough warehouse stock for {list.shortfalls.length}{' '}
              {list.shortfalls.length === 1 ? 'product' : 'products'}
            </span>
            {shortfallsOpen ? (
              <ChevronUp size={16} className="text-amber-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-amber-400 shrink-0" />
            )}
          </button>
          {shortfallsOpen && (
            <div className="px-4 pb-4 space-y-1">
              {list.shortfalls.map((s) => (
                <div key={s.sku} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">{s.name || s.sku}</span>
                  <span className="text-zinc-400 tabular-nums">
                    requested <span className="text-amber-400 font-medium">{s.requested}</span> ·
                    available <span className="text-amber-400 font-medium">{s.available}</span>
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-zinc-500 pt-1">
                Quantities below are capped at what the warehouse can supply.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Item list */}
      {totalCount === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500 text-sm">
          Nothing to pack — every location on this run is already at target stock.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <ItemRow
              key={item.sku}
              item={item}
              targetDate={list.targetDate}
              readOnly={!isDraft}
              onToggle={toggleItem}
              onQtyChange={changeQty}
            />
          ))}
        </div>
      )}

      {/* Sticky bottom bar (draft only) */}
      {isDraft && totalCount > 0 && !conflict && (
        <div className="sticky bottom-0 z-10 -mx-4 md:mx-0 print:hidden">
          <div className="bg-zinc-950/95 backdrop-blur border-t md:border md:rounded-lg border-zinc-800 px-4 py-3 space-y-3">
            {confirmOpen ? (
              <div className="space-y-3">
                <div className="text-sm text-zinc-200 font-medium">
                  Mark this list as packed?
                </div>
                {untickedItems.length > 0 ? (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-xs text-zinc-300">
                    <span className="text-amber-400 font-medium">
                      {untickedItems.length} unticked{' '}
                      {untickedItems.length === 1 ? 'item' : 'items'} will be excluded
                    </span>{' '}
                    — their packed quantity is set to 0 and no warehouse stock is removed for them:
                    <div className="mt-1 text-zinc-400">
                      {untickedItems.map((i) => i.name || i.sku).join(' · ')}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">
                    All {totalCount} items are ticked. Warehouse stock will be removed for the full
                    list.
                  </p>
                )}
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Packed by</label>
                  <input
                    type="text"
                    value={takenBy}
                    onChange={(e) => setTakenBy(e.target.value)}
                    placeholder="Your name"
                    className="w-full sm:w-64 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {completeError && (
                  <div className="text-xs text-red-400">{completeError}</div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={confirmComplete}
                    disabled={completing || !takenBy.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {completing && <Loader2 size={14} className="animate-spin" />}
                    {completing ? 'Recording…' : 'Confirm — record removal'}
                  </button>
                  <button
                    onClick={() => { setConfirmOpen(false); setCompleteError(null); }}
                    disabled={completing}
                    className="px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-300 border border-zinc-700"
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-200 font-medium tabular-nums">
                    {packedCount}/{totalCount} packed
                  </div>
                  <div className="h-1.5 w-28 sm:w-40 bg-zinc-800 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={packedCount === 0}
                  className="shrink-0 px-5 py-2.5 bg-emerald-500 text-zinc-900 rounded-lg text-sm font-semibold hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Mark packed
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <PrintSheet list={list} warehouseName={warehouseName} items={items} />
    </div>
  );
}
