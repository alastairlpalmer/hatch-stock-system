import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useStock } from '../../context/StockContext';
import { useRestockRun } from '../../context/RestockRunContext';
import { pickListsService } from '../../services/pickLists.service';
import StockCheckForm from './restock/StockCheckForm';
import ProductSearchCombobox from '../ui/ProductSearchCombobox';

// Shared with the standalone stock-check page — "who is doing the run".
const NAME_STORAGE_KEY = 'hatch_checker_name';

export default function RestockMachine() {
  const { data, recordRestock } = useStock();
  const { markStepComplete } = useRestockRun();
  const navigate = useNavigate();

  // Deep-link support from Today's Run: preselect the machine and carry the
  // pick list so planned quantities prefill the add-stock step.
  const [searchParams] = useSearchParams();
  const qpLocationParam = searchParams.get('locationId') || '';
  const qpLocationId = data.locations.some(l => l.id === qpLocationParam) ? qpLocationParam : '';
  const qpPickListId = searchParams.get('pickListId') || '';

  const [activeSubTab, setActiveSubTab] = useState('restock');
  const [restockerName, setRestockerNameState] = useState(
    () => localStorage.getItem(NAME_STORAGE_KEY) || ''
  );
  // When arriving from the run with a machine + pick list and a known name,
  // skip straight to the stock check; if the name is missing, stay on step 1
  // with the location preselected.
  const [step, setStep] = useState(() =>
    qpLocationId && qpPickListId && (localStorage.getItem(NAME_STORAGE_KEY) || '').trim()
      ? 'stockcheck'
      : 'select'
  );
  const [selectedLocation, setSelectedLocation] = useState(qpLocationId);

  const setRestockerName = (value) => {
    setRestockerNameState(value);
    try {
      localStorage.setItem(NAME_STORAGE_KEY, value);
    } catch {
      // storage unavailable (private mode) — the name just won't persist
    }
  };
  const [stockCheckComplete, setStockCheckComplete] = useState(false);
  const [stockCheckId, setStockCheckId] = useState(null);
  const [lastCheck, setLastCheck] = useState(null);
  const [restockItems, setRestockItems] = useState([{ sku: '', quantity: '' }]);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [viewingRestock, setViewingRestock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // This machine's planned skus/quantities from the pick list (deep-link only)
  const [plannedItems, setPlannedItems] = useState(null);

  // Fetch the pick list's plan for this location. Prefer the run endpoint;
  // fall back to getById + items[].perLocation for older backends.
  useEffect(() => {
    if (!qpPickListId || !qpLocationId) return;
    let cancelled = false;
    (async () => {
      try {
        let planned = null;
        try {
          const run = await pickListsService.getRun(qpPickListId);
          const loc = (run.locations || []).find(l => l.locationId === qpLocationId);
          planned = (loc?.planned || []).map(p => ({ sku: p.sku, qty: p.qty }));
        } catch {
          const list = await pickListsService.getById(qpPickListId);
          planned = (list.items || [])
            .map(it => {
              const pl = (it.perLocation || []).find(p => p.locationId === qpLocationId);
              return pl ? { sku: it.sku, qty: pl.qty } : null;
            })
            .filter(Boolean);
        }
        if (!cancelled && planned) {
          setPlannedItems(planned.filter(p => p.qty > 0));
        }
      } catch {
        // Plan unavailable — the add-stock step just starts empty.
      }
    })();
    return () => { cancelled = true; };
  }, [qpPickListId, qpLocationId]);

  // Prefill the add-stock rows with the plan once, and only while the rows are
  // still untouched (the restocker can edit, remove, or add more afterwards).
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (step !== 'addstock' || prefilledRef.current) return;
    if (!plannedItems || plannedItems.length === 0) return;
    if (selectedLocation !== qpLocationId) return;
    prefilledRef.current = true;
    setRestockItems(prev =>
      prev.length === 1 && !prev[0].sku && !prev[0].quantity
        ? plannedItems.map(p => ({ sku: p.sku, quantity: String(p.qty) }))
        : prev
    );
  }, [step, plannedItems, selectedLocation, qpLocationId]);

  const location = data.locations.find(l => l.id === selectedLocation);
  const locationStock = data.locationStock[selectedLocation] || {};
  const locationConfig = data.locationConfig[selectedLocation] || {};
  const machineRestocks = data.restockHistory || data.machineRestocks || [];
  const stockChecks = data.stockCheckHistory || data.stockChecks || [];

  // Get products assigned to this location
  const getLocationProducts = () => {
    if (!location) return [];
    if (location.assignedItems?.length > 0) {
      return data.products.filter(p => location.assignedItems.includes(p.sku));
    }
    return data.products;
  };

  // Check if location has a recent valid stock check (within last 24 hours)
  const hasValidStockCheck = () => {
    if (!selectedLocation) return false;
    const recentCheck = stockChecks
      .filter(sc => sc.locationId === selectedLocation)
      .sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp))[0];

    if (!recentCheck) return false;

    const hoursSince = (Date.now() - new Date(recentCheck.createdAt || recentCheck.timestamp).getTime()) / (1000 * 60 * 60);
    return hoursSince < 24;
  };

  // Start the stock check (the shared StockCheckForm owns the counting UI)
  const startStockCheck = () => {
    setStep('stockcheck');
    setError(null);
  };

  // Stock check submitted via the shared form — the server returned the
  // created check with computed variances.
  const handleStockCheckComplete = (check) => {
    setStockCheckId(check?.id || null);
    setLastCheck(check || null);
    setStockCheckComplete(true);
    setStep('addstock');
  };

  // Skip stock check (use existing valid one). API records carry createdAt,
  // offline/legacy ones carry timestamp — sort on whichever exists.
  const skipStockCheck = () => {
    const recentCheck = stockChecks
      .filter(sc => sc.locationId === selectedLocation)
      .sort((a, b) => new Date(b.createdAt || b.timestamp) - new Date(a.createdAt || a.timestamp))[0];

    setStockCheckId(recentCheck?.id);
    setStockCheckComplete(true);
    setStep('addstock');
  };

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedImage(ev.target?.result);
      setImagePreview(ev.target?.result);
    };
    reader.readAsDataURL(file);
  };

  // Add/update restock items
  const addRestockItem = () => setRestockItems([...restockItems, { sku: '', quantity: '' }]);

  const updateRestockItem = (idx, field, value) => {
    const items = [...restockItems];
    items[idx][field] = value;
    setRestockItems(items);
  };

  const removeRestockItem = (idx) => {
    if (restockItems.length > 1) {
      setRestockItems(restockItems.filter((_, i) => i !== idx));
    }
  };

  // Complete restock
  const completeRestock = async (override = false) => {
    if (!override && !uploadedImage) return;

    setLoading(true);
    setError(null);

    try {
      const validItems = restockItems
        .filter(i => i.sku && parseInt(i.quantity) > 0)
        .map(i => ({
          sku: i.sku,
          quantity: parseInt(i.quantity),
          productName: data.products.find(p => p.sku === i.sku)?.name || i.sku
        }));

      await recordRestock({
        locationId: selectedLocation,
        locationName: location?.name,
        performedBy: restockerName,
        stockCheckId,
        items: validItems,
        photoUrl: uploadedImage,
        imageOverride: override && !uploadedImage,
        ...(qpPickListId ? { pickListId: qpPickListId } : {})
      });

      markStepComplete('machine');
      setStep('complete');
    } catch (err) {
      setError(err.message || 'Failed to complete restock');
    } finally {
      setLoading(false);
    }
  };

  // Reset everything
  const resetForm = () => {
    setStep('select');
    setSelectedLocation('');
    setRestockerName('');
    setStockCheckComplete(false);
    setStockCheckId(null);
    setLastCheck(null);
    setRestockItems([{ sku: '', quantity: '' }]);
    setUploadedImage(null);
    setImagePreview(null);
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Restock Machine</h2>
          <p className="text-zinc-500 text-sm mt-1">Complete stock check and add items to vending machines</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'restock', label: 'Add Stock' },
          { id: 'history', label: 'Restock History' },
          { id: 'checks', label: 'Stock Check History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveSubTab(tab.id); if (tab.id === 'restock') resetForm(); }}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'restock' && (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-sm flex-wrap">
            <span className={`px-3 py-1 rounded ${step === 'select' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              1. Select Location
            </span>
            <span className="text-zinc-600">-&gt;</span>
            <span className={`px-3 py-1 rounded ${step === 'stockcheck' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              2. Stock Check
            </span>
            <span className="text-zinc-600">-&gt;</span>
            <span className={`px-3 py-1 rounded ${step === 'addstock' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              3. Add Stock
            </span>
            <span className="text-zinc-600">-&gt;</span>
            <span className={`px-3 py-1 rounded ${step === 'complete' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              4. Complete
            </span>
          </div>

          {/* Step 1: Select Location */}
          {step === 'select' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <h3 className="font-medium text-zinc-200">Select Location & Restocker</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Restocker Name *</label>
                  <input
                    type="text"
                    value={restockerName}
                    onChange={e => setRestockerName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Location *</label>
                  <select
                    value={selectedLocation}
                    onChange={e => setSelectedLocation(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select location</option>
                    {data.locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedLocation && (
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-zinc-400 text-sm">Current expected stock:</span>
                    {hasValidStockCheck() && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        Recent stock check available
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-300 text-sm">
                    {Object.keys(locationStock).length === 0 ? (
                      <span className="text-zinc-600">No stock recorded</span>
                    ) : (
                      <span>{Object.values(locationStock).reduce((a, b) => a + b, 0)} units across {Object.keys(locationStock).length} products</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={startStockCheck}
                  disabled={!selectedLocation || !restockerName}
                  className="px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Stock Check
                </button>
                {hasValidStockCheck() && (
                  <button
                    onClick={skipStockCheck}
                    disabled={!selectedLocation || !restockerName}
                    className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Skip (Use Recent Check)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Stock Check (shared mobile-first form) */}
          {step === 'stockcheck' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Stock Check: {location?.name}</h3>
                <button onClick={() => setStep('select')} className="text-zinc-500 hover:text-zinc-300 text-sm min-h-[44px] px-2">
                  Back
                </button>
              </div>

              <p className="text-zinc-500 text-sm">
                For each product, tap the tick if the count is correct or enter the quantity you actually found.
              </p>

              <StockCheckForm
                locationId={selectedLocation}
                performedBy={restockerName}
                onComplete={handleStockCheckComplete}
              />
            </div>
          )}

          {/* Step 3: Add Stock */}
          {step === 'addstock' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Add Stock: {location?.name}</h3>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
                  Stock check complete
                </span>
              </div>

              {/* Variance summary from the check just submitted */}
              {(() => {
                const checkItems = lastCheck?.items || [];
                const discrepancies = checkItems.filter(i => (i.variance ?? 0) !== 0);
                if (discrepancies.length === 0) return null;
                const shortfall = discrepancies.reduce((s, i) => s + ((i.variance ?? 0) < 0 ? -i.variance : 0), 0);
                const overage = discrepancies.reduce((s, i) => s + ((i.variance ?? 0) > 0 ? i.variance : 0), 0);
                return (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
                    Stock check found {discrepancies.length} discrepanc{discrepancies.length === 1 ? 'y' : 'ies'}
                    {shortfall > 0 && <> — {shortfall} unit{shortfall === 1 ? '' : 's'} short</>}
                    {overage > 0 && <>{shortfall > 0 ? ',' : ' —'} {overage} unit{overage === 1 ? '' : 's'} over</>}
                    . Stock levels were set to the found quantities.
                  </div>
                );
              })()}

              <p className="text-zinc-500 text-sm">
                Enter the items and quantities you're placing into the machine.
              </p>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-6">Product</div>
                  <div className="col-span-2 text-center">Current</div>
                  <div className="col-span-2 text-center">Adding</div>
                  <div className="col-span-2"></div>
                </div>

                {restockItems.map((item, idx) => {
                  const currentStock = item.sku ? (data.locationStock[selectedLocation]?.[item.sku] || 0) : 0;
                  const config = item.sku ? (locationConfig[item.sku] || {}) : {};
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <ProductSearchCombobox
                          products={getLocationProducts()}
                          value={item.sku}
                          onSelect={sku => updateRestockItem(idx, 'sku', sku)}
                          recentsKey="hatch-recent-products-restock"
                        />
                      </div>
                      <div className="col-span-2 text-center text-zinc-400 text-sm">
                        {item.sku ? currentStock : '-'}
                        {config.maxStock && (
                          <span className="text-zinc-600">/{config.maxStock}</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          inputMode="numeric"
                          value={item.quantity}
                          onChange={e => updateRestockItem(idx, 'quantity', e.target.value)}
                          placeholder="Qty"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <button
                          onClick={() => removeRestockItem(idx)}
                          className="text-zinc-500 hover:text-red-400 px-2"
                        >x</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={addRestockItem} className="text-sm text-emerald-400 hover:text-emerald-300">
                + Add item
              </button>

              {/* Image upload */}
              <div className="border-t border-zinc-800 pt-4 mt-4">
                <label className="block text-xs text-zinc-500 mb-2">
                  Photo of Restocked Machine <span className="text-emerald-400">*</span>
                </label>
                <div className="flex gap-4 items-start">
                  <label className={`px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors ${
                    uploadedImage ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  }`}>
                    {uploadedImage ? 'Photo Uploaded' : 'Upload Photo'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  {imagePreview && (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="Preview"
                        className="w-24 h-24 object-cover rounded border border-zinc-700"
                      />
                      <button
                        onClick={() => { setUploadedImage(null); setImagePreview(null); }}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                      >x</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => completeRestock(false)}
                  disabled={!uploadedImage || restockItems.every(i => !i.sku || !i.quantity) || loading}
                  className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Processing...' : 'Complete Restock'}
                </button>
                <button
                  onClick={() => completeRestock(true)}
                  disabled={restockItems.every(i => !i.sku || !i.quantity) || loading}
                  className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Override (Skip Photo)
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && (
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-8 text-center space-y-4">
              <div className="text-4xl">OK</div>
              <h3 className="text-xl font-medium text-emerald-400">Restock Complete!</h3>
              <p className="text-zinc-400">
                {location?.name} has been restocked by {restockerName}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                {qpPickListId && (
                  <button
                    onClick={() => navigate('/restock/run')}
                    className="w-full sm:w-auto px-5 py-3 bg-emerald-500 text-zinc-900 rounded-lg text-sm font-semibold hover:bg-emerald-400"
                  >
                    Back to today&rsquo;s run
                  </button>
                )}
                <button
                  onClick={resetForm}
                  className={`w-full sm:w-auto px-4 py-2 rounded text-sm font-medium ${
                    qpPickListId
                      ? 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                >
                  Start Another Restock
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {viewingRestock ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Restock Details</h3>
                <button onClick={() => setViewingRestock(null)} className="text-zinc-500 hover:text-zinc-300 text-sm">
                  Back to list
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500">Location:</span>
                  <span className="text-zinc-200 ml-2">{viewingRestock.locationName}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Restocked by:</span>
                  <span className="text-zinc-200 ml-2">{viewingRestock.performedBy || viewingRestock.restockerName}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Date:</span>
                  <span className="text-zinc-200 ml-2">
                    {new Date(viewingRestock.createdAt || viewingRestock.timestamp).toLocaleString('en-GB')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Photo:</span>
                  {viewingRestock.imageOverride ? (
                    <span className="text-emerald-400 ml-2">Overridden (no photo)</span>
                  ) : (viewingRestock.photoUrl || viewingRestock.image) ? (
                    <span className="text-emerald-400 ml-2">Included</span>
                  ) : (
                    <span className="text-zinc-600 ml-2">None</span>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-3">Items Restocked</h4>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 text-zinc-500 font-medium">Product</th>
                      <th className="text-right py-2 text-zinc-500 font-medium">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingRestock.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-zinc-800/50">
                        <td className="py-2 text-zinc-200">{item.productName}</td>
                        <td className="text-right py-2 text-emerald-400">+{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {(viewingRestock.photoUrl || viewingRestock.image) && (
                <div className="border-t border-zinc-800 pt-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-3">Machine Photo</h4>
                  <img
                    src={viewingRestock.photoUrl || viewingRestock.image}
                    alt="Restocked machine"
                    className="max-w-full max-h-96 rounded border border-zinc-700"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Restocked By</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Items</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Photo</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {machineRestocks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                        No restocks recorded yet
                      </td>
                    </tr>
                  ) : (
                    machineRestocks.slice().reverse().map(restock => (
                      <tr key={restock.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-400 text-xs">
                          {new Date(restock.createdAt || restock.timestamp).toLocaleDateString('en-GB')}
                          <div className="text-zinc-600">
                            {new Date(restock.createdAt || restock.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-200">{restock.locationName}</td>
                        <td className="px-4 py-3 text-zinc-400">{restock.performedBy || restock.restockerName}</td>
                        <td className="text-right px-4 py-3 text-emerald-400">
                          +{restock.items.reduce((acc, i) => acc + i.quantity, 0)}
                        </td>
                        <td className="text-center px-4 py-3">
                          {restock.imageOverride ? (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Override</span>
                          ) : (restock.photoUrl || restock.image) ? (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">OK</span>
                          ) : (
                            <span className="text-zinc-600">-</span>
                          )}
                        </td>
                        <td className="text-right px-4 py-3">
                          <button
                            onClick={() => setViewingRestock(restock)}
                            className="text-emerald-400 hover:text-emerald-300 text-sm"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Check History Tab */}
      {activeSubTab === 'checks' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Checked By</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Products</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Total Variance</th>
              </tr>
            </thead>
            <tbody>
              {stockChecks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                    No stock checks recorded yet
                  </td>
                </tr>
              ) : (
                stockChecks.slice().reverse().map(check => (
                  <tr key={check.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {new Date(check.createdAt || check.timestamp).toLocaleDateString('en-GB')}
                      <div className="text-zinc-600">
                        {new Date(check.createdAt || check.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{check.locationName}</td>
                    <td className="px-4 py-3 text-zinc-400">{check.performedBy || check.checkedBy}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">{check.items.length}</td>
                    <td className="text-right px-4 py-3">
                      <span className={`${check.totalVariance === 0 ? 'text-emerald-400' : 'text-emerald-400'}`}>
                        {check.totalVariance === 0 ? 'Match' : `+/-${check.totalVariance}`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
