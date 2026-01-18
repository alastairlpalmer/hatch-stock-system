import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';

export default function RestockMachine() {
  const { data, submitStockCheck, recordRestock } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('restock');
  const [step, setStep] = useState('select');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [restockerName, setRestockerName] = useState('');
  const [stockCheckCounts, setStockCheckCounts] = useState({});
  const [stockCheckComplete, setStockCheckComplete] = useState(false);
  const [stockCheckId, setStockCheckId] = useState(null);
  const [restockItems, setRestockItems] = useState([{ sku: '', quantity: '' }]);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [viewingRestock, setViewingRestock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  // Variance reason options
  const varianceReasons = [
    { value: 'theft', label: 'Suspected Theft' },
    { value: 'swap', label: 'Wrong Item Taken (Swap)' },
    { value: 'damaged', label: 'Damaged/Expired' },
    { value: 'malfunction', label: 'Machine Malfunction' },
    { value: 'unknown', label: 'Unknown' },
  ];

  // Initialize stock check with expected values
  const startStockCheck = () => {
    const counts = {};
    getLocationProducts().forEach(p => {
      counts[p.sku] = { counted: '', expected: locationStock[p.sku] || 0, reason: '' };
    });
    setStockCheckCounts(counts);
    setStep('stockcheck');
    setError(null);
  };

  // Complete stock check
  const completeStockCheck = async () => {
    setLoading(true);
    setError(null);

    try {
      const checkId = `sc-${Date.now()}`;
      const items = Object.entries(stockCheckCounts).map(([sku, itemData]) => {
        const counted = parseInt(itemData.counted) || 0;
        const variance = counted - itemData.expected;
        return {
          sku,
          expected: itemData.expected,
          counted,
          variance,
          // Include reason for negative variances (shrinkage)
          reason: variance < 0 ? (itemData.reason || 'unknown') : null,
        };
      });

      await submitStockCheck({
        id: checkId,
        locationId: selectedLocation,
        locationName: location?.name,
        performedBy: restockerName,
        items
      });

      setStockCheckId(checkId);
      setStockCheckComplete(true);
      setStep('addstock');
    } catch (err) {
      setError(err.message || 'Failed to complete stock check');
    } finally {
      setLoading(false);
    }
  };

  // Skip stock check (use existing valid one)
  const skipStockCheck = () => {
    const recentCheck = stockChecks
      .filter(sc => sc.locationId === selectedLocation)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

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
        imageOverride: override && !uploadedImage
      });

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
    setStockCheckCounts({});
    setStockCheckComplete(false);
    setStockCheckId(null);
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

          {/* Step 2: Stock Check */}
          {step === 'stockcheck' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Stock Check: {location?.name}</h3>
                <button onClick={() => setStep('select')} className="text-zinc-500 hover:text-zinc-300 text-sm">
                  Back
                </button>
              </div>

              <p className="text-zinc-500 text-sm">
                Count each product in the machine and enter the actual quantity found.
              </p>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-4">Product</div>
                  <div className="col-span-2 text-center">Expected</div>
                  <div className="col-span-2 text-center">Counted</div>
                  <div className="col-span-2 text-center">Variance</div>
                  <div className="col-span-2 text-center">Reason</div>
                </div>

                {getLocationProducts().map(product => {
                  const counts = stockCheckCounts[product.sku] || { counted: '', expected: 0, reason: '' };
                  const counted = parseInt(counts.counted) || 0;
                  const variance = counts.counted !== '' ? counted - counts.expected : null;
                  const hasNegativeVariance = variance !== null && variance < 0;
                  return (
                    <div key={product.sku} className={`grid grid-cols-12 gap-2 items-center py-2 border-b border-zinc-800 last:border-0 ${hasNegativeVariance ? 'bg-red-500/5' : ''}`}>
                      <div className="col-span-4">
                        <span className="text-zinc-200">{product.name}</span>
                        <div className="text-zinc-600 text-xs">{product.sku}</div>
                      </div>
                      <div className="col-span-2 text-center text-zinc-400">
                        {counts.expected}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={counts.counted}
                          onChange={e => setStockCheckCounts({
                            ...stockCheckCounts,
                            [product.sku]: { ...counts, counted: e.target.value }
                          })}
                          placeholder="0"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-2 text-center">
                        {variance !== null && (
                          <span className={`text-sm font-medium ${
                            variance === 0 ? 'text-emerald-400' : variance > 0 ? 'text-blue-400' : 'text-red-400'
                          }`}>
                            {variance > 0 ? '+' : ''}{variance}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2">
                        {hasNegativeVariance ? (
                          <select
                            value={counts.reason || ''}
                            onChange={e => setStockCheckCounts({
                              ...stockCheckCounts,
                              [product.sku]: { ...counts, reason: e.target.value }
                            })}
                            className="w-full bg-zinc-800 border border-red-700/50 rounded px-1 py-1.5 text-xs focus:outline-none focus:border-red-500"
                          >
                            <option value="">Select...</option>
                            {varianceReasons.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-zinc-600 text-xs">-</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={completeStockCheck}
                disabled={Object.values(stockCheckCounts).some(c => c.counted === '') || loading}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : 'Complete Stock Check'}
              </button>
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
                        <select
                          value={item.sku}
                          onChange={e => updateRestockItem(idx, 'sku', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">Select product</option>
                          {getLocationProducts().map(p => (
                            <option key={p.sku} value={p.sku}>{p.name}</option>
                          ))}
                        </select>
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
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
              >
                Start Another Restock
              </button>
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
          )}
        </div>
      )}

      {/* Stock Check History Tab */}
      {activeSubTab === 'checks' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
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
      )}
    </div>
  );
}
