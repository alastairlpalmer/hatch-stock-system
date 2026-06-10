import React, { useRef, useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';
import { useRestockRun } from '../../context/RestockRunContext';
import BarcodeScanner from '../scanner/BarcodeScanner';
import { productsService } from '../../services/products.service';
import { unlockAudio } from '../../utils/feedback';

export default function RemoveStock() {
  const { data, recordStockRemoval } = useStock();
  const { selectedRouteId, setSelectedRouteId, markStepComplete } = useRestockRun();
  const [form, setForm] = useState({
    fromWarehouse: '',
    routeId: selectedRouteId || '',
    takenBy: '',
    notes: '',
    items: [{ sku: '', quantity: '' }]
  });
  const [scannerOpen, setScannerOpen] = useState(false);
  // Latest form ref so the scan handler doesn't have stale state when
  // the user scans many items in quick succession.
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  const scannerApiRef = useRef(null);

  useEffect(() => {
    if (selectedRouteId && form.routeId !== selectedRouteId) {
      setForm((prev) => ({ ...prev, routeId: selectedRouteId, items: [{ sku: '', quantity: '' }] }));
    }
  }, [selectedRouteId]);
  const [warnings, setWarnings] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const availableStock = form.fromWarehouse ? (data.stock[form.fromWarehouse] || {}) : {};
  const routes = data.restockRoutes || [];
  const selectedRoute = routes.find(r => r.id === form.routeId);
  const isAdhocRoute = selectedRoute?.type === 'adhoc';

  // Get all locations in the selected route
  const getRouteLocations = () => {
    if (!selectedRoute) return [];
    if (isAdhocRoute) return [];
    const locationIds = selectedRoute.locationIds || [];
    return locationIds.map(locId => data.locations.find(l => l.id === locId)).filter(Boolean);
  };

  // Get assigned products for all locations in route
  const getRouteAssignedProducts = () => {
    const routeLocations = getRouteLocations();
    if (routeLocations.length === 0) return null;
    const allAssigned = new Set();
    routeLocations.forEach(loc => {
      (loc.assignedItems || []).forEach(sku => allAssigned.add(sku));
    });
    return allAssigned.size > 0 ? Array.from(allAssigned) : null;
  };

  // Calculate max capacity for a product across route locations
  const getRouteMaxCapacity = (sku) => {
    if (isAdhocRoute) return Infinity;
    const routeLocations = getRouteLocations();
    let totalMax = 0;
    routeLocations.forEach(loc => {
      const config = data.locationConfig?.[loc.id]?.[sku];
      if (config?.maxStock) {
        totalMax += config.maxStock;
      }
    });
    return totalMax;
  };

  // Calculate current stock at route locations
  const getRouteCurrentStock = (sku) => {
    if (isAdhocRoute) return 0;
    const routeLocations = getRouteLocations();
    let totalCurrent = 0;
    routeLocations.forEach(loc => {
      totalCurrent += data.locationStock?.[loc.id]?.[sku] || 0;
    });
    return totalCurrent;
  };

  // Calculate available space in route locations
  const getRouteAvailableSpace = (sku) => {
    const maxCapacity = getRouteMaxCapacity(sku);
    if (maxCapacity === 0) return Infinity;
    const currentStock = getRouteCurrentStock(sku);
    return Math.max(0, maxCapacity - currentStock);
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { sku: '', quantity: '' }] });

  const updateItem = (idx, field, value) => {
    // Compute the next items array first (without mutating current state),
    // then use it for both the state update and the capacity-warning check
    // so the warning never reads stale values.
    const items = form.items.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    );
    setForm({ ...form, items });

    // Check capacity warning when quantity changes
    if (field === 'quantity' || field === 'sku') {
      const sku = items[idx].sku;
      const qty = parseInt(items[idx].quantity) || 0;

      if (sku && qty > 0 && !isAdhocRoute) {
        const availableSpace = getRouteAvailableSpace(sku);
        if (availableSpace !== Infinity && qty > availableSpace) {
          setWarnings(prev => ({ ...prev, [idx]: { sku, qty, availableSpace, maxCapacity: getRouteMaxCapacity(sku) } }));
        } else {
          setWarnings(prev => {
            const newWarnings = { ...prev };
            delete newWarnings[idx];
            return newWarnings;
          });
        }
      } else {
        setWarnings(prev => {
          const newWarnings = { ...prev };
          delete newWarnings[idx];
          return newWarnings;
        });
      }
    }
  };

  // Called once per accepted scan from the camera overlay.
  // - Looks up the product by barcode (SKU fallback)
  // - Verifies stock is available in the selected warehouse
  // - For non-adhoc routes, warns when the SKU isn't on the route's location
  // - Bumps an existing line for that SKU if present, else appends a new line
  // - Mirrors updateItem's capacity-warning logic so scan-added rows
  //   get the same yellow capacity banner as manually-typed rows.
  const handleScan = async (code) => {
    const flash = scannerApiRef.current?.flash;
    const currentForm = formRef.current;
    if (!currentForm.fromWarehouse || !currentForm.routeId) {
      flash?.({ kind: 'warn', message: 'Pick warehouse + route first' });
      return;
    }
    try {
      const result = await productsService.lookupBarcode(code);
      if (!result) {
        flash?.({ kind: 'error', message: 'No product found', detail: code });
        return;
      }
      const { product } = result;
      const sku = product.sku;
      const stockQty = (data.stock?.[currentForm.fromWarehouse] || {})[sku] || 0;
      if (stockQty <= 0) {
        flash?.({
          kind: 'error',
          message: 'Out of stock at warehouse',
          detail: product.name || sku,
        });
        return;
      }
      const assigned = getRouteAssignedProducts();
      const offRoute = !isAdhocRoute && assigned && !assigned.includes(sku);

      // Bump existing matching line, else fill the first empty line, else append.
      // Computed from formRef (updated synchronously below) rather than inside
      // the setForm updater, so touchedIdx/touchedQty can't be read stale when
      // scans arrive in quick succession — same pattern as updateItem.
      const items = [...formRef.current.items];
      let touchedIdx = -1;
      let touchedQty = 0;
      const matchIdx = items.findIndex((i) => i.sku === sku);
      if (matchIdx >= 0) {
        const next = (parseInt(items[matchIdx].quantity, 10) || 0) + 1;
        const capped = Math.min(next, stockQty);
        items[matchIdx] = { ...items[matchIdx], quantity: String(capped) };
        touchedIdx = matchIdx;
        touchedQty = capped;
      } else {
        const emptyIdx = items.findIndex((i) => !i.sku);
        if (emptyIdx >= 0) {
          items[emptyIdx] = { sku, quantity: '1' };
          touchedIdx = emptyIdx;
        } else {
          items.push({ sku, quantity: '1' });
          touchedIdx = items.length - 1;
        }
        touchedQty = 1;
      }
      const nextForm = { ...formRef.current, items };
      formRef.current = nextForm;
      setForm(nextForm);

      if (touchedIdx >= 0 && !isAdhocRoute) {
        const availableSpace = getRouteAvailableSpace(sku);
        if (availableSpace !== Infinity && touchedQty > availableSpace) {
          setWarnings(prev => ({
            ...prev,
            [touchedIdx]: {
              sku,
              qty: touchedQty,
              availableSpace,
              maxCapacity: getRouteMaxCapacity(sku),
            },
          }));
        } else {
          setWarnings(prev => {
            if (!(touchedIdx in prev)) return prev;
            const next = { ...prev };
            delete next[touchedIdx];
            return next;
          });
        }
      }

      if (offRoute) {
        flash?.({
          kind: 'warn',
          message: 'Not on this route',
          detail: product.name || sku,
        });
      } else {
        flash?.({
          kind: 'success',
          message: product.name || sku,
          detail: `${touchedQty} / ${stockQty} avail`,
        });
      }
    } catch (err) {
      flash?.({ kind: 'error', message: 'Lookup failed', detail: err.message || 'Network error' });
    }
  };

  const removeItem = (idx) => {
    if (form.items.length > 1) {
      setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
      setWarnings(prev => {
        const newWarnings = { ...prev };
        delete newWarnings[idx];
        return newWarnings;
      });
    }
  };

  const submit = async () => {
    if (!form.fromWarehouse || !form.routeId || !form.takenBy || !form.items[0].sku) return;

    setLoading(true);
    setError(null);

    try {
      const routeLocations = getRouteLocations();
      const targetLocation = routeLocations[0]?.id || form.routeId;

      const itemsToRemove = form.items
        .filter(i => i.sku && parseInt(i.quantity) > 0)
        .map(item => ({
          sku: item.sku,
          quantity: parseInt(item.quantity)
        }));

      await recordStockRemoval({
        warehouseId: form.fromWarehouse,
        routeId: form.routeId,
        routeName: selectedRoute?.name,
        targetLocation: isAdhocRoute ? null : targetLocation,
        takenBy: form.takenBy,
        notes: form.notes,
        isAdhoc: isAdhocRoute,
        items: itemsToRemove
      });

      markStepComplete('remove');
      setForm({ fromWarehouse: '', routeId: selectedRouteId || '', takenBy: '', notes: '', items: [{ sku: '', quantity: '' }] });
      setWarnings({});
    } catch (err) {
      setError(err.message || 'Failed to remove stock');
    } finally {
      setLoading(false);
    }
  };

  const getAvailableProducts = () => {
    const stockItems = Object.entries(availableStock).filter(([_, q]) => q > 0);
    const assignedProducts = getRouteAssignedProducts();
    if (!assignedProducts) return stockItems;
    return stockItems.filter(([sku]) => assignedProducts.includes(sku));
  };

  const hasWarnings = Object.keys(warnings).length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Remove Stock</h2>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">From Warehouse</label>
            <select
              value={form.fromWarehouse}
              onChange={e => { setForm({ ...form, fromWarehouse: e.target.value, items: [{ sku: '', quantity: '' }] }); setWarnings({}); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select warehouse</option>
              {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Re-stock Route</label>
            <select
              value={form.routeId}
              onChange={e => { setForm({ ...form, routeId: e.target.value, items: [{ sku: '', quantity: '' }] }); setSelectedRouteId(e.target.value); setWarnings({}); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select route</option>
              <optgroup label="Restock Routes">
                {routes.filter(r => r.type !== 'adhoc').map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.locationIds?.length || 0} locations)</option>
                ))}
              </optgroup>
              <optgroup label="Ad-hoc">
                {routes.filter(r => r.type === 'adhoc').map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Taken By</label>
            <input
              type="text"
              value={form.takenBy}
              onChange={e => setForm({ ...form, takenBy: e.target.value })}
              placeholder="Name"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          {isAdhocRoute && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Reason for removal"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>

        {/* Show route details */}
        {selectedRoute && !isAdhocRoute && (
          <div className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-2 rounded">
            <span className="text-zinc-400">Route locations:</span> {getRouteLocations().map(l => l.name).join(' -> ') || 'None configured'}
          </div>
        )}

        {isAdhocRoute && (
          <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
            Ad-hoc removal - stock will be removed from warehouse but not added to any location
          </div>
        )}

        {form.fromWarehouse && form.routeId && (
          <>
            <div>
              <label className="block text-xs text-zinc-500 mb-2">Items to Remove</label>
              <div className="space-y-2">
                {form.items.map((item, idx) => {
                  const warning = warnings[idx];
                  const product = data.products.find(p => p.sku === item.sku);
                  return (
                    <div key={idx}>
                      <div className="flex gap-2">
                        <select
                          value={item.sku}
                          onChange={e => updateItem(idx, 'sku', e.target.value)}
                          className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">Select product</option>
                          {getAvailableProducts().map(([sku, qty]) => {
                            const prod = data.products.find(p => p.sku === sku);
                            return <option key={sku} value={sku}>{prod?.name || sku} (avail: {qty})</option>;
                          })}
                        </select>
                        <input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          max={availableStock[item.sku] || 0}
                          className={`w-24 bg-zinc-800 border rounded px-3 py-2 text-sm focus:outline-none ${
                            warning ? 'border-emerald-500' : 'border-zinc-700 focus:border-emerald-500'
                          }`}
                        />
                        <button onClick={() => removeItem(idx)} className="px-3 py-2 text-zinc-500 hover:text-red-400">x</button>
                      </div>
                      {warning && (
                        <div className="mt-1 ml-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                          Quantity ({warning.qty}) exceeds available space ({warning.availableSpace}) on this route.
                          Max capacity: {warning.maxCapacity} units for {product?.name || warning.sku}.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-4">
                <button onClick={addItem} className="text-sm text-emerald-400 hover:text-emerald-300">+ Add item</button>
                <button
                  onClick={() => { unlockAudio(); setScannerOpen(true); }}
                  className="text-sm px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded"
                >
                  Scan to add
                </button>
              </div>
            </div>
          </>
        )}

        {hasWarnings && (
          <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
            <div className="text-emerald-400 text-sm font-medium mb-1">Capacity Warning</div>
            <p className="text-zinc-400 text-xs">
              One or more items exceed the maximum capacity configured for locations on this route.
              You can still proceed, but the vending machines may not have space for all items.
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={!form.fromWarehouse || !form.routeId || !form.takenBy || loading}
          className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Processing...' : 'Confirm Removal'}
        </button>
      </div>

      <BarcodeScanner
        open={scannerOpen}
        title={selectedRoute ? `Picking: ${selectedRoute.name}` : 'Scan to add'}
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
        onReady={(api) => { scannerApiRef.current = api; }}
      />
    </div>
  );
}
