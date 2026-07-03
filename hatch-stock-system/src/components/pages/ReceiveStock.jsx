import React, { useEffect, useRef, useState } from 'react';
import { useStock } from '../../context/StockContext';
import BarcodeScanner from '../scanner/BarcodeScanner';
import { productsService } from '../../services/products.service';
import { ordersService } from '../../services/orders.service';
import { unlockAudio } from '../../utils/feedback';

// A "lot" is one receiving line for a SKU — its own qty + expiry + damage.
// Multiple lots per SKU let one delivery carry several expiry dates.
const emptyLot = (quantity = 0) => ({
  quantity,
  expiryDate: '',
  hasDamage: false,
  damageNotes: '',
});

// Units still expected on an order line (backend tracks receivedQty).
const getRemaining = (item) => Math.max(0, (item.quantity || 0) - (item.receivedQty || 0));

const lotSum = (lots) => (lots || []).reduce((sum, lot) => sum + (lot.quantity || 0), 0);

// Fresh-meal ORDER placeholder lines ("40 × Meat — rotating menu"). The
// weekly menu means the PO couldn't name flavours; at receiving the operator
// allocates the placeholder's quantity to the ACTUAL flavour SKUs in the box
// (each with its own expiry), sent to the backend as `forSku` lines.
const FRESH_MEAL_PLACEHOLDER_CATEGORY = 'Fresh Meal Order';

const emptyFlavourLot = (quantity = 0) => ({
  ...emptyLot(quantity),
  actualSku: '',
  actualName: '',
  isNew: false,
});

export default function ReceiveStock() {
  const { data, receiveOrder } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('receive');
  const [selectedOrder, setSelectedOrder] = useState(null);
  // { sku: [lot, lot, ...] } — index 0 is the main row, extras are split lots
  const [receivedItems, setReceivedItems] = useState({});
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  // Bulk "apply expiry to all" date
  const [bulkExpiry, setBulkExpiry] = useState('');
  // What to do when the delivery is short: keep the order open (default)
  // or close it short and write off the undelivered units.
  const [shortAction, setShortAction] = useState('keepOpen');
  // Soft-block acknowledgement for receiving lines without an expiry date —
  // FEFO picking and expiry tracking can't cover dateless batches.
  const [noExpiryAck, setNoExpiryAck] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Handle to BarcodeScanner.flash() — set on overlay mount via onReady.
  const scannerApiRef = useRef(null);
  // Latest receivedItems ref so the async scan handler doesn't read stale
  // state when the user scans many items in quick succession.
  const receivedItemsRef = useRef(receivedItems);
  useEffect(() => { receivedItemsRef.current = receivedItems; }, [receivedItems]);
  // Snapshot of received quantities taken when the scanner opens, so we
  // can restore them if the user opens scan-mode by mistake (we zero
  // quantities on open so scanning counts up from 0).
  const [preScanSnapshot, setPreScanSnapshot] = useState(null);
  const [scansThisSession, setScansThisSession] = useState(0);

  // Receipt History — loaded from the API when the tab is opened
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsError, setReceiptsError] = useState(null);
  const [expandedReceipts, setExpandedReceipts] = useState({});

  const pendingOrders = data.orders.filter(o => o.status === 'pending');

  useEffect(() => {
    if (activeSubTab !== 'history') return;
    let cancelled = false;
    setReceiptsLoading(true);
    setReceiptsError(null);
    ordersService.getReceipts(50)
      .then(result => {
        if (!cancelled) setReceipts(Array.isArray(result) ? result : []);
      })
      .catch(err => {
        if (!cancelled) setReceiptsError(err.message || 'Failed to load receipt history');
      })
      .finally(() => {
        if (!cancelled) setReceiptsLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeSubTab]);

  // Placeholder detection uses the order item's included product category,
  // falling back to the shared catalogue.
  const isPlaceholderItem = (item) =>
    (item.product?.category || data.products.find(p => p.sku === item.sku)?.category)
      === FRESH_MEAL_PLACEHOLDER_CATEGORY;

  const placeholderMealType = (sku) =>
    data.products.find(p => p.sku === sku)?.mealType || null;

  // Flavour choices for an allocation: fresh meals of the placeholder's meal
  // type (all fresh meals when the type is unknown).
  const flavourOptions = (orderSku) => {
    const mealType = placeholderMealType(orderSku);
    return data.products.filter(p => p.isFreshMeal && (!mealType || p.mealType === mealType));
  };

  const selectOrder = (order) => {
    setSelectedOrder(order);
    // For orders with a warehouse, pre-select it. For custom address, user must choose
    setReceiveWarehouseId(order.warehouseId || '');
    const items = {};
    order.items.forEach(item => {
      // Default "receiving now" to what's still outstanding on the line.
      // Placeholder lines start EMPTY — nothing is booked until the operator
      // allocates the flavours actually found in the box.
      items[item.sku] = isPlaceholderItem(item) ? [] : [emptyLot(getRemaining(item))];
    });
    setReceivedItems(items);
    setBulkExpiry('');
    setShortAction('keepOpen');
    setNoExpiryAck(false);
    setError(null);
    setSuccess(null);
  };

  const updateLot = (sku, lotIdx, field, value) => {
    setReceivedItems(prev => ({
      ...prev,
      [sku]: (prev[sku] || []).map((lot, i) => i === lotIdx ? { ...lot, [field]: value } : lot),
    }));
  };

  const updateLotFields = (sku, lotIdx, patch) => {
    setReceivedItems(prev => ({
      ...prev,
      [sku]: (prev[sku] || []).map((lot, i) => i === lotIdx ? { ...lot, ...patch } : lot),
    }));
  };

  const addLot = (sku) => {
    const orderItem = selectedOrder?.items.find(i => i.sku === sku);
    const remaining = orderItem ? getRemaining(orderItem) : 0;
    setReceivedItems(prev => {
      const lots = prev[sku] || [];
      // New lot defaults to whatever isn't yet allocated across other lots
      const leftover = Math.max(0, remaining - lotSum(lots));
      return { ...prev, [sku]: [...lots, emptyLot(leftover)] };
    });
  };

  const removeLot = (sku, lotIdx) => {
    setReceivedItems(prev => ({
      ...prev,
      [sku]: (prev[sku] || []).filter((_, i) => i !== lotIdx),
    }));
  };

  // Add a flavour allocation row against a placeholder order line.
  const addFlavourLot = (sku) => {
    const orderItem = selectedOrder?.items.find(i => i.sku === sku);
    const remaining = orderItem ? getRemaining(orderItem) : 0;
    setReceivedItems(prev => {
      const lots = prev[sku] || [];
      const leftover = Math.max(0, remaining - lotSum(lots));
      return { ...prev, [sku]: [...lots, emptyFlavourLot(leftover)] };
    });
  };

  // Fill every currently-empty expiry field (all lots) with the bulk date
  const applyExpiryToAll = () => {
    if (!bulkExpiry) return;
    setReceivedItems(prev => {
      const next = {};
      Object.keys(prev).forEach(sku => {
        next[sku] = prev[sku].map(lot => lot.expiryDate ? lot : { ...lot, expiryDate: bulkExpiry });
      });
      return next;
    });
  };

  // Open the scanner against the current order. Quantities are reset to 0
  // so the user counts each item by scanning. We snapshot first so the
  // close handler can restore the previous (pre-fill) state if no scans
  // happened — which happens when the user taps Scan by mistake.
  const openScanForOrder = () => {
    if (!selectedOrder) return;
    // Must run inside the synchronous user-gesture call stack — iOS only
    // permits AudioContext.resume() from within a tap handler, not from
    // useEffect that runs after the render commits.
    unlockAudio();
    setPreScanSnapshot(receivedItems);
    setReceivedItems(prev => {
      const next = {};
      Object.keys(prev).forEach(sku => {
        next[sku] = prev[sku].map(lot => ({ ...lot, quantity: 0 }));
      });
      return next;
    });
    setScansThisSession(0);
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    // If the user opened the scanner but didn't actually scan anything,
    // restore their previous quantities so we don't silently zero a PO
    // that was about to be confirmed manually.
    if (scansThisSession === 0 && preScanSnapshot) {
      setReceivedItems(preScanSnapshot);
    }
    setPreScanSnapshot(null);
    setScansThisSession(0);
  };

  // Called once per accepted scan from the camera overlay.
  // - Looks up the product by barcode (with SKU fallback)
  // - If the product is on the selected PO, +1 received qty and green flash
  //   (capped at the REMAINING quantity — ordered minus already received)
  // - If the product exists but isn't on the PO, yellow flash (no auto-add)
  // - If unknown / network error, red flash
  const handleScan = async (code) => {
    if (!selectedOrder) return;
    const flash = scannerApiRef.current?.flash;
    try {
      const result = await productsService.lookupBarcode(code);
      if (!result) {
        flash?.({ kind: 'error', message: 'No product found', detail: code });
        return;
      }
      const { product } = result;
      const orderItem = selectedOrder.items.find(i => i.sku === product.sku);
      if (!orderItem) {
        flash?.({
          kind: 'warn',
          message: 'Not on this order',
          detail: product.name || product.sku,
        });
        return;
      }
      // Cap at REMAINING (ordered minus already received) to avoid silent
      // over-receipt — the backend rejects over-receiving with a 400.
      const remaining = getRemaining(orderItem);
      if (remaining <= 0) {
        flash?.({
          kind: 'warn',
          message: 'Already fully received',
          detail: product.name || product.sku,
        });
        return;
      }
      // Compute the next quantity from the ref (always current) BEFORE
      // calling the setter, so the flash feedback below can't read a
      // stale value assigned inside the updater.
      const currentItems = receivedItemsRef.current;
      const lots = (currentItems[product.sku] || [emptyLot(0)]).map(l => ({ ...l }));
      const otherLotsSum = lots.slice(1).reduce((sum, l) => sum + (l.quantity || 0), 0);
      const currentTotal = (lots[0].quantity || 0) + otherLotsSum;
      const appliedTotal = Math.min(currentTotal + 1, remaining);
      lots[0].quantity = Math.max(0, appliedTotal - otherLotsSum);
      const nextItems = { ...currentItems, [product.sku]: lots };
      // Update the ref synchronously so a rapid follow-up scan sees this
      // quantity even before React commits the state update.
      receivedItemsRef.current = nextItems;
      setReceivedItems(nextItems);
      setScansThisSession(n => n + 1);
      const atCap = appliedTotal >= remaining;
      flash?.({
        kind: atCap ? 'warn' : 'success',
        message: product.name || product.sku,
        detail: atCap ? `${appliedTotal}/${remaining} — at remaining max` : `${appliedTotal}/${remaining}`,
      });
    } catch (err) {
      flash?.({
        kind: 'error',
        message: 'Lookup failed',
        detail: err.message || 'Network error',
      });
    }
  };

  // ----- Derived validation / summary state for the selected order -----
  const orderLineState = selectedOrder ? selectedOrder.items.map(item => {
    const remaining = getRemaining(item);
    const lots = receivedItems[item.sku] || [];
    const receivingNow = lotSum(lots);
    const placeholder = isPlaceholderItem(item);
    return {
      item,
      remaining,
      lots,
      receivingNow,
      placeholder,
      // A flavour allocation with units needs a flavour: picked from the
      // catalogue, or a new sku (+ name) typed for a menu item we've not seen.
      allocationIncomplete: placeholder && lots.some(lot =>
        (lot.quantity || 0) > 0 &&
        (!lot.actualSku?.trim() || (lot.isNew && !lot.actualName?.trim()))
      ),
      over: receivingNow > remaining,
      short: remaining > 0 && receivingNow < remaining,
    };
  }) : [];

  const hasAllocationError = orderLineState.some(l => l.allocationIncomplete);
  const hasOverError = orderLineState.some(l => l.over);
  const anyShort = orderLineState.some(l => l.short);
  const totalReceivingNow = orderLineState.reduce((sum, l) => sum + l.receivingNow, 0);
  const totalShortUnits = orderLineState.reduce((sum, l) => sum + (l.short ? l.remaining - l.receivingNow : 0), 0);
  // Receiving lines (lots with units) that carry no expiry date — nagged at
  // review time with a soft acknowledgement, never a hard stop.
  const missingExpiryLines = orderLineState.reduce(
    (acc, l) => acc + l.lots.filter(lot => (lot.quantity || 0) > 0 && !lot.expiryDate).length,
    0
  );
  const needsExpiryAck = missingExpiryLines > 0 && !noExpiryAck;

  const confirmReceive = async () => {
    if (!selectedOrder || !receiveWarehouseId || hasOverError || hasAllocationError
      || totalReceivingNow <= 0 || needsExpiryAck) return;

    setLoading(true);
    setError(null);

    try {
      // One line per lot with qty > 0 (multiple lines per SKU allowed —
      // one per expiry lot). Placeholder allocations book under the ACTUAL
      // flavour sku while counting against the placeholder line via forSku.
      const lines = [];
      selectedOrder.items.forEach(item => {
        const placeholder = isPlaceholderItem(item);
        (receivedItems[item.sku] || []).forEach(lot => {
          if ((lot.quantity || 0) > 0) {
            lines.push(placeholder
              ? {
                sku: lot.actualSku.trim(),
                forSku: item.sku,
                ...(lot.isNew && lot.actualName?.trim() ? { name: lot.actualName.trim() } : {}),
                quantity: lot.quantity,
                expiryDate: lot.expiryDate || null,
                hasDamage: !!lot.hasDamage,
                damageNotes: lot.damageNotes || '',
              }
              : {
                sku: item.sku,
                quantity: lot.quantity,
                expiryDate: lot.expiryDate || null,
                hasDamage: !!lot.hasDamage,
                damageNotes: lot.damageNotes || '',
              });
          }
        });
      });

      const closeShort = anyShort && shortAction === 'closeShort';
      await receiveOrder(selectedOrder.id, lines, receiveWarehouseId, { closeShort });

      setSuccess({
        units: totalReceivingNow,
        lines: lines.length,
        supplierName: getSupplierName(selectedOrder.supplierId),
        warehouseName: getWarehouseName(receiveWarehouseId),
        outcome: !anyShort ? 'complete' : (closeShort ? 'closedShort' : 'open'),
        shortUnits: totalShortUnits,
      });
      setSelectedOrder(null);
      setReceivedItems({});
    } catch (err) {
      setError(err.message || 'Failed to receive order');
    } finally {
      setLoading(false);
    }
  };

  const getWarehouseName = (id) => data.warehouses.find(w => w.id === id)?.name || id;
  const getSupplierName = (id) => data.suppliers.find(s => s.id === id)?.name || id;
  const getProductName = (sku) => data.products.find(p => p.sku === sku)?.name || sku;

  // Calculate expiry status: <=7 days red, 8-30 days amber, >30 days green
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { status: 'expired', label: 'Expired', color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 7) return { status: 'critical', label: `${daysUntil}d left`, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 30) return { status: 'warning', label: `${daysUntil}d left`, color: 'text-amber-400 bg-amber-500/20' };
    return { status: 'ok', label: `${daysUntil}d left`, color: 'text-emerald-400 bg-emerald-500/20' };
  };

  const inputClass = 'w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm focus:outline-none focus:border-emerald-500';

  const renderDamageToggle = (sku, lotIdx, lot) => (
    <button
      onClick={() => updateLot(sku, lotIdx, 'hasDamage', !lot.hasDamage)}
      title={lot.hasDamage ? 'Mark as undamaged' : 'Mark as damaged'}
      className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
        lot.hasDamage
          ? 'bg-red-500/20 text-red-400 border border-red-500/50'
          : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600'
      }`}
    >
      {lot.hasDamage ? 'X' : '-'}
    </button>
  );

  const renderDamageNotes = (sku, lotIdx, lot) => (
    <input
      type="text"
      value={lot.damageNotes || ''}
      onChange={e => updateLot(sku, lotIdx, 'damageNotes', e.target.value)}
      placeholder={lot.hasDamage ? 'Describe damage...' : ''}
      disabled={!lot.hasDamage}
      className={`${inputClass} ${!lot.hasDamage ? 'opacity-50' : ''}`}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Receive Stock</h2>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'receive', label: 'Receive Orders' },
          { id: 'history', label: 'Receipt History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveSubTab(tab.id); setSelectedOrder(null); setSuccess(null); }}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'receive' && (
        <>
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 flex items-start justify-between gap-4">
              <div className="text-sm">
                <div className="text-emerald-400">
                  Booked in {success.units} unit{success.units === 1 ? '' : 's'} across {success.lines} line{success.lines === 1 ? '' : 's'} from {success.supplierName} into {success.warehouseName}.
                </div>
                <div className="text-zinc-400 mt-1">
                  {success.outcome === 'complete' && 'Order fully received.'}
                  {success.outcome === 'open' && `Order kept open — ${success.shortUnits} unit${success.shortUnits === 1 ? '' : 's'} still expected.`}
                  {success.outcome === 'closedShort' && `Order closed short — ${success.shortUnits} undelivered unit${success.shortUnits === 1 ? '' : 's'} written off.`}
                </div>
              </div>
              <button onClick={() => setSuccess(null)} className="text-zinc-500 hover:text-zinc-300 text-sm shrink-0">
                Dismiss
              </button>
            </div>
          )}

          {!selectedOrder ? (
            <div className="space-y-4">
              <p className="text-zinc-500 text-sm">Select an order to check in:</p>
              {pendingOrders.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
                  <p className="text-zinc-500">No pending orders to receive</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingOrders.map(order => {
                    const deliveryMethodLabels = { standard: 'Standard', match: 'Match Delivery', pickup: 'Pick Up' };
                    const orderedUnits = order.items.reduce((sum, it) => sum + (it.quantity || 0), 0);
                    const receivedUnits = order.items.reduce((sum, it) => sum + Math.min(it.receivedQty || 0, it.quantity || 0), 0);
                    return (
                      <button
                        key={order.id}
                        onClick={() => selectOrder(order)}
                        className="w-full text-left bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-emerald-500/50 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-zinc-200">{getSupplierName(order.supplierId)}</span>
                              {order.deliveryMethod && (
                                <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                                  {deliveryMethodLabels[order.deliveryMethod] || 'Standard'}
                                </span>
                              )}
                              {receivedUnits > 0 && (
                                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                                  Partially received &middot; {receivedUnits}/{orderedUnits} units
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-zinc-500 mt-1">
                              → {order.warehouseId ? getWarehouseName(order.warehouseId) : order.customAddress || 'Custom Address'}
                            </div>
                          </div>
                          <div className="sm:text-right">
                            <div className="text-sm text-zinc-400">{order.items.length} items</div>
                            {order.total > 0 && (
                              <div className="text-emerald-400 text-sm">£{order.total?.toFixed(2)}</div>
                            )}
                            <div className="text-xs text-zinc-600">{new Date(order.createdAt).toLocaleDateString('en-GB')}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 md:p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="font-medium text-zinc-200">Receiving: {getSupplierName(selectedOrder.supplierId)}</h3>
                  <p className="text-sm text-zinc-500">
                    Ordered to: {selectedOrder.warehouseId ? getWarehouseName(selectedOrder.warehouseId) : selectedOrder.customAddress}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={openScanForOrder}
                    disabled={!receiveWarehouseId}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!receiveWarehouseId ? 'Select a warehouse first' : 'Scan items into this order'}
                  >
                    Scan items
                  </button>
                  <button onClick={() => setSelectedOrder(null)} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
                </div>
              </div>

              {/* Warehouse selector for custom address orders */}
              {!selectedOrder.warehouseId && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <p className="text-emerald-400 text-sm mb-2">This order was delivered to a custom address. Select the warehouse to receive stock into:</p>
                  <select
                    value={receiveWarehouseId}
                    onChange={e => setReceiveWarehouseId(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select warehouse</option>
                    {data.warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {receiveWarehouseId && (
                <div className="text-sm text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
                  Stock will be received into: {getWarehouseName(receiveWarehouseId)}
                </div>
              )}

              {/* Apply expiry to all */}
              <div className="bg-zinc-800/40 rounded-lg p-3 flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 sm:max-w-xs">
                  <label className="block text-xs text-zinc-500 mb-1">Apply expiry to all</label>
                  <input
                    type="date"
                    value={bulkExpiry}
                    onChange={e => setBulkExpiry(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <button
                  onClick={applyExpiryToAll}
                  disabled={!bulkExpiry}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Fill empty expiry fields
                </button>
              </div>

              <div className="space-y-1">
                {/* Desktop column headers */}
                <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-3">Product</div>
                  <div className="col-span-1 text-center">Ordered</div>
                  <div className="col-span-1 text-center">Received</div>
                  <div className="col-span-2 text-center">Receiving now</div>
                  <div className="col-span-2 text-center">Expiry</div>
                  <div className="col-span-1 text-center">Damage?</div>
                  <div className="col-span-2">Damage Notes</div>
                </div>

                {orderLineState.map(({ item, remaining, lots, receivingNow, over, placeholder, allocationIncomplete }) => {
                  const product = data.products.find(p => p.sku === item.sku);

                  // Fresh-meal placeholder line: allocate the ordered quantity
                  // to the ACTUAL flavours found in the box.
                  if (placeholder) {
                    const options = flavourOptions(item.sku);
                    return (
                      <div key={item.sku} className="py-3 border-b border-zinc-800 last:border-0 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div>
                            <span className="text-zinc-200">{product?.name || item.sku}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300 ml-2">rotating menu</span>
                            <div className="text-zinc-600 text-xs">
                              Ordered {item.quantity} · already received {item.receivedQty || 0}
                            </div>
                          </div>
                          {remaining === 0 ? (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Fully received</span>
                          ) : (
                            <span className={`text-xs px-2 py-0.5 rounded ${receivingNow === remaining ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                              {receivingNow} of {remaining} allocated to flavours
                            </span>
                          )}
                        </div>

                        {remaining > 0 && lots.map((lot, lotIdx) => (
                          <div key={lotIdx} className="bg-zinc-800/30 rounded p-2 space-y-2">
                            <div className="grid grid-cols-2 gap-2 md:grid-cols-12 md:items-center">
                              <div className="col-span-2 md:col-span-4">
                                <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Flavour</div>
                                <select
                                  value={lot.isNew ? '__new__' : (lot.actualSku || '')}
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (v === '__new__') {
                                      updateLotFields(item.sku, lotIdx, { isNew: true, actualSku: '', actualName: '' });
                                    } else {
                                      const chosen = options.find(o => o.sku === v);
                                      updateLotFields(item.sku, lotIdx, { isNew: false, actualSku: v, actualName: chosen?.name || '' });
                                    }
                                  }}
                                  className={`${inputClass} ${(lot.quantity || 0) > 0 && !lot.actualSku && !lot.isNew ? 'border-amber-500' : ''}`}
                                >
                                  <option value="">Choose flavour…</option>
                                  {options.map(o => (
                                    <option key={o.sku} value={o.sku}>{o.name}</option>
                                  ))}
                                  <option value="__new__">+ New flavour (not in catalogue yet)</option>
                                </select>
                              </div>
                              <div className="md:col-span-2">
                                <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Qty</div>
                                <input
                                  type="number"
                                  min="0"
                                  value={lot.quantity || ''}
                                  onChange={e => {
                                    const parsed = parseInt(e.target.value, 10) || 0;
                                    updateLot(item.sku, lotIdx, 'quantity', Math.max(parsed, 0));
                                  }}
                                  className={`${inputClass} text-center ${over ? 'border-red-500 focus:border-red-500' : ''}`}
                                />
                              </div>
                              <div className="md:col-span-2">
                                <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Expiry</div>
                                <input
                                  type="date"
                                  value={lot.expiryDate || ''}
                                  onChange={e => updateLot(item.sku, lotIdx, 'expiryDate', e.target.value)}
                                  className={inputClass}
                                />
                              </div>
                              <div className="md:col-span-1 flex md:justify-center items-center gap-2">
                                <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage?</div>
                                {renderDamageToggle(item.sku, lotIdx, lot)}
                              </div>
                              <div className="md:col-span-2">
                                <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage notes</div>
                                {renderDamageNotes(item.sku, lotIdx, lot)}
                              </div>
                              <div className="md:col-span-1 md:text-right">
                                <button
                                  onClick={() => removeLot(item.sku, lotIdx)}
                                  className="text-xs text-zinc-500 hover:text-red-400"
                                >
                                  remove
                                </button>
                              </div>
                            </div>
                            {lot.isNew && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  placeholder="New SKU (from the label)"
                                  value={lot.actualSku}
                                  onChange={e => updateLot(item.sku, lotIdx, 'actualSku', e.target.value)}
                                  className={`${inputClass} ${(lot.quantity || 0) > 0 && !lot.actualSku?.trim() ? 'border-amber-500' : ''}`}
                                />
                                <input
                                  type="text"
                                  placeholder="Flavour name"
                                  value={lot.actualName}
                                  onChange={e => updateLot(item.sku, lotIdx, 'actualName', e.target.value)}
                                  className={`${inputClass} ${(lot.quantity || 0) > 0 && !lot.actualName?.trim() ? 'border-amber-500' : ''}`}
                                />
                              </div>
                            )}
                          </div>
                        ))}

                        {remaining > 0 && (
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <button
                              onClick={() => addFlavourLot(item.sku)}
                              className="text-xs text-emerald-400 hover:text-emerald-300"
                            >
                              + Add flavour
                            </button>
                            {over && (
                              <div className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                                Allocated {receivingNow} exceeds the {remaining} remaining on this line.
                              </div>
                            )}
                            {allocationIncomplete && (
                              <div className="text-xs text-amber-400 bg-amber-500/10 px-2 py-1 rounded">
                                Every allocation with units needs a flavour (and a name for new ones).
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  }

                  const mainLot = lots[0] || emptyLot(0);
                  return (
                    <div key={item.sku} className="py-3 border-b border-zinc-800 last:border-0 space-y-2">
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-12 md:items-center">
                        <div className="col-span-2 md:col-span-3">
                          <span className="text-zinc-200">{product?.name || item.sku}</span>
                          <div className="text-zinc-600 text-xs">{item.sku}</div>
                        </div>
                        <div className="md:col-span-1 md:text-center">
                          <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Ordered</div>
                          <span className="text-sm text-zinc-300">{item.quantity}</span>
                        </div>
                        <div className="md:col-span-1 md:text-center">
                          <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Already received</div>
                          <span className={`text-sm ${(item.receivedQty || 0) > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                            {item.receivedQty || 0}
                          </span>
                        </div>
                        {remaining === 0 ? (
                          <div className="col-span-2 md:col-span-7">
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                              Fully received
                            </span>
                          </div>
                        ) : (
                          <>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Receiving now</div>
                              <input
                                type="number"
                                min="0"
                                value={mainLot.quantity || ''}
                                onChange={e => {
                                  const parsed = parseInt(e.target.value, 10) || 0;
                                  updateLot(item.sku, 0, 'quantity', Math.max(parsed, 0));
                                }}
                                className={`${inputClass} text-center ${over ? 'border-red-500 focus:border-red-500' : ''}`}
                              />
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Expiry</div>
                              <input
                                type="date"
                                value={mainLot.expiryDate || ''}
                                onChange={e => updateLot(item.sku, 0, 'expiryDate', e.target.value)}
                                className={inputClass}
                              />
                            </div>
                            <div className="md:col-span-1 flex md:justify-center items-center gap-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage?</div>
                              {renderDamageToggle(item.sku, 0, mainLot)}
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage notes</div>
                              {renderDamageNotes(item.sku, 0, mainLot)}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Split lots (index >= 1) */}
                      {remaining > 0 && lots.slice(1).map((lot, i) => {
                        const lotIdx = i + 1;
                        return (
                          <div key={lotIdx} className="grid grid-cols-2 gap-2 md:grid-cols-12 md:items-center bg-zinc-800/30 rounded p-2 md:bg-transparent md:p-0 md:rounded-none">
                            <div className="col-span-2 md:col-span-3 flex items-center gap-2 md:pl-4">
                              <span className="text-xs text-zinc-500">Lot {lotIdx + 1}</span>
                              <button
                                onClick={() => removeLot(item.sku, lotIdx)}
                                className="text-xs text-zinc-500 hover:text-red-400"
                                title="Remove this lot"
                              >
                                remove
                              </button>
                            </div>
                            <div className="hidden md:block md:col-span-2" />
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Qty</div>
                              <input
                                type="number"
                                min="0"
                                value={lot.quantity || ''}
                                onChange={e => {
                                  const parsed = parseInt(e.target.value, 10) || 0;
                                  updateLot(item.sku, lotIdx, 'quantity', Math.max(parsed, 0));
                                }}
                                className={`${inputClass} text-center ${over ? 'border-red-500 focus:border-red-500' : ''}`}
                              />
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Expiry</div>
                              <input
                                type="date"
                                value={lot.expiryDate || ''}
                                onChange={e => updateLot(item.sku, lotIdx, 'expiryDate', e.target.value)}
                                className={inputClass}
                              />
                            </div>
                            <div className="md:col-span-1 flex md:justify-center items-center gap-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage?</div>
                              {renderDamageToggle(item.sku, lotIdx, lot)}
                            </div>
                            <div className="md:col-span-2">
                              <div className="text-[10px] uppercase tracking-wide text-zinc-500 md:hidden">Damage notes</div>
                              {renderDamageNotes(item.sku, lotIdx, lot)}
                            </div>
                          </div>
                        );
                      })}

                      {remaining > 0 && (
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <button
                            onClick={() => addLot(item.sku)}
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                            title="Add another expiry lot for this product"
                          >
                            + Split lot
                          </button>
                          {over && (
                            <div className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
                              Receiving {receivingNow} exceeds the {remaining} remaining on this line. Reduce lot quantities.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Under-delivery choice */}
              {anyShort && !hasOverError && totalReceivingNow > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                  <div className="text-amber-400 text-sm font-medium">
                    This delivery is {totalShortUnits} unit{totalShortUnits === 1 ? '' : 's'} short of what's outstanding. What should happen to the rest?
                  </div>
                  <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
                    <input
                      type="radio"
                      name="shortAction"
                      checked={shortAction === 'keepOpen'}
                      onChange={() => setShortAction('keepOpen')}
                      className="mt-0.5 accent-emerald-500"
                    />
                    <span>
                      Keep order open for the remainder <span className="text-zinc-500">(default)</span>
                      <span className="block text-xs text-zinc-500">The order stays pending and the missing units can be received later.</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
                    <input
                      type="radio"
                      name="shortAction"
                      checked={shortAction === 'closeShort'}
                      onChange={() => setShortAction('closeShort')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <span>
                      Close short — write off the undelivered units
                      <span className="block text-xs text-zinc-500">The order is closed now and the missing units will not be received.</span>
                    </span>
                  </label>
                </div>
              )}

              {/* Missing-expiry nag — soft block with acknowledgement */}
              {missingExpiryLines > 0 && totalReceivingNow > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                  <div className="text-amber-400 text-sm font-medium">
                    {missingExpiryLines} line{missingExpiryLines === 1 ? ' has' : 's have'} no
                    expiry date — expiry tracking and FEFO picking won't cover
                    {missingExpiryLines === 1 ? ' it' : ' them'}
                  </div>
                  <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={noExpiryAck}
                      onChange={e => setNoExpiryAck(e.target.checked)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <span>
                      Receive without expiry dates
                      <span className="block text-xs text-zinc-500">
                        Tick to confirm, or add dates above (the "Apply expiry to all" shortcut fills
                        every empty field).
                      </span>
                    </span>
                  </label>
                </div>
              )}

              {/* Summary before confirmation */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-sm text-zinc-400 mb-2">Receipt Summary</div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  <span className="text-zinc-300">
                    Receiving now: {totalReceivingNow} units
                  </span>
                  <span className="text-zinc-300">
                    Lots with expiry: {orderLineState.reduce((acc, l) => acc + l.lots.filter(lot => (lot.quantity || 0) > 0 && lot.expiryDate).length, 0)}
                  </span>
                  {orderLineState.some(l => l.lots.some(lot => lot.hasDamage)) && (
                    <span className="text-red-400">
                      Damaged lots: {orderLineState.reduce((acc, l) => acc + l.lots.filter(lot => lot.hasDamage).length, 0)}
                    </span>
                  )}
                  {anyShort && (
                    <span className="text-amber-400">
                      Short by {totalShortUnits} units
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={confirmReceive}
                disabled={!receiveWarehouseId || loading || hasOverError || hasAllocationError || totalReceivingNow <= 0 || needsExpiryAck}
                className="w-full sm:w-auto px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  hasOverError
                    ? 'Fix lot quantities that exceed the remaining amount'
                    : needsExpiryAck
                      ? 'Add expiry dates or tick "Receive without expiry dates"'
                      : undefined
                }
              >
                {loading ? 'Receiving...' : 'Confirm Receipt'}
              </button>
            </div>
          )}
        </>
      )}

      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {receiptsLoading ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
              <p className="text-zinc-500">Loading receipt history…</p>
            </div>
          ) : receiptsError ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
              {receiptsError}
            </div>
          ) : receipts.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
              <p className="text-zinc-500">No receipts recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {receipts.map(receipt => {
                const expanded = !!expandedReceipts[receipt.id];
                const supplierName = receipt.order?.supplier?.name || 'Unknown supplier';
                const orderRef = String(receipt.orderId || receipt.order?.id || '').slice(-6).toUpperCase();
                const created = receipt.createdAt ? new Date(receipt.createdAt) : null;
                const unitCount = (receipt.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
                return (
                  <div key={receipt.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setExpandedReceipts(prev => ({ ...prev, [receipt.id]: !prev[receipt.id] }))}
                      className="w-full text-left p-4 hover:bg-zinc-800/40 transition-colors"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-zinc-200">{supplierName}</span>
                            {orderRef && (
                              <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                                Order {orderRef}
                              </span>
                            )}
                            {receipt.closedShort && (
                              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                                Closed short
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-zinc-500 mt-1">
                            to {getWarehouseName(receipt.warehouseId)}
                            {receipt.receivedBy ? ` · by ${receipt.receivedBy}` : ''}
                            {` · ${unitCount} units, ${(receipt.items || []).length} lines`}
                          </div>
                        </div>
                        <div className="sm:text-right shrink-0">
                          {created && (
                            <>
                              <div className="text-sm text-zinc-400">{created.toLocaleDateString('en-GB')}</div>
                              <div className="text-xs text-zinc-600">{created.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                            </>
                          )}
                          <div className="text-xs text-emerald-400 mt-1">{expanded ? 'Hide items ▲' : 'Show items ▼'}</div>
                        </div>
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-zinc-800 p-4 pt-3">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-zinc-500 text-xs">
                                <th className="text-left pb-2">Product</th>
                                <th className="text-center pb-2">Qty</th>
                                <th className="text-center pb-2">Expiry</th>
                                <th className="text-center pb-2">Condition</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(receipt.items || []).map((item, idx) => {
                                const expiryStatus = getExpiryStatus(item.expiryDate);
                                return (
                                  <tr key={idx} className="border-t border-zinc-800/50">
                                    <td className="py-2 text-zinc-300">
                                      {getProductName(item.sku)}
                                      <div className="text-zinc-600 text-xs">{item.sku}</div>
                                    </td>
                                    <td className="py-2 text-center text-zinc-400">{item.quantity}</td>
                                    <td className="py-2 text-center">
                                      {item.expiryDate ? (
                                        <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${expiryStatus?.color || ''}`}>
                                          {new Date(item.expiryDate).toLocaleDateString('en-GB')}
                                        </span>
                                      ) : (
                                        <span className="text-zinc-600 text-xs">-</span>
                                      )}
                                    </td>
                                    <td className="py-2 text-center">
                                      {item.hasDamage ? (
                                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={item.damageNotes}>
                                          Damaged
                                        </span>
                                      ) : (
                                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                                          OK
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {(receipt.items || []).some(it => it.hasDamage && it.damageNotes) && (
                          <div className="mt-3 pt-3 border-t border-zinc-800 space-y-1">
                            {(receipt.items || []).filter(it => it.hasDamage && it.damageNotes).map((it, idx) => (
                              <div key={idx} className="text-xs text-red-400">
                                {getProductName(it.sku)}: {it.damageNotes}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <BarcodeScanner
        open={scannerOpen}
        title={selectedOrder ? `Receiving: ${getSupplierName(selectedOrder.supplierId)}` : 'Scan barcode'}
        onScan={handleScan}
        onClose={closeScanner}
        onReady={(api) => { scannerApiRef.current = api; }}
      />
    </div>
  );
}
