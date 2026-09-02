import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowLeft, Copy, Share2, FileDown, Check, Pencil,
  Trash2, Archive, Plus, ExternalLink, Loader2
} from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import buyingListsService from '../../../services/buyingLists.service';
import { ordersService } from '../../../services/orders.service';
import ProductSearchCombobox from '../../ui/ProductSearchCombobox';

const STATUS_STYLES = {
  draft: 'bg-amber-500/20 text-amber-400',
  ordered: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-zinc-700 text-zinc-400',
};

function formatDate(iso, fmt = 'EEE d MMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

// Group list items by supplier, preserving item indexes so edits/removals can
// address the flat items array. Returns [{ supplierId, supplierName, rows }].
function groupBySupplier(items) {
  const groups = new Map();
  (items || []).forEach((item, idx) => {
    const key = item.supplierId || '__none__';
    if (!groups.has(key)) {
      groups.set(key, {
        supplierId: item.supplierId || null,
        supplierName: item.supplierName || 'No preferred supplier',
        rows: [],
      });
    }
    groups.get(key).rows.push({ item, idx });
  });
  return [...groups.values()];
}

function boxesFor(quantity, unitsPerBox) {
  const upb = unitsPerBox || 1;
  return upb > 1 ? Math.ceil((quantity || 0) / upb) : quantity || 0;
}

// Plain-text export — WhatsApp-friendly, grouped by supplier.
function listAsText(list) {
  const parts = [list.name || 'Buying list'];
  if (list.targetDate) parts.push(`Restock Monday ${formatDate(list.targetDate, 'd MMM yyyy')}`);
  for (const group of groupBySupplier(list.items)) {
    parts.push('');
    parts.push(`— ${group.supplierName} —`);
    for (const { item } of group.rows) {
      const boxes = boxesFor(item.quantity, item.unitsPerBox);
      const boxNote = (item.unitsPerBox || 1) > 1 ? ` (${boxes} box${boxes === 1 ? '' : 'es'})` : '';
      parts.push(`• ${item.name || item.sku} × ${item.quantity}${boxNote}`);
    }
  }
  return parts.join('\n');
}

export default function BuyingListDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, refresh } = useStock();

  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null); // { type, message }

  // Auto-save machinery
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const listRef = useRef(null);
  const saveTimerRef = useRef(null);
  useEffect(() => { listRef.current = list; }, [list]);

  // Inline name edit
  const [editingName, setEditingName] = useState(false);

  // Add-product row
  const [addSku, setAddSku] = useState('');
  const [addQty, setAddQty] = useState('');

  // Action confirms / async states
  const [confirmAction, setConfirmAction] = useState(null); // 'createOrders' | 'createOrdersUnshared' | 'createOrdersBelowMinimum' | 'archive' | 'delete'
  // Overrides the operator has already granted this attempt. Accumulated
  // rather than passed straight through, because the two soft gates fire in
  // sequence: clearing NOT_SHARED must not lose that grant when the next
  // attempt trips BELOW_MINIMUM, and clearing BELOW_MINIMUM must not silently
  // re-waive NOT_SHARED.
  const [orderOverrides, setOrderOverrides] = useState({ force: false, forceBelowMinimum: false });
  // Per-supplier shortfalls from a BELOW_MINIMUM 409, so the prompt can say
  // which supplier is short and by how much.
  const [belowMinimum, setBelowMinimum] = useState(null);
  // Minimum-order top-up proposals, keyed by supplier id.
  const [topups, setTopups] = useState({});
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [createdOrders, setCreatedOrders] = useState(null); // success panel after Create POs

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    (async () => {
      try {
        const res = await buyingListsService.getById(id);
        if (!cancelled) setList(res);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) setNotFound(true);
        else setError('Failed to load buying list — check the connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const isDraft = list?.status === 'draft';
  // Whole days since the list's quantities were computed (they are a frozen
  // snapshot — never re-netted against the warehouse after creation).
  const staleDays = list?.createdAt
    ? Math.floor((Date.now() - new Date(list.createdAt).getTime()) / 86_400_000)
    : 0;

  // Debounced persist of the editable fields. Server response does not clobber
  // local state (edits may already be ahead of the in-flight save).
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimerRef.current);
    setSaveState('saving');
    saveTimerRef.current = setTimeout(async () => {
      const current = listRef.current;
      if (!current) return;
      try {
        await buyingListsService.update(current.id, {
          name: current.name,
          items: current.items,
          notes: current.notes || '',
        });
        setSaveState('saved');
      } catch (err) {
        console.error('Auto-save failed:', err);
        setSaveState('error');
      }
    }, 800);
  }, []);

  const mutateList = (updater) => {
    setList(prev => {
      const next = typeof updater === 'function' ? updater(prev) : { ...prev, ...updater };
      return next;
    });
    scheduleSave();
  };

  const updateItem = (idx, field, value) => {
    mutateList(prev => ({
      ...prev,
      items: prev.items.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, [field]: value };
        if (field === 'quantity') next.boxes = boxesFor(value, it.unitsPerBox);
        return next;
      }),
    }));
  };

  const removeLine = (idx) => {
    mutateList(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const addLine = () => {
    const product = data.products.find(p => p.sku === addSku);
    const qty = parseInt(addQty) || 0;
    if (!product || qty <= 0) return;
    const supplier = data.suppliers.find(s => s.id === product.preferredSupplierId);
    const unitsPerBox = product.unitsPerBox || 1;
    mutateList(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          sku: product.sku,
          name: product.name,
          supplierId: supplier?.id || null,
          supplierName: supplier?.name || null,
          quantity: qty,
          unitsPerBox,
          boxes: boxesFor(qty, unitsPerBox),
          unitCost: product.unitCost || 0,
        },
      ],
    }));
    setAddSku('');
    setAddQty('');
  };

  /**
   * Ask the server what to add so this supplier's group clears their minimum,
   * and fold the answer straight into the list.
   *
   * Available here as well as in Plan Buy because create-orders BLOCKS on a
   * short group from this screen — telling the operator to "top it up first"
   * with no way to do it here would be a dead end.
   */
  const requestTopup = async (supplierId, rows, { includeFreeDelivery = false } = {}) => {
    setTopups(prev => ({ ...prev, [supplierId]: { loading: true } }));
    try {
      const res = await ordersService.topup({
        supplierId,
        subtotal: rows.reduce((a, { item }) => a + (item.quantity || 0) * (item.unitCost || 0), 0),
        totalUnits: rows.reduce((a, { item }) => a + (item.quantity || 0), 0),
        // Every SKU already on the list, whatever supplier group it sits in —
        // proposing one that is already here would double it.
        excludeSkus: (list.items || []).map(i => i.sku).filter(Boolean),
        includeFreeDelivery,
      });
      setTopups(prev => ({ ...prev, [supplierId]: res }));
    } catch (err) {
      setTopups(prev => ({
        ...prev,
        [supplierId]: { error: err.response?.data?.error || 'Could not work out a top-up — try again.' },
      }));
    }
  };

  const applyTopup = (supplierId) => {
    const plan = topups[supplierId]?.plan;
    if (!plan?.additions?.length) return;
    const supplier = data.suppliers.find(s => s.id === supplierId);

    mutateList(prev => {
      const items = [...(prev.items || [])];
      for (const add of plan.additions) {
        const idx = items.findIndex(i => i.sku === add.sku);
        if (idx !== -1) {
          // Already a line — add to it rather than creating a duplicate the
          // PO would then carry twice.
          const quantity = (items[idx].quantity || 0) + add.units;
          items[idx] = {
            ...items[idx],
            quantity,
            boxes: boxesFor(quantity, items[idx].unitsPerBox || add.unitsPerBox || 1),
          };
        } else {
          items.push({
            sku: add.sku,
            name: add.name,
            supplierId,
            supplierName: supplier?.name || null,
            quantity: add.units,
            unitsPerBox: add.unitsPerBox || 1,
            boxes: add.boxes,
            unitCost: add.unitCost || 0,
          });
        }
      }
      return { ...prev, items };
    });

    setTopups(prev => ({ ...prev, [supplierId]: undefined }));
    // The shortfall that triggered the block is gone — clear the prompt so the
    // operator is not still looking at a stale "send anyway?".
    setBelowMinimum(null);
    setConfirmAction(null);
  };

  // ===== Actions =====

  // Copying the text or the link counts as sharing — stamp sharedAt so the
  // create-orders share gate knows the list has been put in front of someone.
  // Fire-and-forget: a failed stamp must not break the copy.
  const stampShared = () => {
    if (list?.sharedAt) return;
    buyingListsService.markShared(list.id)
      .then((res) => setList((prev) => (prev ? { ...prev, sharedAt: res?.sharedAt || new Date().toISOString() } : prev)))
      .catch(() => {});
  };

  const copyAsText = async () => {
    try {
      await navigator.clipboard.writeText(listAsText(list));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      stampShared();
    } catch (err) {
      console.error('Copy failed:', err);
      setBanner({ type: 'error', message: 'Could not copy to clipboard.' });
    }
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(buyingListsService.shareUrl(list));
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
      stampShared();
    } catch (err) {
      console.error('Copy failed:', err);
      setBanner({ type: 'error', message: 'Could not copy the share link.' });
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const blob = await buyingListsService.downloadPdf(list.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStr = (list.targetDate || new Date().toISOString()).slice(0, 10);
      a.download = `buying-list-${dateStr}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed:', err);
      setBanner({ type: 'error', message: 'PDF download failed — try again.' });
    } finally {
      setDownloading(false);
    }
  };

  const createOrders = async (grant = {}) => {
    const overrides = { ...orderOverrides, ...grant };
    setOrderOverrides(overrides);
    setActionBusy(true);
    setBanner(null);
    let keepConfirm = false;
    try {
      // Flush any pending edits before the server snapshots the items.
      clearTimeout(saveTimerRef.current);
      await buyingListsService.update(list.id, {
        name: list.name,
        items: list.items,
        notes: list.notes || '',
      });
      const res = await buyingListsService.createOrders(list.id, overrides);
      // Server responses here don't carry supplierMeta — keep the loaded copy.
      if (res.buyingList) setList(prev => ({ ...res.buyingList, supplierMeta: prev?.supplierMeta }));
      else setList(prev => ({ ...prev, status: 'ordered', orderIds: (res.orders || []).map(o => o.id) }));
      setCreatedOrders(res.orders || []);
      setSaveState('idle');
      // Pull the new POs into shared state so they show on the Orders page.
      try { await refresh(); } catch { /* non-fatal */ }
    } catch (err) {
      const code = err.response?.status === 409 ? err.response?.data?.code : null;
      if (code === 'NOT_SHARED') {
        // Weekly rule: share the list before ordering. Offer the override.
        setConfirmAction('createOrdersUnshared');
        keepConfirm = true;
        return;
      }
      if (code === 'BELOW_MINIMUM') {
        // A supplier group is under their order minimum — an order that may be
        // refused on delivery day, which costs a whole restock cycle.
        setBelowMinimum(err.response.data.belowMinimum || []);
        setConfirmAction('createOrdersBelowMinimum');
        keepConfirm = true;
        return;
      }
      console.error('Create orders failed:', err);
      setBanner({
        type: 'error',
        message: `Failed to create orders: ${err.response?.data?.error || err.message || 'unknown error'}`,
      });
    } finally {
      setActionBusy(false);
      if (!keepConfirm) setConfirmAction(null);
    }
  };

  const archiveList = async () => {
    setActionBusy(true);
    setBanner(null);
    try {
      const updated = await buyingListsService.update(list.id, { status: 'archived' });
      setList(prev => (updated ? { ...updated, supplierMeta: prev?.supplierMeta } : { ...prev, status: 'archived' }));
      setBanner({ type: 'success', message: 'Buying list archived.' });
    } catch (err) {
      console.error('Archive failed:', err);
      setBanner({ type: 'error', message: 'Failed to archive the list.' });
    } finally {
      setActionBusy(false);
      setConfirmAction(null);
    }
  };

  const deleteList = async () => {
    setActionBusy(true);
    try {
      await buyingListsService.delete(list.id);
      navigate('/orders/buying-lists');
    } catch (err) {
      console.error('Delete failed:', err);
      setBanner({ type: 'error', message: 'Failed to delete the list.' });
      setActionBusy(false);
      setConfirmAction(null);
    }
  };

  // ===== Render =====

  if (loading) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <p className="text-zinc-400 text-sm">Loading buying list…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
        <p className="text-zinc-300 font-medium">Buying list not found</p>
        <p className="text-zinc-500 text-sm mt-1">It may have been deleted.</p>
        <Link
          to="/orders/buying-lists"
          className="inline-block mt-4 px-4 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700"
        >
          Back to buying lists
        </Link>
      </div>
    );
  }

  if (error || !list) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
        <p className="text-red-400 text-sm">{error || 'Something went wrong.'}</p>
        <Link
          to="/orders/buying-lists"
          className="inline-block mt-4 px-4 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700"
        >
          Back to buying lists
        </Link>
      </div>
    );
  }

  const groups = groupBySupplier(list.items);
  const grandTotal = (list.items || []).reduce((a, i) => a + (i.quantity || 0) * (i.unitCost || 0), 0);
  const totalUnits = (list.items || []).reduce((a, i) => a + (i.quantity || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link to="/orders/buying-lists" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 w-fit">
          <ArrowLeft size={14} />
          Buying lists
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {isDraft && editingName ? (
              <input
                autoFocus
                type="text"
                value={list.name || ''}
                onChange={e => mutateList({ name: e.target.value })}
                onBlur={() => setEditingName(false)}
                onKeyDown={e => { if (e.key === 'Enter') setEditingName(false); }}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-lg font-semibold focus:outline-none focus:border-emerald-500 min-w-0"
              />
            ) : (
              <h2 className="text-xl font-semibold flex items-center gap-2 min-w-0">
                <span className="truncate">{list.name || 'Untitled list'}</span>
                {isDraft && (
                  <button
                    onClick={() => setEditingName(true)}
                    className="text-zinc-500 hover:text-zinc-300 shrink-0"
                    title="Rename"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </h2>
            )}
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[list.status] || STATUS_STYLES.archived}`}>
              {list.status}
            </span>
          </div>
          {/* Save indicator */}
          {isDraft && saveState !== 'idle' && (
            <span className={`flex items-center gap-1.5 text-xs ${
              saveState === 'error' ? 'text-red-400' : 'text-zinc-500'
            }`}>
              {saveState === 'saving' && <><Loader2 size={12} className="animate-spin" /> Saving…</>}
              {saveState === 'saved' && <><Check size={12} className="text-emerald-400" /> Saved</>}
              {saveState === 'error' && 'Save failed — edits are not persisted'}
            </span>
          )}
        </div>
        <div className="text-sm text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
          {list.targetDate && (
            <span>Target restock: <span className="text-zinc-300">{formatDate(list.targetDate)}</span></span>
          )}
          {list.createdAt && <span>Created {formatDate(list.createdAt, 'd MMM yyyy HH:mm')}</span>}
          <span>{(list.items || []).length} lines · {totalUnits} units</span>
        </div>
      </div>

      {banner && (
        <div className={`rounded-lg px-4 py-3 text-sm border flex items-start justify-between gap-3 ${
          banner.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          <p>{banner.message}</p>
          <button onClick={() => setBanner(null)} className="shrink-0 opacity-70 hover:opacity-100">×</button>
        </div>
      )}

      {/* Staleness warning: quantities were netted against warehouse stock and
          pending orders at creation time and are never re-netted — a delivery
          or restock since then makes them over- or under-buy. */}
      {isDraft && staleDays >= 2 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg px-4 py-3 text-sm">
          These quantities were calculated {staleDays} days ago and haven't been
          re-checked against the warehouse since. If stock has arrived or been
          picked since then, re-plan from{' '}
          <Link to="/orders/purchase?generate=1" className="underline hover:text-amber-300">Plan Buy</Link>{' '}
          before creating POs.
        </div>
      )}

      {/* Success panel after creating POs */}
      {createdOrders && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 space-y-3">
          <p className="text-emerald-400 font-medium text-sm">
            Created {createdOrders.length} purchase order{createdOrders.length === 1 ? '' : 's'} (one per supplier)
          </p>
          <div className="space-y-1.5">
            {createdOrders.map(o => {
              const supplier = data.suppliers.find(s => s.id === o.supplierId);
              return (
                <div key={o.id} className="flex items-center justify-between text-sm bg-zinc-900/50 rounded px-3 py-2">
                  <span className="text-zinc-300">
                    {supplier?.name || o.supplierId || 'No preferred supplier'}
                    <span className="text-zinc-600 ml-2">#{String(o.id).slice(-6)}</span>
                  </span>
                  {o.total > 0 && <span className="text-emerald-400">£{Number(o.total).toFixed(2)}</span>}
                </div>
              );
            })}
          </div>
          <Link
            to="/orders/purchase"
            className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300"
          >
            View purchase orders <ExternalLink size={13} />
          </Link>
        </div>
      )}

      {/* Actions bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <button
          onClick={copyAsText}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 transition-colors"
        >
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy as text'}
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={copyShareLink}
            disabled={!list.shareToken}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 transition-colors disabled:opacity-50"
            title="Anyone with the link can view this list"
          >
            {shareCopied ? <Check size={14} className="text-emerald-400" /> : <Share2 size={14} />}
            {shareCopied ? 'Link copied' : 'Share link'}
          </button>
          {shareCopied && (
            <span className="text-xs text-zinc-500">anyone with the link can view</span>
          )}
        </div>
        <button
          onClick={downloadPdf}
          disabled={downloading}
          className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
          {downloading ? 'Preparing…' : 'Download PDF'}
        </button>

        <div className="flex-1" />

        {isDraft && (
          confirmAction === 'createOrdersUnshared' ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-amber-400">List hasn't been shared yet — create POs anyway?</span>
              <button
                onClick={() => createOrders({ force: true })}
                disabled={actionBusy}
                className="px-3 py-2 bg-amber-500 text-zinc-900 rounded text-sm font-medium hover:bg-amber-400 disabled:opacity-50"
              >
                {actionBusy ? 'Creating…' : 'Create anyway'}
              </button>
              <button
                onClick={() => { setConfirmAction(null); setOrderOverrides({ force: false, forceBelowMinimum: false }); }}
                disabled={actionBusy}
                className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700"
              >
                Share first
              </button>
            </span>
          ) : confirmAction === 'createOrdersBelowMinimum' ? (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-amber-400">
                {(belowMinimum || []).map((b) => {
                  const parts = [];
                  if (b.value > 0) parts.push(`£${b.value.toFixed(2)} short of £${(b.minOrderValue ?? 0).toFixed(2)}`);
                  if (b.units > 0) parts.push(`${b.units} units short of ${b.minOrderUnits}`);
                  return `${b.supplierName}: ${parts.join(', ')}`;
                }).join(' · ')} — send anyway?
              </span>
              <button
                onClick={() => createOrders({ forceBelowMinimum: true })}
                disabled={actionBusy}
                className="px-3 py-2 bg-amber-500 text-zinc-900 rounded text-sm font-medium hover:bg-amber-400 disabled:opacity-50"
              >
                {actionBusy ? 'Creating…' : 'Send anyway'}
              </button>
              <button
                onClick={() => { setConfirmAction(null); setOrderOverrides({ force: false, forceBelowMinimum: false }); }}
                disabled={actionBusy}
                className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700"
              >
                Top it up first
              </button>
            </span>
          ) : confirmAction === 'createOrders' ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Create {groups.length} PO{groups.length === 1 ? '' : 's'}?</span>
              <button
                onClick={() => createOrders()}
                disabled={actionBusy}
                className="px-3 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
              >
                {actionBusy ? 'Creating…' : 'Confirm'}
              </button>
              <button
                onClick={() => setConfirmAction(null)}
                disabled={actionBusy}
                className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmAction('createOrders')}
              disabled={(list.items || []).length === 0}
              className="px-3 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors disabled:opacity-50"
            >
              Create POs (one per supplier)
            </button>
          )
        )}

        {list.status !== 'archived' && (
          confirmAction === 'archive' ? (
            <span className="flex items-center gap-2 text-sm">
              <span className="text-zinc-400">Archive?</span>
              <button onClick={archiveList} disabled={actionBusy} className="px-2.5 py-1.5 bg-zinc-700 text-zinc-200 rounded text-sm hover:bg-zinc-600 disabled:opacity-50">Yes</button>
              <button onClick={() => setConfirmAction(null)} className="px-2.5 py-1.5 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700">No</button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmAction('archive')}
              className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700 transition-colors"
            >
              <Archive size={14} />
              Archive
            </button>
          )
        )}

        {confirmAction === 'delete' ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400">Delete permanently?</span>
            <button onClick={deleteList} disabled={actionBusy} className="px-2.5 py-1.5 bg-red-500/20 text-red-400 rounded text-sm hover:bg-red-500/30 disabled:opacity-50">
              {actionBusy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button onClick={() => setConfirmAction(null)} className="px-2.5 py-1.5 bg-zinc-800 text-zinc-400 rounded text-sm hover:bg-zinc-700">No</button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmAction('delete')}
            className="flex items-center gap-1.5 px-3 py-2 bg-zinc-800 text-red-400 rounded text-sm hover:bg-zinc-700 transition-colors"
          >
            <Trash2 size={14} />
            Delete
          </button>
        )}
      </div>

      {/* Items grouped by supplier */}
      {(list.items || []).length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400 text-sm">This list has no lines{isDraft ? ' — add products below.' : '.'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => {
            const subtotal = group.rows.reduce((a, { item }) => a + (item.quantity || 0) * (item.unitCost || 0), 0);
            // Ordering config from the backend's supplierMeta map (order days,
            // lead time, minimum order) — recomputed live as quantities change.
            const meta = group.supplierId ? list.supplierMeta?.[group.supplierId] : null;
            const orderDays = Array.isArray(meta?.orderDays) && meta.orderDays.length
              ? meta.orderDays.map(d => ({ mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }[d] || d)).join(' · ')
              : null;
            const groupUnits = group.rows.reduce((a, { item }) => a + (item.quantity || 0), 0);
            const minShort = meta?.minOrderValue != null && subtotal < meta.minOrderValue
              ? meta.minOrderValue - subtotal
              : null;
            const unitsShort = meta?.minOrderUnits != null && groupUnits < meta.minOrderUnits
              ? meta.minOrderUnits - groupUnits
              : null;
            // Only once the blocking minimums are met — a saving must never
            // compete for attention with an order that would be refused.
            const freeDelShort = meta?.freeDeliveryValue != null
              && subtotal < meta.freeDeliveryValue
              && minShort == null && unitsShort == null
              ? meta.freeDeliveryValue - subtotal
              : null;
            const topup = group.supplierId ? topups[group.supplierId] : null;
            const isShort = minShort != null || unitsShort != null;
            return (
              <div key={group.supplierId || '__none__'} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-zinc-800/60 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-sm font-medium text-teal-400">{group.supplierName}</span>
                    {orderDays && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-700/60 text-zinc-300">Orders {orderDays}</span>
                    )}
                    {meta?.leadTimeDays != null && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{meta.leadTimeDays}d lead</span>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500">
                    {group.rows.length} line{group.rows.length === 1 ? '' : 's'} · £{subtotal.toFixed(2)}
                  </span>
                </div>
                {meta?.minOrderValue != null && (
                  minShort != null ? (
                    <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20">
                      <div className="flex items-center justify-between text-xs text-amber-300">
                        <span>£{minShort.toFixed(2)} short of £{meta.minOrderValue.toFixed(2)} minimum</span>
                        <span>£{subtotal.toFixed(2)} / £{meta.minOrderValue.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 h-1 rounded bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full bg-amber-500"
                          style={{ width: `${Math.min(100, (subtotal / meta.minOrderValue) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-1.5 border-b border-zinc-800 text-[11px] text-emerald-500/80">
                      £{meta.minOrderValue.toFixed(2)} minimum met ✓
                    </div>
                  )
                )}

                {unitsShort != null && (
                  <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300">
                    {unitsShort} units short of their {meta.minOrderUnits}-unit minimum ({groupUnits} on the list)
                  </div>
                )}

                {freeDelShort != null && (
                  <div className="px-4 py-1.5 border-b border-zinc-800 text-[11px] text-sky-400">
                    £{freeDelShort.toFixed(2)} more would make delivery free.
                  </div>
                )}

                {/* The fix, not just the warning. Offered whenever the group is
                    short (or only free delivery is missing) — create-orders
                    BLOCKS on a short group from this screen, so there has to be
                    a way to resolve it here. */}
                {isDraft && group.supplierId && (isShort || freeDelShort != null) && (
                  <div className="px-4 py-2 border-b border-zinc-800">
                    {!topup ? (
                      <button
                        onClick={() => requestTopup(group.supplierId, group.rows, { includeFreeDelivery: !isShort })}
                        className="text-xs px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                      >
                        {isShort ? 'Top it up to the minimum' : 'Top it up to free delivery'}
                      </button>
                    ) : topup.loading ? (
                      <span className="text-xs text-zinc-500">Working it out…</span>
                    ) : topup.error ? (
                      <span className="text-xs text-red-400">{topup.error}</span>
                    ) : !topup.plan?.additions?.length ? (
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-zinc-400">
                          Nothing from this supplier is worth padding with — it is all either
                          well stocked already or has no sales to justify buying more.
                        </span>
                        <button
                          onClick={() => setTopups(prev => ({ ...prev, [group.supplierId]: undefined }))}
                          className="text-zinc-500 hover:text-zinc-300 shrink-0"
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs text-zinc-300">
                            Add £{topup.plan.valueAdded.toFixed(2)} ({topup.plan.unitsAdded} units)
                            {topup.targetedFreeDelivery ? ' to reach free delivery' : ' to clear the minimum'}
                          </span>
                          <span className="flex items-center gap-2">
                            <button
                              onClick={() => applyTopup(group.supplierId)}
                              className="px-2.5 py-1 rounded bg-emerald-500 text-zinc-900 text-xs font-medium hover:bg-emerald-400"
                            >
                              Add these
                            </button>
                            <button
                              onClick={() => setTopups(prev => ({ ...prev, [group.supplierId]: undefined }))}
                              className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              No thanks
                            </button>
                          </span>
                        </div>
                        <ul className="space-y-1">
                          {topup.plan.additions.map(a => (
                            <li key={a.sku} className="flex items-baseline justify-between gap-3 text-xs">
                              <span className="text-zinc-300 truncate">
                                {a.boxes} × {a.name}
                                <span className="text-zinc-600"> ({a.units} units)</span>
                              </span>
                              <span className="shrink-0 text-zinc-500">{a.reason}</span>
                              <span className="shrink-0 text-zinc-400">£{a.lineTotal.toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                        {topup.plan.exhausted && (
                          <p className="text-xs text-amber-400">
                            Still £{topup.plan.valueRemaining.toFixed(2)} short after this. Nothing
                            else from this supplier can take more stock without going past four
                            weeks of cover — worth a call to them rather than buying it.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {/* Mobile: stacked line cards */}
                <div className="md:hidden divide-y divide-zinc-800/60">
                  {group.rows.map(({ item, idx }) => (
                    <div key={`${item.sku || item.mealType}-${idx}`} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="text-sm text-zinc-200">{item.name || item.sku}</span>
                          {item.sku && <span className="text-xs text-zinc-600 ml-2">{item.sku}</span>}
                          {!item.sku && item.isFreshMeal && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 ml-2" title="Ordered at meal-type level — the weekly menu rotates; actual flavours are allocated at receiving">
                              rotating menu
                            </span>
                          )}
                          {item.parentName && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 ml-2" title="Flavour line from a product family — split suggested by sell rate">
                              {item.parentName}
                            </span>
                          )}
                        </div>
                        {isDraft && (
                          <button
                            onClick={() => removeLine(idx)}
                            className="flex-shrink-0 text-zinc-600 hover:text-red-400 text-lg leading-none px-1"
                            title="Remove line"
                          >
                            ×
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500">Qty</span>
                          {isDraft ? (
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={item.quantity}
                              onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
                            />
                          ) : (
                            <span className="text-sm text-zinc-300">{item.quantity}</span>
                          )}
                          <span className="text-xs text-zinc-500 whitespace-nowrap">
                            {boxesFor(item.quantity, item.unitsPerBox)} box{boxesFor(item.quantity, item.unitsPerBox) === 1 ? '' : 'es'}
                            {(item.unitsPerBox || 1) > 1 && <span className="text-zinc-600"> × {item.unitsPerBox}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-500">Unit £</span>
                          {isDraft ? (
                            <input
                              type="number"
                              inputMode="numeric"
                              step="0.01"
                              min="0"
                              value={item.unitCost ?? 0}
                              onChange={e => updateItem(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
                            />
                          ) : (
                            <span className="text-sm text-zinc-300">£{(item.unitCost || 0).toFixed(2)}</span>
                          )}
                          <span className="text-sm text-zinc-300 whitespace-nowrap">
                            £{((item.quantity || 0) * (item.unitCost || 0)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Desktop: line table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                        <th className="px-4 py-2 font-medium">Product</th>
                        <th className="px-2 py-2 font-medium">Qty</th>
                        <th className="px-2 py-2 font-medium text-center">Boxes</th>
                        <th className="px-2 py-2 font-medium">Unit £</th>
                        <th className="px-2 py-2 font-medium text-right">Line £</th>
                        {isDraft && <th className="px-2 py-2 w-8" />}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map(({ item, idx }) => (
                        <tr key={`${item.sku || item.mealType}-${idx}`} className="border-b border-zinc-800/60 last:border-0">
                          <td className="px-4 py-2">
                            <span className="text-sm text-zinc-200">{item.name || item.sku}</span>
                            {item.sku && <span className="text-xs text-zinc-600 ml-2">{item.sku}</span>}
                            {!item.sku && item.isFreshMeal && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 ml-2" title="Ordered at meal-type level — the weekly menu rotates; actual flavours are allocated at receiving">
                                rotating menu
                              </span>
                            )}
                            {item.parentName && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 ml-2" title="Flavour line from a product family — split suggested by sell rate">
                                {item.parentName}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {isDraft ? (
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                value={item.quantity}
                                onChange={e => updateItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
                              />
                            ) : (
                              <span className="text-sm text-zinc-300">{item.quantity}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-sm text-zinc-400 text-center whitespace-nowrap">
                            {boxesFor(item.quantity, item.unitsPerBox)}
                            {(item.unitsPerBox || 1) > 1 && <span className="text-zinc-600"> × {item.unitsPerBox}</span>}
                          </td>
                          <td className="px-2 py-2">
                            {isDraft ? (
                              <input
                                type="number"
                                inputMode="numeric"
                                step="0.01"
                                min="0"
                                value={item.unitCost ?? 0}
                                onChange={e => updateItem(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
                              />
                            ) : (
                              <span className="text-sm text-zinc-300">£{(item.unitCost || 0).toFixed(2)}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-sm text-zinc-300 text-right whitespace-nowrap">
                            £{((item.quantity || 0) * (item.unitCost || 0)).toFixed(2)}
                          </td>
                          {isDraft && (
                            <td className="px-2 py-2">
                              <button
                                onClick={() => removeLine(idx)}
                                className="text-zinc-600 hover:text-red-400"
                                title="Remove line"
                              >
                                ×
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Grand total */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-zinc-400">
              {groups.length} supplier{groups.length === 1 ? '' : 's'} · {totalUnits} units
            </span>
            <span className="text-sm font-medium">
              <span className="text-zinc-500 mr-2">Grand total</span>
              <span className="text-emerald-400">£{grandTotal.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}

      {/* Add product (draft only) */}
      {isDraft && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Add product</label>
            <div className="flex flex-col sm:flex-row gap-2">
              <ProductSearchCombobox
                className="flex-1"
                products={data.products}
                value={addSku}
                onSelect={sku => setAddSku(sku)}
                recentsKey="hatch-recent-products-buylist"
              />
              <input
                type="number"
                inputMode="numeric"
                min="1"
                placeholder="Qty"
                value={addQty}
                onChange={e => setAddQty(e.target.value)}
                className="w-full sm:w-24 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={addLine}
                disabled={!addSku || !(parseInt(addQty) > 0)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-700 text-zinc-200 rounded text-sm hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea
              value={list.notes || ''}
              onChange={e => mutateList({ notes: e.target.value })}
              placeholder="Delivery instructions, substitutions, anything the buyer should know…"
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>
        </div>
      )}

      {/* Notes (read-only when not draft) */}
      {!isDraft && list.notes && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Notes</p>
          <p className="text-sm text-zinc-300 whitespace-pre-wrap">{list.notes}</p>
        </div>
      )}
    </div>
  );
}
