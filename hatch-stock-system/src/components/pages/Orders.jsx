import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { RefreshCw, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';
import { useStock } from '../../context/StockContext';
import ordersService from '../../services/orders.service';
import buyingListsService from '../../services/buyingLists.service';
import vendliveService from '../../services/vendlive.service';

// Compact "2h ago" / "just now" formatter for sync timestamps.
function formatRelativeTime(ts) {
  if (!ts) return 'never';
  const diffMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diffMs)) return 'unknown';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDay(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, 'd MMM');
}

// VendLive's own restock predictions, per selected location — an informational
// side-by-side sanity check on the engine's numbers, never merged into the
// suggestion lines. Fetched on demand per location and cached for the panel's
// lifetime.
function PredictionsPanel({ selectedLocationIds, locations }) {
  const [open, setOpen] = useState(false);
  // { [locationId]: { loading, error, machines } }
  const [byLocation, setByLocation] = useState({});

  const compare = async (locationId) => {
    setByLocation(prev => ({ ...prev, [locationId]: { loading: true } }));
    try {
      const res = await vendliveService.getPredictions(locationId);
      setByLocation(prev => ({ ...prev, [locationId]: { machines: res.machines || [] } }));
    } catch (err) {
      const status = err.response?.status;
      const message = status === 404 ? 'No machines mapped to this location'
        : status === 409 ? 'VendLive not configured — see Support → Settings'
        : status === 502 ? 'VendLive unreachable — try again later'
        : err.response?.data?.error || 'Failed to load predictions';
      setByLocation(prev => ({ ...prev, [locationId]: { error: message } }));
    }
  };

  const selected = selectedLocationIds
    .map(id => locations.find(l => l.id === id))
    .filter(Boolean);
  if (selected.length === 0) return null;

  return (
    <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-zinc-300">VendLive predictions (cross-check)</span>
        {open ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <p className="text-[11px] text-zinc-600">
            VendLive's own restock suggestions per machine — a second opinion on the plan above, not merged into it.
          </p>
          {selected.map(loc => {
            const state = byLocation[loc.id];
            return (
              <div key={loc.id} className="border border-zinc-700/60 rounded-lg p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-300">{loc.name}</span>
                  {!state?.machines && (
                    <button
                      onClick={() => compare(loc.id)}
                      disabled={state?.loading}
                      className="px-2 py-1 text-[11px] bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 disabled:opacity-50"
                    >
                      {state?.loading ? 'Loading…' : 'Compare'}
                    </button>
                  )}
                </div>
                {state?.error && <p className="mt-1.5 text-[11px] text-amber-400">{state.error}</p>}
                {state?.machines && (
                  state.machines.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-zinc-500">No prediction data returned.</p>
                  ) : (
                    state.machines.map(m => (
                      <div key={m.machineId} className="mt-2">
                        <p className="text-[11px] text-zinc-500 mb-1">{m.machineName}</p>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-zinc-600">
                              <th className="text-left font-medium pb-0.5">Product</th>
                              <th className="text-right font-medium pb-0.5">Current</th>
                              <th className="text-right font-medium pb-0.5">Predicted need</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(m.products || []).filter(p => p.predicted != null || p.currentStock != null).map((p, i) => (
                              <tr key={`${p.sku || p.name}-${i}`} className="text-zinc-400 border-t border-zinc-800">
                                <td className="py-0.5 pr-2 truncate max-w-[180px]">{p.name}</td>
                                <td className="py-0.5 text-right">{p.currentStock ?? '—'}</td>
                                <td className="py-0.5 text-right">{p.predicted ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, data, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const supplier = data.suppliers.find(s => s.id === order.supplierId);
  const warehouse = data.warehouses.find(w => w.id === order.warehouseId);

  const deliveryMethodLabels = {
    standard: 'Standard',
    match: 'Match Delivery',
    pickup: 'Pick Up'
  };

  // Receive progress — items carry receivedQty once anything has been booked in.
  const totalQty = (order.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
  const totalReceived = (order.items || []).reduce((a, i) => a + (i.receivedQty || 0), 0);
  const partiallyReceived = totalReceived > 0 && order.status === 'pending';

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-zinc-200">{supplier?.name || order.supplierId}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              order.status === 'received'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-amber-500/20 text-amber-400'
            }`}>
              {order.status}
            </span>
            {partiallyReceived && (
              <span className="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-400">
                {totalReceived}/{totalQty} received
              </span>
            )}
            <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
              {deliveryMethodLabels[order.deliveryMethod] || 'Standard'}
            </span>
            {order.invoiceRef && (
              <span className="text-xs text-zinc-500">Ref: {order.invoiceRef}</span>
            )}
          </div>
          <div className="text-sm text-zinc-500 mt-1">
            → {order.deliveryType === 'warehouse' ? (warehouse?.name || order.warehouseId) : order.customAddress}
            {order.expectedDate && ` • Expected: ${order.expectedDate}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-600">#{order.id.slice(-6)}</div>
          {order.total > 0 && (
            <div className="text-emerald-400 font-medium mt-1">£{order.total?.toFixed(2)}</div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {order.items.slice(0, expanded ? undefined : 3).map((item, i) => {
          const product = data.products.find(p => p.sku === item.sku);
          const unitsPerBox = product?.unitsPerBox || 1;
          const boxes = unitsPerBox > 1 ? Math.ceil(item.quantity / unitsPerBox) : null;
          return (
            <span key={i} className="text-xs bg-zinc-800 px-2 py-1 rounded">
              {product?.name || item.sku} × {item.quantity}
              {boxes && unitsPerBox > 1 && (
                <span className="text-teal-400 ml-1">({boxes} box{boxes > 1 ? 'es' : ''})</span>
              )}
              {item.unitPrice > 0 && <span className="text-zinc-500 ml-1">@ £{item.unitPrice.toFixed(2)}</span>}
              {item.receivedQty > 0 && (
                <span className="text-sky-400 ml-1">✓{item.receivedQty}</span>
              )}
            </span>
          );
        })}
        {!expanded && order.items.length > 3 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            +{order.items.length - 3} more
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2 text-sm">
          {order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Delivery Fee</span>
              <span className="text-zinc-400">£{order.deliveryFee.toFixed(2)}</span>
            </div>
          )}
          {order.notes && (
            <div className="text-zinc-500 text-xs">
              <span className="font-medium">Notes:</span> {order.notes}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-300"
        >
          {expanded ? 'Show less' : 'Show details'}
        </button>
        {order.status === 'pending' && (
          <>
            <button
              onClick={onEdit}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              Edit
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Delete?</span>
                <button
                  onClick={() => { onDelete(order.id); setConfirmDelete(false); }}
                  className="text-xs text-red-400 hover:text-red-300 font-medium"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-300"
                >
                  No
                </button>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Orders() {
  const { data, createOrder, updateOrder, deleteOrder } = useStock();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ===== Plan weekly buy (consolidated suggestions) =====
  const [showGenerateOrder, setShowGenerateOrder] = useState(false);
  const [buyMode, setBuyMode] = useState('weekly'); // 'weekly' | 'topup'
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [suggestedItems, setSuggestedItems] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionMeta, setSuggestionMeta] = useState(null); // { mode, restockDate, coverTradingDays, ... }
  const [expandedLines, setExpandedLines] = useState(() => new Set());
  const [orderNotes, setOrderNotes] = useState('');
  const [stockFreshness, setStockFreshness] = useState([]); // [{ locationId, mapped, lastSyncedAt }]
  const [syncingLocations, setSyncingLocations] = useState(() => new Set());
  const [panelBanner, setPanelBanner] = useState(null); // { type, message, details? }
  const [savingList, setSavingList] = useState(false);
  const [creatingOrders, setCreatingOrders] = useState(false);

  // Keys ('sku' or 'frive:{mealType}') whose orderQty/unitPrice/selected the
  // user has touched — re-fetches must not clobber these lines.
  const editedKeysRef = useRef(new Set());
  // Fetch race guard: only the latest request may apply its response.
  const fetchSeqRef = useRef(0);
  // Latest suggestions, readable synchronously inside async fetch merges.
  const suggestedItemsRef = useRef([]);
  useEffect(() => { suggestedItemsRef.current = suggestedItems; }, [suggestedItems]);

  const [form, setForm] = useState({
    supplierId: '',
    deliveryMethod: 'standard',
    deliveryType: 'warehouse',
    warehouseId: '',
    customAddress: '',
    items: [{ sku: '', quantity: '', unitPrice: '' }],
    expectedDate: '',
    deliveryFee: '',
    notes: '',
    invoiceRef: ''
  });

  const resetForm = () => {
    setForm({
      supplierId: '',
      deliveryMethod: 'standard',
      deliveryType: 'warehouse',
      warehouseId: '',
      customAddress: '',
      items: [{ sku: '', quantity: '', unitPrice: '' }],
      expectedDate: '',
      deliveryFee: '',
      notes: '',
      invoiceRef: ''
    });
    setEditingOrder(null);
    setShowForm(false);
  };

  // A consolidated line is either a concrete SKU or a fresh-meal group keyed by
  // meal type. The key is stable across re-fetches so user edits survive.
  const lineKey = (s) => (s.sku ? s.sku : `frive:${s.mealType}`);
  const isFreshMealGroup = (s) =>
    s.type === 'freshMealGroup' || (!s.sku && !!s.mealType) || s.isFreshMeal === true;

  // Fetch consolidated suggestions, merging over any user-edited lines and
  // discarding stale responses (sequence counter).
  const fetchSuggestions = useCallback(async (locationIds, mode) => {
    const seq = ++fetchSeqRef.current;
    if (!locationIds || locationIds.length === 0) {
      setSuggestedItems([]);
      setSuggestionMeta(null);
      setSuggestionsLoading(false);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const res = await ordersService.generateConsolidatedSuggestions(locationIds, mode);
      if (seq !== fetchSeqRef.current) return; // superseded by a newer request
      const prevByKey = new Map(suggestedItemsRef.current.map(i => [i.key, i]));
      const items = (res.suggestions || []).map(s => {
        const key = lineKey(s);
        const base = {
          ...s,
          key,
          unitPrice: s.unitCost ?? 0,
          selected: true,
        };
        if (editedKeysRef.current.has(key) && prevByKey.has(key)) {
          const prev = prevByKey.get(key);
          return { ...base, orderQty: prev.orderQty, unitPrice: prev.unitPrice, selected: prev.selected };
        }
        return base;
      });
      setSuggestedItems(items);
      setSuggestionMeta(res.meta || null);
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Failed to load consolidated suggestions:', err);
      setSuggestedItems([]);
      setSuggestionMeta(null);
      setPanelBanner({ type: 'error', message: 'Failed to load suggestions — check the connection and try again.' });
    } finally {
      if (seq === fetchSeqRef.current) setSuggestionsLoading(false);
    }
  }, []);

  const loadStockFreshness = useCallback(async () => {
    try {
      setStockFreshness(await vendliveService.getStockFreshness());
    } catch (err) {
      console.error('Failed to load stock freshness:', err);
    }
  }, []);

  // Pull VendLive truth into LocationStock for one location, then refresh
  // freshness + suggestions so the plan reflects live machine stock.
  const syncOneLocation = async (locId) => {
    setSyncingLocations(prev => new Set(prev).add(locId));
    try {
      await vendliveService.syncLocationStock(locId);
      await Promise.all([
        loadStockFreshness(),
        fetchSuggestions(selectedLocationIds, buyMode),
      ]);
    } catch (err) {
      console.error('Stock sync failed:', err);
      setPanelBanner({
        type: 'error',
        message: `Sync failed for ${data.locations.find(l => l.id === locId)?.name || locId}: ${err.response?.data?.error || err.message || 'unknown error'}`,
      });
    } finally {
      setSyncingLocations(prev => {
        const next = new Set(prev);
        next.delete(locId);
        return next;
      });
    }
  };

  const syncAllSelected = async () => {
    const mappedIds = selectedLocationIds.filter(id => {
      const fr = stockFreshness.find(f => f.locationId === id);
      return !fr || fr.mapped !== false;
    });
    if (mappedIds.length === 0) return;
    setSyncingLocations(new Set(mappedIds));
    const results = await Promise.allSettled(
      mappedIds.map(id => vendliveService.syncLocationStock(id))
    );
    setSyncingLocations(new Set());
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? mappedIds[i] : null))
      .filter(Boolean)
      .map(id => data.locations.find(l => l.id === id)?.name || id);
    if (failed.length > 0) {
      setPanelBanner({ type: 'error', message: `Sync failed for: ${failed.join(', ')}` });
    } else {
      setPanelBanner({ type: 'success', message: `Synced ${mappedIds.length} location${mappedIds.length === 1 ? '' : 's'} from VendLive.` });
    }
    await Promise.all([
      loadStockFreshness(),
      fetchSuggestions(selectedLocationIds, buyMode),
    ]);
  };

  const openGenerateOrder = useCallback(() => {
    const ids = data.locations.map(l => l.id);
    setSelectedLocationIds(ids);
    setBuyMode('weekly');
    setExpandedLines(new Set());
    setOrderNotes('');
    setPanelBanner(null);
    editedKeysRef.current = new Set();
    setShowGenerateOrder(true);
    loadStockFreshness();
    fetchSuggestions(ids, 'weekly');
  }, [data.locations, fetchSuggestions, loadStockFreshness]);

  // Deep link: /orders/purchase?generate=1 auto-opens the planning panel
  // (used by the Buying Lists "New buying list" button).
  useEffect(() => {
    if (searchParams.get('generate') === '1') {
      openGenerateOrder();
      const next = new URLSearchParams(searchParams);
      next.delete('generate');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchBuyMode = (mode) => {
    if (mode === buyMode) return;
    setBuyMode(mode);
    fetchSuggestions(selectedLocationIds, mode);
  };

  const toggleLocationId = (id) => {
    const next = selectedLocationIds.includes(id)
      ? selectedLocationIds.filter(x => x !== id)
      : [...selectedLocationIds, id];
    setSelectedLocationIds(next);
    fetchSuggestions(next, buyMode);
  };

  const setAllLocations = (ids) => {
    setSelectedLocationIds(ids);
    fetchSuggestions(ids, buyMode);
  };

  const toggleLineExpanded = (key) => {
    setExpandedLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const updateSuggestedItem = (key, field, value) => {
    editedKeysRef.current.add(key);
    setSuggestedItems(items => items.map(i =>
      i.key === key
        ? { ...i, [field]: field === 'orderQty' ? (parseInt(value) || 0) : value, edited: true }
        : i
    ));
  };

  const toggleSuggestedItem = (key) => {
    editedKeysRef.current.add(key);
    setSuggestedItems(items => items.map(i =>
      i.key === key ? { ...i, selected: !i.selected, edited: true } : i
    ));
  };

  const boxesFor = (item) => {
    const upb = item.unitsPerBox || 1;
    return upb > 1 ? Math.ceil((item.orderQty || 0) / upb) : item.orderQty || 0;
  };

  const calculateSuggestedTotal = () => suggestedItems
    .filter(i => i.selected)
    .reduce((acc, i) => acc + (i.orderQty * i.unitPrice), 0);

  // Buying lists and POs carry concrete SKUs, but a Frive suggestion is a
  // meal-type group. Split a group's quantity across its flavour SKUs by recent
  // sell-through (even split if there's no sales signal), assigning any rounding
  // remainder to the strongest sellers. Non-group lines pass through unchanged.
  const splitGroupQuantities = (item) => {
    const members = item.members || [];
    if (members.length === 0) return [];
    const totalVel = members.reduce((a, m) => a + (m.velocityLong || m.blendedVelocity || 0), 0);
    const shares = members.map(m => ({
      member: m,
      raw: totalVel > 0
        ? item.orderQty * ((m.velocityLong || m.blendedVelocity || 0) / totalVel)
        : item.orderQty / members.length,
    }));
    let assigned = 0;
    const lines = shares.map(s => {
      const q = Math.floor(s.raw);
      assigned += q;
      return { member: s.member, quantity: q, frac: s.raw - q };
    });
    let remainder = item.orderQty - assigned;
    lines.sort((a, b) => b.frac - a.frac);
    for (let i = 0; remainder > 0; i++, remainder--) lines[i % lines.length].quantity += 1;
    return lines.filter(l => l.quantity > 0);
  };

  // Expand a suggestion line into buying-list item lines. Fresh-meal groups
  // become one line per member SKU; each member inherits the group's supplier
  // and netting fields and carries the group's perLocation breakdown.
  const expandToListLines = (item) => {
    const upb = item.unitsPerBox || 1;
    const baseFields = {
      supplierId: item.supplierId || null,
      supplierName: item.supplierName || null,
      unitsPerBox: upb,
      unitCost: item.unitPrice,
      machineStock: item.machineStock,
      projectedStock: item.projectedStock,
      warehouseStock: item.warehouseStock,
      pendingPOQty: item.pendingPOQty,
      grossNeed: item.grossNeed,
      netNeed: item.netNeed,
      priority: item.priority,
      perLocation: item.perLocation || [],
    };
    if (!isFreshMealGroup(item)) {
      return [{
        ...baseFields,
        sku: item.sku,
        name: item.name,
        quantity: item.orderQty,
        boxes: upb > 1 ? Math.ceil(item.orderQty / upb) : item.orderQty,
      }];
    }
    return splitGroupQuantities(item).map(({ member, quantity }) => ({
      ...baseFields,
      sku: member.sku,
      name: member.name || `${item.name} (${member.sku})`,
      mealType: item.mealType,
      quantity,
      boxes: upb > 1 ? Math.ceil(quantity / upb) : quantity,
    }));
  };

  // Same expansion, but shaped as PO order lines.
  const expandToOrderLines = (item) => {
    if (!isFreshMealGroup(item)) {
      return [{ sku: item.sku, quantity: item.orderQty, unitPrice: item.unitPrice }];
    }
    return splitGroupQuantities(item).map(({ member, quantity }) => ({
      sku: member.sku,
      quantity,
      unitPrice: item.unitPrice,
    }));
  };

  // Primary CTA: persist the plan as a draft buying list and jump to it.
  const saveAsBuyingList = async () => {
    const selected = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    if (selected.length === 0) return;
    setSavingList(true);
    setPanelBanner(null);
    try {
      const items = selected.flatMap(expandToListLines);
      const restockDate = suggestionMeta?.restockDate || null;
      const name = restockDate
        ? `Buy for Mon ${formatDay(restockDate)}`
        : `Buying list ${formatDay(new Date().toISOString())}`;
      const created = await buyingListsService.create({
        name,
        targetDate: restockDate,
        items,
        ...(orderNotes ? { notes: orderNotes } : {}),
      });
      navigate(`/orders/buying-lists/${created.id}`);
    } catch (err) {
      console.error('Failed to save buying list:', err);
      setPanelBanner({
        type: 'error',
        message: `Failed to save buying list: ${err.response?.data?.error || err.message || 'unknown error'}`,
      });
    } finally {
      setSavingList(false);
    }
  };

  // Distinct suppliers among currently-selected lines (drives the secondary
  // "create one PO per supplier" button label).
  const selectedSupplierCount = () => {
    const keys = new Set(
      suggestedItems.filter(i => i.selected && i.orderQty > 0).map(i => i.supplierId || '__none__')
    );
    return keys.size;
  };

  // Secondary path: skip the buying list and raise one pending PO per supplier
  // directly. Each order is created independently so one failure doesn't sink
  // the rest — the banner summarises what was created and what failed.
  const createOrdersDirectly = async () => {
    const selected = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    if (selected.length === 0) return;
    setCreatingOrders(true);
    setPanelBanner(null);

    const warehouseId = data.warehouses[0]?.id || null;
    const bySupplier = new Map();
    for (const item of selected) {
      const key = item.supplierId || '';
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(item);
    }

    // Client ids match the manual form's convention (numeric-string, unique);
    // the offline context replaces them with its own ids anyway.
    const stamp = Date.now();
    const created = [];
    const failed = [];
    let idx = 0;
    for (const [supplierId, items] of bySupplier.entries()) {
      const supplierName = items[0]?.supplierName || 'No preferred supplier';
      const lines = items.flatMap(expandToOrderLines).filter(l => l.quantity > 0);
      if (lines.length === 0) { idx++; continue; }
      const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
      try {
        await createOrder({
          id: (stamp + idx).toString(),
          supplierId: supplierId || null,
          deliveryMethod: 'standard',
          deliveryType: 'warehouse',
          warehouseId,
          customAddress: null,
          items: lines.map(l => ({
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.quantity * l.unitPrice,
          })),
          expectedDate: '',
          deliveryFee: 0,
          subtotal,
          total: subtotal,
          notes: orderNotes,
          invoiceRef: '',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        created.push(supplierName);
      } catch (err) {
        failed.push({
          supplierName,
          reason: err.response?.data?.error || err.message || 'unknown error',
        });
      }
      idx++;
    }

    setCreatingOrders(false);
    if (failed.length === 0) {
      setPanelBanner({
        type: 'success',
        message: `Created ${created.length} purchase order${created.length === 1 ? '' : 's'} (one per supplier).`,
      });
    } else {
      setPanelBanner({
        type: failed.length === bySupplier.size ? 'error' : 'warning',
        message: `Created ${created.length}, failed ${failed.length}.`,
        details: failed.map(f => `${f.supplierName}: ${f.reason}`),
      });
    }
  };

  // ===== Manual PO form =====

  const startEdit = (order) => {
    setForm({
      supplierId: order.supplierId || '',
      deliveryMethod: order.deliveryMethod || 'standard',
      deliveryType: order.deliveryType || 'warehouse',
      warehouseId: order.warehouseId || '',
      customAddress: order.customAddress || '',
      items: order.items.map(i => ({
        sku: i.sku,
        quantity: i.quantity.toString(),
        unitPrice: i.unitPrice?.toString() || ''
      })),
      expectedDate: order.expectedDate || '',
      deliveryFee: order.deliveryFee?.toString() || '',
      notes: order.notes || '',
      invoiceRef: order.invoiceRef || ''
    });
    setEditingOrder(order.id);
    setShowForm(true);
  };

  const addItem = () => {
    setForm({ ...form, items: [...form.items, { sku: '', quantity: '', unitPrice: '' }] });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx][field] = value;
    if (field === 'sku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product?.unitCost && !items[idx].unitPrice) {
        items[idx].unitPrice = product.unitCost.toString();
      }
    }
    setForm({ ...form, items });
  };

  const removeItem = (idx) => {
    if (form.items.length > 1) {
      setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
    }
  };

  const calculateSubtotal = () => {
    return form.items.reduce((acc, item) => {
      const qty = parseInt(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return acc + (qty * price);
    }, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + (parseFloat(form.deliveryFee) || 0);
  };

  const submit = async () => {
    if (!form.supplierId || !form.items[0].sku) return;
    if (form.deliveryType === 'warehouse' && !form.warehouseId) return;
    if (form.deliveryType === 'custom' && !form.customAddress) return;

    const order = {
      id: editingOrder || Date.now().toString(),
      supplierId: form.supplierId,
      deliveryMethod: form.deliveryMethod,
      deliveryType: form.deliveryType,
      warehouseId: form.deliveryType === 'warehouse' ? form.warehouseId : null,
      customAddress: form.deliveryType === 'custom' ? form.customAddress : null,
      items: form.items.filter(i => i.sku && i.quantity).map(i => ({
        sku: i.sku,
        quantity: parseInt(i.quantity),
        unitPrice: parseFloat(i.unitPrice) || 0,
        lineTotal: (parseInt(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0)
      })),
      expectedDate: form.expectedDate,
      deliveryFee: parseFloat(form.deliveryFee) || 0,
      subtotal: calculateSubtotal(),
      total: calculateTotal(),
      notes: form.notes,
      invoiceRef: form.invoiceRef,
      status: editingOrder ? data.orders.find(o => o.id === editingOrder)?.status || 'pending' : 'pending',
      createdAt: editingOrder ? data.orders.find(o => o.id === editingOrder)?.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (editingOrder) {
      await updateOrder(editingOrder, order);
    } else {
      await createOrder(order);
    }
    resetForm();
  };

  // Dynamic order search: every typed word must match somewhere in the
  // order's supplier name, invoice ref, notes, status, item SKUs or
  // product names (case-insensitive).
  const orderMatchesSearch = (order) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const supplierName = data.suppliers.find(s => s.id === order.supplierId)?.name || '';
    const haystack = [
      supplierName,
      order.invoiceRef || '',
      order.notes || '',
      order.status || '',
      ...(order.items || []).flatMap(i => [
        i.sku || '',
        data.products.find(p => p.sku === i.sku)?.name || '',
      ]),
    ].join(' ').toLowerCase();
    return query.split(/\s+/).every(token => haystack.includes(token));
  };

  // Group the current lines by preferred supplier for the table sections.
  const supplierGroups = () => {
    const groups = new Map();
    suggestedItems.forEach((item) => {
      const key = item.supplierId || '__none__';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId: item.supplierId || null,
          supplierName: item.supplierName || 'No preferred supplier',
          items: [],
        });
      }
      groups.get(key).items.push(item);
    });
    return [...groups.values()];
  };

  // One suggestion table row (+ optional per-location breakdown row).
  const renderSuggestionRow = (item) => {
    const expandable = Array.isArray(item.perLocation) && item.perLocation.length > 0;
    const expanded = expandedLines.has(item.key);
    return (
      <React.Fragment key={item.key}>
        <tr className={`border-t border-zinc-800 ${item.selected ? '' : 'opacity-40'}`}>
          <td className="px-2 py-2">
            <input
              type="checkbox"
              checked={item.selected}
              onChange={() => toggleSuggestedItem(item.key)}
              className="w-4 h-4 rounded border-zinc-600"
            />
          </td>
          <td className="px-2 py-2 min-w-[180px]">
            <div className="flex items-center gap-1.5">
              {expandable && (
                <button
                  onClick={() => toggleLineExpanded(item.key)}
                  className="shrink-0 text-zinc-500 hover:text-zinc-300"
                  title={expanded ? 'Hide locations' : 'Show per-location breakdown'}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
              <span className="text-sm text-zinc-200">{item.name}</span>
              {item.edited && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                  title="Edited — kept across refreshes"
                />
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {item.supplierName || 'No preferred supplier'}
              {isFreshMealGroup(item) && item.members && (
                <span> · {item.members.length} flavour{item.members.length > 1 ? 's' : ''}</span>
              )}
            </div>
          </td>
          <td className="px-2 py-2 text-sm whitespace-nowrap" title="projected at restock">
            <span className="text-zinc-300">{item.machineStock ?? '—'}</span>
            <ArrowRight size={11} className="inline mx-1 text-zinc-600" />
            <span className={`${(item.projectedStock ?? 0) <= 0 ? 'text-red-400' : 'text-zinc-400'}`}>
              {item.projectedStock ?? '—'}
            </span>
          </td>
          <td className="px-2 py-2 text-sm text-zinc-400 text-right">{item.warehouseStock ?? 0}</td>
          <td className="px-2 py-2 text-sm text-zinc-400 text-right">{item.pendingPOQty ?? 0}</td>
          <td className="px-2 py-2 text-sm text-zinc-300 text-right">{item.netNeed ?? 0}</td>
          <td className="px-2 py-2">
            <input
              type="number"
              min="0"
              value={item.orderQty}
              onChange={(e) => updateSuggestedItem(item.key, 'orderQty', e.target.value)}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
            />
          </td>
          <td className="px-2 py-2 text-sm text-zinc-400 text-center whitespace-nowrap">
            {boxesFor(item)}{(item.unitsPerBox || 1) > 1 && <span className="text-zinc-600"> × {item.unitsPerBox}</span>}
          </td>
          <td className="px-2 py-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={item.unitPrice}
              onChange={(e) => updateSuggestedItem(item.key, 'unitPrice', parseFloat(e.target.value) || 0)}
              className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center text-sm focus:outline-none focus:border-emerald-500"
            />
          </td>
          <td className="px-2 py-2 text-sm text-center whitespace-nowrap">
            {item.daysOfCover != null ? (
              <span className="text-teal-400">{item.daysOfCover}td</span>
            ) : (
              <span className="text-zinc-600">—</span>
            )}
          </td>
          <td className="px-2 py-2">
            <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${
              item.priority === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
            }`}>
              {item.priority === 'critical' ? 'CRITICAL' : 'LOW'}
            </span>
          </td>
        </tr>
        {expandable && expanded && (
          <tr className="border-t border-zinc-800/50">
            <td />
            <td colSpan={10} className="px-2 pb-2">
              <div className="rounded-md bg-zinc-800/40 border border-zinc-700 divide-y divide-zinc-700/60">
                {item.perLocation.map(pl => (
                  <div key={pl.locationId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                    <span className="text-zinc-300">{pl.locationName}</span>
                    <span className="text-zinc-500">
                      {pl.machineStock != null && `machine ${pl.machineStock}`}
                      {pl.projectedStock != null && ` → ${pl.projectedStock}`}
                      {pl.daysOfCover != null && ` · ${pl.daysOfCover}td cover`}
                      {pl.orderQty != null && (
                        <>
                          {' · '}<span className="text-teal-400">order {pl.orderQty}</span>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </td>
          </tr>
        )}
      </React.Fragment>
    );
  };

  const isSearching = searchQuery.trim().length > 0;
  const pendingOrders = data.orders.filter(o => o.status === 'pending').filter(orderMatchesSearch);
  const completedOrders = data.orders.filter(o => o.status === 'received').filter(orderMatchesSearch);
  const selectedCount = suggestedItems.filter(i => i.selected && i.orderQty > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Purchase Orders</h2>
        <div className="grid grid-cols-2 sm:flex gap-2">
          <button
            onClick={openGenerateOrder}
            className="px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 transition-colors"
          >
            <span className="hidden sm:inline">Plan weekly buy</span>
            <span className="sm:hidden">Plan buy</span>
          </button>
          <button
            onClick={() => { resetForm(); setShowForm(!showForm); }}
            className="px-3 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            {showForm ? 'X' : '+'} <span className="hidden sm:inline">{showForm ? 'Cancel' : 'New'}</span>
          </button>
        </div>
      </div>

      {/* Plan weekly buy panel */}
      {showGenerateOrder && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">Plan weekly buy</h3>
              <p className="text-zinc-500 text-sm mt-1">
                Suggested quantities from machine velocity, projected to restock day and netted
                against warehouse stock and pending POs.
              </p>
            </div>
            <button onClick={() => setShowGenerateOrder(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {panelBanner && (
            <div className={`rounded-lg px-4 py-3 text-sm border ${
              panelBanner.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : panelBanner.type === 'warning'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p>{panelBanner.message}</p>
                  {panelBanner.details && (
                    <ul className="mt-1 list-disc list-inside text-xs opacity-80">
                      {panelBanner.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                </div>
                <button onClick={() => setPanelBanner(null)} className="shrink-0 opacity-70 hover:opacity-100">×</button>
              </div>
            </div>
          )}

          {/* Mode toggle */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-2">
              {[{ id: 'weekly', label: 'Weekly order' }, { id: 'topup', label: 'Midweek top-up' }].map(m => (
                <button
                  key={m.id}
                  onClick={() => switchBuyMode(m.id)}
                  className={`px-4 py-2 rounded text-sm transition-colors ${
                    buyMode === m.id ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {suggestionMeta?.restockDate && (
              <span className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-zinc-300">
                Covering restock Monday {formatDay(suggestionMeta.restockDate)}
                {' · '}{suggestionMeta.coverTradingDays ?? suggestionMeta.tradingDaysToRestock ?? '—'} trading days
              </span>
            )}
          </div>

          {/* Location multi-select with per-location freshness + sync */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-zinc-500">Locations ({selectedLocationIds.length} selected)</label>
              <div className="flex gap-3 text-xs">
                <button
                  onClick={() => setAllLocations(data.locations.map(l => l.id))}
                  className="text-teal-400 hover:text-teal-300"
                >
                  Select all
                </button>
                <button
                  onClick={() => setAllLocations([])}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto">
              {data.locations.map(l => {
                const fr = stockFreshness.find(f => f.locationId === l.id);
                const unmapped = fr && fr.mapped === false;
                const syncing = syncingLocations.has(l.id);
                const checked = selectedLocationIds.includes(l.id);
                return (
                  <div
                    key={l.id}
                    className={`flex items-center gap-2 text-sm bg-zinc-800 border rounded px-2 py-1.5 ${
                      checked ? 'border-zinc-600' : 'border-zinc-700'
                    }`}
                  >
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLocationId(l.id)}
                        className="w-4 h-4 rounded border-zinc-600"
                      />
                      <span className="truncate text-zinc-300">{l.name}</span>
                    </label>
                    <span className={`text-[10px] whitespace-nowrap ${unmapped ? 'text-yellow-400' : 'text-zinc-500'}`}>
                      {unmapped ? 'no VendLive link' : fr?.lastSyncedAt ? formatRelativeTime(fr.lastSyncedAt) : 'never synced'}
                    </span>
                    {checked && !unmapped && (
                      <button
                        onClick={() => syncOneLocation(l.id)}
                        disabled={syncing}
                        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 disabled:opacity-50"
                        title="Sync stock from VendLive"
                      >
                        <RefreshCw size={10} className={syncing ? 'animate-spin' : ''} />
                        Sync
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-zinc-600">Stock is read from the last VendLive sync — sync before planning for live truth.</p>
              <button
                onClick={syncAllSelected}
                disabled={syncingLocations.size > 0 || selectedLocationIds.length === 0}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw size={12} className={syncingLocations.size > 0 ? 'animate-spin' : ''} />
                {syncingLocations.size > 0 ? 'Syncing…' : 'Sync all selected'}
              </button>
            </div>
          </div>

          {/* VendLive prediction cross-check */}
          <PredictionsPanel selectedLocationIds={selectedLocationIds} locations={data.locations} />

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-teal-400">{suggestedItems.length}</div>
              <div className="text-xs text-zinc-500">Lines</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">{suggestedItems.filter(i => i.priority === 'critical').length}</div>
              <div className="text-xs text-zinc-500">Critical</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">{suggestedItems.filter(i => i.priority === 'warning').length}</div>
              <div className="text-xs text-zinc-500">Warning</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">£{calculateSuggestedTotal().toFixed(2)}</div>
              <div className="text-xs text-zinc-500">Est. Total</div>
            </div>
          </div>

          {/* Suggestions table */}
          {suggestionsLoading ? (
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-6 text-center">
              <p className="text-zinc-400 text-sm">Analysing stock and sales velocity…</p>
            </div>
          ) : suggestedItems.length === 0 ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6 text-center">
              <p className="text-emerald-400 font-medium">
                {selectedLocationIds.length === 0 ? 'No locations selected' : 'All stocked up!'}
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                {selectedLocationIds.length === 0
                  ? 'Pick one or more locations to plan for.'
                  : 'Nothing needs ordering across the selected locations for this window.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-lg border border-zinc-800">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-zinc-900 z-10">
                  <tr className="text-xs text-zinc-500">
                    <th className="px-2 py-2 font-medium w-8" />
                    <th className="px-2 py-2 font-medium">Product / Supplier</th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap" title="Machine stock now → projected at restock">Machine</th>
                    <th className="px-2 py-2 font-medium text-right">Warehouse</th>
                    <th className="px-2 py-2 font-medium text-right whitespace-nowrap">On order</th>
                    <th className="px-2 py-2 font-medium text-right whitespace-nowrap">Net need</th>
                    <th className="px-2 py-2 font-medium whitespace-nowrap">Order qty</th>
                    <th className="px-2 py-2 font-medium text-center">Boxes</th>
                    <th className="px-2 py-2 font-medium">Unit £</th>
                    <th className="px-2 py-2 font-medium text-center" title="Days of cover (trading days)">Cover</th>
                    <th className="px-2 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {supplierGroups().map(group => {
                    const selectedInGroup = group.items.filter(i => i.selected && i.orderQty > 0);
                    const subtotal = selectedInGroup.reduce((a, i) => a + i.orderQty * i.unitPrice, 0);
                    // Ordering config from shared supplier state: order-day
                    // chips + minimum-order shortfall as quantities change.
                    const supplier = group.supplierId
                      ? data.suppliers.find(s => s.id === group.supplierId)
                      : null;
                    const orderDays = Array.isArray(supplier?.orderDays) && supplier.orderDays.length
                      ? supplier.orderDays.map(d => ({ mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }[d] || d)).join(' · ')
                      : null;
                    const minShort = supplier?.minOrderValue != null && subtotal < supplier.minOrderValue
                      ? supplier.minOrderValue - subtotal
                      : null;
                    return (
                      <React.Fragment key={group.supplierId || '__none__'}>
                        <tr className="bg-zinc-800/60">
                          <td colSpan={11} className="px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-teal-400">{group.supplierName}</span>
                                {orderDays && (
                                  <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-700/60 text-zinc-300">Orders {orderDays}</span>
                                )}
                              </div>
                              <span className="text-xs text-zinc-500">
                                {selectedInGroup.length} selected · £{subtotal.toFixed(2)}
                                {minShort != null && (
                                  <span className="ml-2 text-amber-400">
                                    £{minShort.toFixed(2)} short of £{supplier.minOrderValue.toFixed(2)} min
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {group.items.map(renderSuggestionRow)}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes (Optional)</label>
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Any special instructions..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={saveAsBuyingList}
              disabled={selectedCount === 0 || savingList}
              className="flex-1 px-4 py-3 bg-emerald-500 text-zinc-900 rounded-lg text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {savingList ? 'Saving…' : `Save as buying list (${selectedCount} line${selectedCount === 1 ? '' : 's'})`}
            </button>
            <button
              onClick={createOrdersDirectly}
              disabled={selectedCount === 0 || creatingOrders}
              className="px-4 py-3 bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingOrders
                ? 'Creating…'
                : `Create ${selectedSupplierCount()} PO${selectedSupplierCount() === 1 ? '' : 's'} directly`}
            </button>
            <button onClick={() => setShowGenerateOrder(false)} className="px-4 py-3 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Order Form */}
      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">{editingOrder ? 'Edit Order' : 'New Purchase Order'}</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Supplier *</label>
              <select
                value={form.supplierId}
                onChange={e => setForm({ ...form, supplierId: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select supplier</option>
                {data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Invoice Reference</label>
              <input
                type="text"
                value={form.invoiceRef}
                onChange={e => setForm({ ...form, invoiceRef: e.target.value })}
                placeholder="e.g., INV-12345"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Delivery Method</label>
            <div className="flex gap-2">
              {[{ id: 'standard', label: 'Standard' }, { id: 'match', label: 'Match' }, { id: 'pickup', label: 'Pick Up' }].map(method => (
                <button
                  key={method.id}
                  onClick={() => setForm({ ...form, deliveryMethod: method.id })}
                  className={`px-4 py-2 rounded text-sm transition-colors ${
                    form.deliveryMethod === method.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Delivery To *</label>
              <select
                value={form.deliveryType}
                onChange={e => setForm({ ...form, deliveryType: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="warehouse">Warehouse</option>
                <option value="custom">Custom Address</option>
              </select>
            </div>
            {form.deliveryType === 'warehouse' ? (
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Select Warehouse *</label>
                <select
                  value={form.warehouseId}
                  onChange={e => setForm({ ...form, warehouseId: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Select warehouse</option>
                  {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Delivery Address *</label>
                <input
                  type="text"
                  value={form.customAddress}
                  onChange={e => setForm({ ...form, customAddress: e.target.value })}
                  placeholder="Enter full address"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Expected delivery</label>
              <input
                type="date"
                value={form.expectedDate}
                onChange={e => setForm({ ...form, expectedDate: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Delivery Fee (£)</label>
              <input
                type="number"
                step="0.01"
                value={form.deliveryFee}
                onChange={e => setForm({ ...form, deliveryFee: e.target.value })}
                placeholder="0.00"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Order Items</label>
            <div className="space-y-2">
              {form.items.map((item, idx) => {
                const lineTotal = (parseInt(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={item.sku}
                      onChange={e => updateItem(idx, 'sku', e.target.value)}
                      className="col-span-5 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">Select product</option>
                      {data.products.map(p => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
                    </select>
                    <input
                      type="number"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                      className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <div className="col-span-2 text-right text-zinc-300 text-sm">£{lineTotal.toFixed(2)}</div>
                    <button onClick={() => removeItem(idx)} className="col-span-1 text-zinc-500 hover:text-red-400">×</button>
                  </div>
                );
              })}
            </div>
            <button onClick={addItem} className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">+ Add item</button>
          </div>

          <div className="border-t border-zinc-800 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-zinc-300">£{calculateSubtotal().toFixed(2)}</span>
            </div>
            {parseFloat(form.deliveryFee) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Delivery Fee</span>
                <span className="text-zinc-300">£{parseFloat(form.deliveryFee).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-medium pt-2 border-t border-zinc-800">
              <span className="text-zinc-300">Total</span>
              <span className="text-emerald-400">£{calculateTotal().toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Any special instructions..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={!form.supplierId || !form.items[0].sku || (form.deliveryType === 'warehouse' && !form.warehouseId) || (form.deliveryType === 'custom' && !form.customAddress)}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingOrder ? 'Update Order' : 'Create Order'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Order search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search orders — supplier, product, SKU, invoice ref..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600"
          />
          {isSearching && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {isSearching && (
          <span className="text-xs text-zinc-500">
            {pendingOrders.length + completedOrders.length} match{pendingOrders.length + completedOrders.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* Pending Orders */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-400">Pending Orders ({pendingOrders.length})</h3>
        {pendingOrders.length === 0 ? (
          <p className="text-zinc-600 text-sm">{isSearching ? 'No pending orders match your search' : 'No pending orders'}</p>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} onDelete={deleteOrder} />
            ))}
          </div>
        )}
      </div>

      {/* Completed Orders */}
      {completedOrders.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-400">
            Completed Orders ({completedOrders.length}){!isSearching && completedOrders.length > 5 && <span className="text-zinc-600"> — showing last 5</span>}
          </h3>
          <div className="space-y-3">
            {(isSearching ? completedOrders.slice() : completedOrders.slice(-5)).reverse().map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} onDelete={deleteOrder} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
