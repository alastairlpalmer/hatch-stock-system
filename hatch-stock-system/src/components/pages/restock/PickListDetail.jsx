import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Loader2,
  PackagePlus,
  PartyPopper,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Truck,
} from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { pickListsService } from '../../../services/pickLists.service';
import { StatusChip } from './PickLists';
import QtyInput from '../../ui/QtyInput';

// Same key the stock-check page uses — one shared "who is doing the run" name
// across the whole Monday workflow, typed once per device.
const NAME_STORAGE_KEY = 'hatch_checker_name';
// The list the driver is mid-run on, so the Pick List index can offer
// "continue run" after a reload or a bounce through Stock Check.
const ACTIVE_LIST_KEY = 'hatch_active_picklist';

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

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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

// A batch needs flagging when the server marked it `expiresBeforeNextRestock`
// or (fallback) its expiry lands before the list's target date. Red when the
// expiry is already here or within 7 days, amber otherwise.
function batchExpiryFlag(batch, target) {
  const expiry = parseDay(batch.expiryDate);
  const flagged =
    !!batch.expiresBeforeNextRestock || (expiry && target && expiry < target);
  if (!flagged) return null;
  if (!expiry) return { severe: true };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntil = Math.round((expiry - today) / 86400000);
  return { severe: daysUntil <= 7 };
}

function BatchLine({ batches, targetDate, muted }) {
  const target = parseDay(targetDate);
  const sorted = sortedBatches(batches);
  if (sorted.length === 0) return null;
  return (
    <div className={`text-xs mt-1 ${muted ? 'text-zinc-600' : 'text-zinc-400'}`}>
      <span className={muted ? 'text-zinc-600' : 'text-zinc-500'}>Pull: </span>
      {sorted.map((b, i) => {
        const flag = batchExpiryFlag(b, target);
        return (
          <span key={b.batchId || i}>
            {i > 0 && <span className="text-zinc-600"> · </span>}
            <span
              className={
                flag && !muted
                  ? `font-medium ${flag.severe ? 'text-red-400' : 'text-amber-400'}`
                  : ''
              }
              title={flag ? 'expires before next restock' : undefined}
            >
              {b.qty} ×{' '}
              {b.expiryDate ? `exp ${formatDayMonth(b.expiryDate)}` : 'no expiry recorded'}
              {flag && !muted && (
                <AlertTriangle size={11} className="inline ml-1 -mt-0.5" />
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// ---------- item row (packing aid) ----------

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

        {/* Per-location chips — trimmed stops flagged so a short machine is
            visible here, not just discovered at the machine door */}
        {(item.perLocation?.length || 0) > 0 && (
          <div className={`text-xs mt-0.5 ${ticked ? 'text-zinc-600' : 'text-zinc-400'}`}>
            {item.perLocation.map((pl, i) => (
              <span key={pl.locationId || i}>
                {i > 0 && <span className="text-zinc-600"> · </span>}
                {pl.locationName} ×{pl.qty}
                {(pl.trimmed || 0) > 0 && (
                  <span className="text-amber-400"> (−{pl.trimmed} short)</span>
                )}
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
                <QtyInput
                  value={item.packedQty ?? item.totalQty}
                  onChange={(n) => onQtyChange(item.sku, n)}
                  className="w-36"
                  aria-label={`Pack quantity — ${item.name || item.sku}`}
                />
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-emerald-400 hover:text-emerald-300 min-h-[40px] px-3 rounded border border-emerald-500/30 bg-emerald-500/10"
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

// ---------- run status chip ----------

function RunChip({ done, label, time }) {
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
                  .map((b) => {
                    const base = b.expiryDate
                      ? `${b.qty} × exp ${formatDayMonth(b.expiryDate)}`
                      : `${b.qty} × no expiry recorded`;
                    return batchExpiryFlag(b, parseDay(list.targetDate))
                      ? `${base} (EXPIRES SOON)`
                      : base;
                  })
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
            .map((s) => s.atConfirm
              ? `${s.name || s.sku} (need ${s.requested}, loaded ${s.loaded}${s.locationName ? ` at ${s.locationName}` : ''})`
              : `${s.name || s.sku} (need ${s.requested}, have ${s.available})`)
            .join(' · ')}
        </div>
      )}
    </div>,
    document.body
  );
}

// ---------- main page ----------

/**
 * One pick list, end to end: pack the bags at the warehouse (tick-off list
 * with FEFO pull lines), then run the route — per machine, a bagging list and
 * a "Confirm loaded" button. Confirming is the single stock-moving action: it
 * takes the stop's quantities out of warehouse batches AND adds them to the
 * machine's stock. Stops never confirmed simply never left the warehouse.
 * Legacy `packed` lists (warehouse drained at pack time) keep the old van
 * reconciliation and return-leftovers flow.
 */
export default function PickListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useStock();

  const [run, setRun] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [shortfallsOpen, setShortfallsOpen] = useState(false);
  const [notOnPlanogramOpen, setNotOnPlanogramOpen] = useState(false);
  const [expiryWarningsOpen, setExpiryWarningsOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(true);

  const [conflict, setConflict] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState(null);

  const [pendingAction, setPendingAction] = useState(null); // 'delete' | 'cancel' | null
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Confirm-loaded panel (one machine open at a time)
  const [openLocId, setOpenLocId] = useState(null);
  const [confirmRows, setConfirmRows] = useState([]);
  const [confirmPhoto, setConfirmPhoto] = useState(null);
  const [confirmName, setConfirmName] = useState(() => {
    try { return localStorage.getItem(NAME_STORAGE_KEY) || ''; } catch { return ''; }
  });
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState(null);
  // Lines where the confirm had to pull from different lots than the plan
  // shown to the packer (stock moved since generation).
  const [deviations, setDeviations] = useState(null);
  // Confirm-time shortfalls: the server loaded what was available and reports
  // what it couldn't cover ([{ sku, name, requested, loaded }]).
  const [confirmShortfalls, setConfirmShortfalls] = useState(null);

  const [finishBusy, setFinishBusy] = useState(false);
  const [finishError, setFinishError] = useState(null);

  // Legacy van reconciliation (packed lists only)
  const [skuTableOpen, setSkuTableOpen] = useState(false);
  const [returnItems, setReturnItems] = useState(null); // null = editor closed
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState(null);
  const [returnSuccess, setReturnSuccess] = useState(null);

  const persistTimer = useRef(null);
  const retryTimer = useRef(null);
  const pendingItemsRef = useRef(null); // unsaved items payload awaiting persist
  const persistNowRef = useRef(null);   // latest persistNow, callable from unmount
  const idRef = useRef(id);
  useEffect(() => { idRef.current = id; }, [id]);

  // ----- fetch -----

  const fetchRun = useCallback(async (listId, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      const result = await pickListsService.getRun(listId);
      if (idRef.current !== listId) return; // stale response after navigation
      setRun(result);
      // Don't clobber unsaved local tick-offs with a background refresh.
      if (!silent || !pendingItemsRef.current) {
        setItems(
          [...(result.pickList?.items || [])].sort((a, b) =>
            (a.name || a.sku || '').localeCompare(b.name || b.sku || '')
          )
        );
      }
    } catch (err) {
      if (idRef.current !== listId) return;
      if (!silent) {
        setLoadError(
          err.response?.status === 404 ? 'Pick list not found.' : 'Could not load this pick list.'
        );
      }
    } finally {
      if (idRef.current === listId && !silent) setLoading(false);
    }
  }, []);

  // Fetch (and re-fetch when navigating to a regenerated list).
  useEffect(() => {
    setRun(null);
    setItems([]);
    setConflict(false);
    setPendingAction(null);
    setOpenLocId(null);
    setDeviations(null);
    setReturnItems(null);
    setReturnError(null);
    setReturnSuccess(null);
    fetchRun(id);
  }, [id, fetchRun]);

  // The driver bounces to Stock Check and back — refetch whenever the page
  // becomes visible again so chips reflect what just happened.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && idRef.current) {
        fetchRun(idRef.current, { silent: true });
      }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [fetchRun]);

  // Flush any pending tick-off save on unmount or when the tab is hidden —
  // ticks made in the last 700ms before navigating away must not be lost.
  useEffect(() => {
    const flush = () => { persistNowRef.current?.(); };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      clearTimeout(persistTimer.current);
      clearTimeout(retryTimer.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = run?.pickList;
  const status = list?.status;
  const isDraft = status === 'draft';
  const isInProgress = status === 'in_progress';
  const isLegacyPacked = status === 'packed';
  const isCompleted = status === 'completed';
  const runActive = isDraft || isInProgress || isLegacyPacked;

  // Remember the list the driver is working through, so the index page can
  // offer "continue run" (replaces the old RestockRunContext).
  useEffect(() => {
    if (!status) return;
    try {
      if (isDraft || isInProgress) localStorage.setItem(ACTIVE_LIST_KEY, id);
      else if (localStorage.getItem(ACTIVE_LIST_KEY) === id) localStorage.removeItem(ACTIVE_LIST_KEY);
    } catch { /* private mode */ }
  }, [id, status, isDraft, isInProgress]);

  const warehouseName = useMemo(
    () => (data.warehouses || []).find((w) => w.id === list?.warehouseId)?.name || '',
    [data.warehouses, list]
  );

  const packedCount = items.filter((i) => i.packed).length;
  const totalCount = items.length;
  const packProgressPct = totalCount > 0 ? Math.round((packedCount / totalCount) * 100) : 0;

  const locations = run?.locations || [];
  const isLoaded = (loc) => !!loc.confirmation || (isLegacyPacked && !!loc.restock);
  const loadedCount = locations.filter(isLoaded).length;
  const runProgressPct = locations.length > 0 ? Math.round((loadedCount / locations.length) * 100) : 0;

  const reconciliation = run?.reconciliation;
  const remainingRows = (reconciliation?.perSku || []).filter((r) => (r.remaining || 0) > 0);
  const expiryWarnings = run?.expiryWarnings || [];

  // ----- optimistic tick-off with debounced persistence -----
  // Pending payload lives in a ref so it can be flushed from unmount/pagehide;
  // a failed save keeps the payload and retries once after a short pause
  // (further edits re-arm the debounce and supersede it).

  const persistNow = async () => {
    const pending = pendingItemsRef.current;
    if (!pending) return;
    pendingItemsRef.current = null;
    clearTimeout(persistTimer.current);
    clearTimeout(retryTimer.current);
    try {
      await pickListsService.update(id, { items: pending });
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      // Keep the payload unless a newer edit already replaced it.
      if (!pendingItemsRef.current) pendingItemsRef.current = pending;
      retryTimer.current = setTimeout(() => persistNowRef.current?.(), 4000);
    }
  };
  persistNowRef.current = persistNow;

  const schedulePersist = (nextItems) => {
    pendingItemsRef.current = nextItems;
    clearTimeout(persistTimer.current);
    clearTimeout(retryTimer.current);
    setSaveState('saving');
    persistTimer.current = setTimeout(() => persistNowRef.current?.(), 700);
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

  // ----- regenerate (after a 409 stock-changed conflict) -----

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

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const created = await pickListsService.generate(regenerateParams());
      navigate(`/restock/picklists/${created.id}`);
    } catch (err) {
      setConflict(false);
      setRegenerateError(
        err.response?.data?.error || err.message || 'Failed to regenerate the pick list.'
      );
    } finally {
      setRegenerating(false);
    }
  };

  // ----- confirm loaded -----

  const openConfirmPanel = (loc) => {
    setOpenLocId(loc.locationId);
    setConfirmError(null);
    setConfirmPhoto(null);
    setConfirmRows(
      (loc.planned || [])
        .filter((p) => (p.qty || 0) > 0)
        .map((p) => ({ sku: p.sku, name: p.name, planned: p.qty, quantity: p.qty }))
    );
  };

  const updateConfirmQty = (sku, value) => {
    const qty = Math.max(0, parseInt(value, 10) || 0);
    setConfirmRows((prev) =>
      prev.map((r) => (r.sku === sku ? { ...r, quantity: Math.min(qty, r.planned) } : r))
    );
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setConfirmPhoto(ev.target?.result || null);
    reader.readAsDataURL(file);
  };

  const confirmLoaded = async (loc) => {
    if (confirmBusy) return;
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const anyAdjusted = confirmRows.some((r) => r.quantity !== r.planned);
      const result = await pickListsService.confirmLocation(id, {
        locationId: loc.locationId,
        performedBy: confirmName.trim() || null,
        photoUrl: confirmPhoto || null,
        ...(anyAdjusted
          ? { adjustedItems: confirmRows.map((r) => ({ sku: r.sku, quantity: r.quantity })) }
          : {}),
      });
      setDeviations(Array.isArray(result?.deviations) ? result.deviations : null);
      setConfirmShortfalls(Array.isArray(result?.shortfalls) ? result.shortfalls : null);
      setOpenLocId(null);
      fetchRun(id, { silent: true });
    } catch (err) {
      const statusCode = err.response?.status;
      if (statusCode === 409 && err.response?.data?.shortfalls) {
        // Warehouse can no longer cover this stop — regenerate flow.
        setConflict(true);
        setOpenLocId(null);
      } else if (statusCode === 409) {
        // Already confirmed (second device / double tap) — just refresh.
        setOpenLocId(null);
        fetchRun(id, { silent: true });
      } else {
        setConfirmError(
          err.response?.data?.error || err.message || 'Failed to confirm this machine.'
        );
      }
    } finally {
      setConfirmBusy(false);
    }
  };

  // ----- finish run (skip remaining stops) -----

  const finishRun = async () => {
    if (finishBusy) return;
    setFinishBusy(true);
    setFinishError(null);
    try {
      await pickListsService.update(id, { status: 'completed' });
      fetchRun(id, { silent: true });
    } catch (err) {
      setFinishError(err.response?.data?.error || err.message || 'Failed to finish the run.');
    } finally {
      setFinishBusy(false);
    }
  };

  // ----- legacy return leftovers (packed lists only) -----

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
      const performedBy = confirmName.trim() || undefined;
      const result = await pickListsService.returnLeftovers(id, returnableItems, performedBy);
      const units = returnableItems.reduce((s, i) => s + i.quantity, 0);
      setReturnSuccess(`${units} unit${units === 1 ? '' : 's'} returned to the warehouse.`);
      setReturnItems(null);
      if (result?.reconciliation) {
        setRun((prev) => (prev ? { ...prev, reconciliation: result.reconciliation } : prev));
      }
      fetchRun(id, { silent: true });
    } catch (err) {
      const statusCode = err.response?.status;
      setReturnError(
        err.response?.data?.error ||
          (statusCode === 400
            ? 'Return rejected — you cannot return more than is left in the van.'
            : 'Failed to return leftovers — please try again.')
      );
    } finally {
      setReturnBusy(false);
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
      await pickListsService.update(id, { status: 'cancelled' });
      setPendingAction(null);
      fetchRun(id, { silent: true });
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
            {(isDraft || isInProgress) && (
              <button
                onClick={() => { setPendingAction('cancel'); setActionError(null); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-400 border border-zinc-700 hover:text-zinc-200 hover:border-zinc-600"
              >
                <Ban size={15} /> Cancel
              </button>
            )}
            {isDraft && (
              <button
                onClick={() => { setPendingAction('delete'); setActionError(null); }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded text-sm bg-zinc-800 text-red-400 border border-zinc-700 hover:border-red-500/50"
              >
                <Trash2 size={15} /> Delete
              </button>
            )}
          </div>
        </div>

        {/* Inline delete/cancel confirm */}
        {pendingAction && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-zinc-300 flex-1">
              {pendingAction === 'delete'
                ? 'Delete this draft pick list? This cannot be undone.'
                : isInProgress
                  ? 'Cancel this run? Machines already confirmed keep their stock — unconfirmed stops never left the warehouse.'
                  : 'Cancel this pick list? It will be kept for reference but can no longer be run.'}
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
      </div>

      {/* Run complete banner */}
      {(isCompleted || run?.allDone) && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-5 text-center">
          <PartyPopper className="mx-auto h-8 w-8 text-emerald-400" />
          <p className="mt-2 text-base font-semibold text-emerald-400">Run complete!</p>
          <p className="mt-1 text-sm text-zinc-400">
            {loadedCount} of {locations.length} machines loaded.
            {loadedCount < locations.length &&
              ' Stock for the skipped stops never left the warehouse.'}
          </p>
        </div>
      )}

      {/* Deviations from the last confirm — lots differed from the pull lines */}
      {deviations && deviations.length > 0 && (
        <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-3">
          Stock moved since this list was generated — some units were booked out from
          different date-lots than the pull lines showed:{' '}
          {deviations.map((d, i) => (
            <span key={d.sku}>
              {i > 0 && ', '}
              {d.name || d.sku} ({d.offPlanQty} unit{d.offPlanQty === 1 ? '' : 's'})
            </span>
          ))}
          . Double-check the expiry flags on what you actually pulled.
        </div>
      )}

      {/* Partial load from the last confirm — warehouse couldn't cover it all */}
      {confirmShortfalls && confirmShortfalls.length > 0 && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
          Warehouse stock couldn't cover this stop in full — the machine was
          confirmed with what was available:{' '}
          {confirmShortfalls.map((s, i) => (
            <span key={s.sku}>
              {i > 0 && ', '}
              {s.name || s.sku} ({s.loaded}/{s.requested} loaded)
            </span>
          ))}
          . The gap is journaled on the pick list's shortfall report.
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
      {regenerateError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm text-red-400">
          {regenerateError}
        </div>
      )}

      {/* Expiry warnings — stock on this list that expires before the next restock */}
      {expiryWarnings.length > 0 && (() => {
        const totalUnits = expiryWarnings.reduce((sum, w) => sum + (w.qty || 0), 0);
        return (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <button
              onClick={() => setExpiryWarningsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 p-4 text-left"
            >
              <span className="flex items-center gap-2 text-amber-400 text-sm font-medium">
                <AlertTriangle size={16} className="shrink-0" />
                {totalUnits} unit{totalUnits === 1 ? '' : 's'} will expire before the next
                restock — sell first or pull
              </span>
              {expiryWarningsOpen ? (
                <ChevronUp size={16} className="text-amber-400 shrink-0" />
              ) : (
                <ChevronDown size={16} className="text-amber-400 shrink-0" />
              )}
            </button>
            {expiryWarningsOpen && (
              <div className="px-4 pb-4 space-y-1">
                {expiryWarnings.map((w, i) => (
                  <div key={`${w.sku}-${i}`} className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{w.name || w.sku}</span>
                    <span className="text-zinc-400 tabular-nums">
                      <span className="text-amber-400 font-medium">{w.qty}</span> ×{' '}
                      {w.expiryDate ? `exp ${formatDayMonth(w.expiryDate)}` : 'no expiry recorded'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
              {list.shortfalls.map((s, i) => (
                <div key={`${s.sku}-${i}`} className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300">
                    {s.name || s.sku}
                    {/* atConfirm entries were discovered at the van, per machine */}
                    {s.atConfirm && s.locationName && (
                      <span className="text-zinc-500"> — {s.locationName}</span>
                    )}
                  </span>
                  <span className="text-zinc-400 tabular-nums">
                    requested <span className="text-amber-400 font-medium">{s.requested}</span> ·
                    {s.atConfirm ? ' loaded ' : ' available '}
                    <span className="text-amber-400 font-medium">{s.loaded ?? s.available}</span>
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

      {/* Not-on-diagram banner: configured targets skipped because they have
          no slot on the location's visual planogram */}
      {(list.notOnPlanogram?.length || 0) > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <button
            onClick={() => setNotOnPlanogramOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 p-4 text-left"
          >
            <span className="flex items-center gap-2 text-amber-400 text-sm font-medium">
              <AlertTriangle size={16} className="shrink-0" />
              Products not on the visual diagram were skipped
            </span>
            {notOnPlanogramOpen ? (
              <ChevronUp size={16} className="text-amber-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-amber-400 shrink-0" />
            )}
          </button>
          {notOnPlanogramOpen && (
            <div className="px-4 pb-4 space-y-2">
              {list.notOnPlanogram.map((loc) => (
                <div key={loc.locationId} className="text-xs">
                  <span className="text-zinc-300 font-medium">{loc.locationName}</span>
                  <div className="text-zinc-400 mt-0.5 space-y-0.5">
                    {(loc.mealTypes || []).map((mt) => (
                      <div key={`mt-${mt}`} className="text-teal-300">{mt} (fresh meal group)</div>
                    ))}
                    {(loc.skus || []).map((s) => (
                      <div key={s.sku || s}>{s.name || s.sku || s}</div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-zinc-500 pt-1">
                These are configured for the location but have no slot on the fridge diagram.
                Place them in Location Stock → Visual to include them in picking.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---- Pack at the warehouse ---- */}
      {totalCount === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-500 text-sm">
          Nothing to pack — every location on this run is already at target stock.
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => setPackOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Pack at the warehouse</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                Tick off each product as it goes into the bags — nothing leaves warehouse stock
                until you confirm it into a machine below.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-zinc-300 font-medium tabular-nums">
                {packedCount}/{totalCount}
              </span>
              <span className="text-xs text-zinc-500">
                {saveState === 'saving' && 'Saving…'}
                {saveState === 'saved' && 'Saved'}
                {saveState === 'error' && <span className="text-red-400">Save failed</span>}
              </span>
              {packOpen ? (
                <ChevronUp size={16} className="text-zinc-500" />
              ) : (
                <ChevronDown size={16} className="text-zinc-500" />
              )}
            </div>
          </button>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${packProgressPct}%` }}
            />
          </div>
          {packOpen && (
            <div className="space-y-2 pt-1">
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
        </div>
      )}

      {/* ---- Run — confirm each machine ---- */}
      {locations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Run — confirm each machine</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {isLegacyPacked
                  ? 'Confirming records what went into the machine (warehouse stock was already removed at packing).'
                  : 'Confirming a machine removes its quantities from warehouse stock and adds them to the machine in one step.'}
              </p>
            </div>
            <span className="shrink-0 text-sm font-medium text-zinc-300 tabular-nums">
              {loadedCount} of {locations.length} loaded
            </span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${runProgressPct}%` }}
            />
          </div>

          <div className="space-y-2 pt-1">
            {locations.map((loc) => {
              const loaded = isLoaded(loc);
              const open = openLocId === loc.locationId;
              const confirmedAt = loc.confirmation?.createdAt || (isLegacyPacked ? loc.restock?.createdAt : null);
              return (
                <div
                  key={loc.locationId}
                  className={`rounded-xl border px-4 py-3 transition-colors ${
                    loaded
                      ? 'border-emerald-700/30 bg-emerald-700/5'
                      : 'border-zinc-800 bg-zinc-900/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className={`flex items-center gap-1.5 truncate text-base font-medium ${
                          loaded ? 'text-zinc-400' : 'text-zinc-100'
                        }`}
                      >
                        {loaded && (
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
                        {loc.layoutChangedAt && !loaded && (
                          <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-400">
                            layout changed since this list was built — consider regenerating
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <RunChip
                        done={!!loc.stockCheck}
                        label="Check"
                        time={formatTime(loc.stockCheck?.createdAt)}
                      />
                      <RunChip done={loaded} label="Loaded" time={formatTime(confirmedAt)} />
                    </div>
                  </div>

                  {/* Per-machine bagging list */}
                  {(loc.planned?.length || 0) > 0 && !loaded && (
                    <div className="mt-2 text-xs text-zinc-400">
                      {loc.planned
                        .filter((p) => (p.qty || 0) > 0)
                        .map((p, i) => (
                          <span key={p.sku}>
                            {i > 0 && <span className="text-zinc-600"> · </span>}
                            {p.name || p.sku} ×{p.qty}
                          </span>
                        ))}
                    </div>
                  )}

                  {!loaded && runActive && !open && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        onClick={() =>
                          navigate(
                            `/restock/check?locationId=${loc.locationId}&return=${encodeURIComponent(`/restock/picklists/${id}`)}`
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
                        onClick={() => openConfirmPanel(loc)}
                        className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-500 text-sm font-semibold text-zinc-900 hover:bg-emerald-400"
                      >
                        <PackagePlus size={16} />
                        Confirm loaded
                      </button>
                    </div>
                  )}

                  {/* Inline confirm panel */}
                  {open && (
                    <div className="mt-3 space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                      <p className="text-sm font-medium text-zinc-200">
                        Confirm what went into {loc.locationName}
                      </p>
                      {confirmRows.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          Nothing was planned for this machine — confirming just marks the stop as
                          visited.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {confirmRows.map((row) => (
                            <div key={row.sku} className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-zinc-200">{row.name || row.sku}</p>
                                <p className="text-xs text-zinc-500">{row.planned} planned</p>
                              </div>
                              <QtyInput
                                value={row.quantity}
                                onChange={(n) => updateConfirmQty(row.sku, n)}
                                className="w-32 flex-shrink-0"
                                aria-label={`Quantity of ${row.name || row.sku} loaded`}
                              />
                            </div>
                          ))}
                          <p className="text-[11px] text-zinc-500">
                            Loaded less than planned? Lower the number — the rest stays in warehouse
                            stock.
                          </p>
                        </div>
                      )}

                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1">
                          <label className="block text-xs text-zinc-500 mb-1">Loaded by</label>
                          <input
                            type="text"
                            value={confirmName}
                            onChange={(e) => {
                              setConfirmName(e.target.value);
                              try { localStorage.setItem(NAME_STORAGE_KEY, e.target.value); } catch { /* private mode */ }
                            }}
                            placeholder="Your name"
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-zinc-500 mb-1">Photo (optional)</label>
                          <label className="inline-flex h-[38px] cursor-pointer items-center gap-2 rounded border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600">
                            <Camera size={15} />
                            {confirmPhoto ? 'Photo added ✓' : 'Add photo'}
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={handlePhotoUpload}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>

                      {confirmError && <p className="text-xs text-red-400">{confirmError}</p>}

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => confirmLoaded(loc)}
                          disabled={confirmBusy}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
                        >
                          {confirmBusy && <Loader2 size={14} className="animate-spin" />}
                          {confirmBusy
                            ? 'Confirming…'
                            : isLegacyPacked
                              ? 'Confirm loaded'
                              : 'Confirm — update stock'}
                        </button>
                        <button
                          onClick={() => { setOpenLocId(null); setConfirmError(null); }}
                          disabled={confirmBusy}
                          className="px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-300 border border-zinc-700"
                        >
                          Back
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Finish run — remaining stops never left the warehouse */}
          {isInProgress && loadedCount < locations.length && (
            <div className="pt-1">
              {finishError && <p className="text-xs text-red-400 mb-2">{finishError}</p>}
              <button
                onClick={finishRun}
                disabled={finishBusy}
                className="w-full h-12 rounded-xl border border-zinc-700 bg-zinc-800 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              >
                {finishBusy ? 'Finishing…' : 'Finish run — skip the remaining machines'}
              </button>
              <p className="mt-1 text-center text-[11px] text-zinc-500">
                Unconfirmed stops never left warehouse stock — put their bags back on the shelf.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ---- Run summary / reconciliation ---- */}
      {reconciliation && (isInProgress || isCompleted || isLegacyPacked) && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
            <Truck size={18} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-200">
              {isLegacyPacked ? 'Van reconciliation' : 'Run summary'}
            </h3>
          </div>

          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums">
              <span className="text-zinc-400">
                Planned <span className="font-semibold text-zinc-100">{reconciliation.packedUnits}</span>
              </span>
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">
                Loaded <span className="font-semibold text-zinc-100">{reconciliation.loadedUnits}</span>
              </span>
              {isLegacyPacked && (
                <>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-400">
                    Returned <span className="font-semibold text-zinc-100">{reconciliation.returnedUnits}</span>
                  </span>
                </>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-400">
                {isLegacyPacked ? 'In van' : 'Not loaded (still at warehouse)'}{' '}
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
                {/* Mobile: stacked per-product cards (the table scrolls sideways on a phone) */}
                {skuTableOpen && (
                  <div className="md:hidden divide-y divide-zinc-800/50">
                    {reconciliation.perSku.map((row) => {
                      const remaining = (row.remaining || 0) > 0;
                      return (
                        <div key={row.sku} className={`py-2.5 tabular-nums ${remaining ? 'text-zinc-100' : 'text-zinc-500'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 truncate text-sm">{row.name || row.sku}</span>
                            <span className={`shrink-0 text-sm font-semibold ${remaining ? 'text-amber-400' : ''}`}>
                              {row.remaining} {isLegacyPacked ? 'in van' : 'not loaded'}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            Planned {row.packed} · Loaded {row.loaded}
                            {isLegacyPacked && <> · Returned {row.returned}</>}
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
                          <th className="px-2 py-2 text-right font-medium">Planned</th>
                          <th className="px-2 py-2 text-right font-medium">Loaded</th>
                          {isLegacyPacked && (
                            <th className="px-2 py-2 text-right font-medium">Returned</th>
                          )}
                          <th className="py-2 pl-2 text-right font-medium">
                            {isLegacyPacked ? 'In van' : 'Not loaded'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconciliation.perSku.map((row) => {
                          const remaining = (row.remaining || 0) > 0;
                          return (
                            <tr
                              key={row.sku}
                              className={`border-b border-zinc-800/50 tabular-nums ${
                                remaining ? 'text-zinc-100' : 'text-zinc-500'
                              }`}
                            >
                              <td className="max-w-[10rem] truncate py-2 pr-2">
                                {row.name || row.sku}
                              </td>
                              <td className="px-2 py-2 text-right">{row.packed}</td>
                              <td className="px-2 py-2 text-right">{row.loaded}</td>
                              {isLegacyPacked && (
                                <td className="px-2 py-2 text-right">{row.returned}</td>
                              )}
                              <td
                                className={`py-2 pl-2 text-right font-semibold ${
                                  remaining ? 'text-amber-400' : ''
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

            {!isLegacyPacked && reconciliation.remainingUnits > 0 && (
              <p className="text-[11px] text-zinc-500">
                "Not loaded" units were never removed from warehouse stock — no return needed, just
                put them back on the shelf.
              </p>
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

            {/* Return leftovers — LEGACY packed lists only (their warehouse
                stock was drained at pack time, so leftovers must be booked back) */}
            {isLegacyPacked && (returnItems ? (
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
            ))}
          </div>
        </div>
      )}

      <PrintSheet list={list} warehouseName={warehouseName} items={items} />
    </div>
  );
}
