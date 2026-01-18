import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';

export default function Inventory() {
  const { data, addProduct, bulkImportProducts, updateWarehouseStock, bulkUpdateWarehouseStock } = useStock();
  const [selectedWarehouse, setSelectedWarehouse] = useState('all');
  const [activeSubTab, setActiveSubTab] = useState('stock');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Add Stock states
  const [showAddStock, setShowAddStock] = useState(false);
  const [addStockForm, setAddStockForm] = useState({
    warehouseId: '',
    sku: '',
    productName: '',
    quantity: '',
    category: 'Other',
    unitCost: ''
  });

  // Edit Stock states
  const [editingStock, setEditingStock] = useState(null); // { warehouseId, sku, currentQty }
  const [editStockQty, setEditStockQty] = useState('');

  // CSV Upload states
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvProcessing, setCsvProcessing] = useState(false);
  const [csvItems, setCsvItems] = useState([]);
  const [csvConflicts, setCsvConflicts] = useState([]);
  const [csvReviewMode, setCsvReviewMode] = useState(false);

  const getStockForWarehouse = (whId) => data.stock[whId] || {};

  const getAllStock = () => {
    const combined = {};
    data.warehouses.forEach(wh => {
      Object.entries(data.stock[wh.id] || {}).forEach(([sku, qty]) => {
        if (!combined[sku]) combined[sku] = {};
        combined[sku][wh.id] = qty;
      });
    });
    return combined;
  };

  // Get batches with expiry info
  const getBatches = () => {
    const batches = data.stockBatches || [];
    if (selectedWarehouse === 'all') return batches.filter(b => b.remainingQty > 0);
    return batches.filter(b => b.warehouseId === selectedWarehouse && b.remainingQty > 0);
  };

  // Get expiry status
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) return { status: 'expired', label: 'Expired', days: daysUntil, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 7) return { status: 'critical', label: `${daysUntil}d`, days: daysUntil, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 30) return { status: 'warning', label: `${daysUntil}d`, days: daysUntil, color: 'text-emerald-400 bg-emerald-500/20' };
    return { status: 'ok', label: `${daysUntil}d`, days: daysUntil, color: 'text-emerald-400 bg-emerald-500/20' };
  };

  // Get earliest expiry for a SKU
  const getEarliestExpiry = (sku, warehouseId = null) => {
    const batches = (data.stockBatches || []).filter(b =>
      b.sku === sku &&
      b.remainingQty > 0 &&
      b.expiryDate &&
      (warehouseId ? b.warehouseId === warehouseId : true)
    );
    if (batches.length === 0) return null;
    const sorted = batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    return sorted[0].expiryDate;
  };

  // Summary stats
  const expiredBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'expired';
  });
  const expiringBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'critical' || status?.status === 'warning';
  });

  // ===== ADD STOCK FUNCTIONS =====

  const openAddStock = () => {
    setAddStockForm({
      warehouseId: selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || ''),
      sku: '',
      productName: '',
      quantity: '',
      category: 'Other',
      unitCost: ''
    });
    setShowAddStock(true);
    setError(null);
  };

  const handleAddStockSubmit = async () => {
    if (!addStockForm.warehouseId || !addStockForm.sku || !addStockForm.quantity) return;

    const qty = parseInt(addStockForm.quantity) || 0;
    if (qty <= 0) return;

    setLoading(true);
    setError(null);

    try {
      // Check if product exists
      const existingProduct = data.products.find(p => p.sku === addStockForm.sku);

      if (!existingProduct) {
        // Create new product
        await addProduct({
          sku: addStockForm.sku,
          name: addStockForm.productName || addStockForm.sku,
          category: addStockForm.category,
          unitCost: parseFloat(addStockForm.unitCost) || 0,
          salePrice: parseFloat(addStockForm.unitCost) || 0
        });
      }

      // Update stock (pass qty as delta, not absolute value)
      await updateWarehouseStock(addStockForm.warehouseId, addStockForm.sku, qty, true);

      setShowAddStock(false);
    } catch (err) {
      setError(err.message || 'Failed to add stock');
    } finally {
      setLoading(false);
    }
  };

  // Edit stock handler
  const openEditStock = (warehouseId, sku, currentQty) => {
    setEditingStock({ warehouseId, sku, currentQty });
    setEditStockQty(currentQty.toString());
    setError(null);
  };

  const handleEditStockSubmit = async () => {
    if (!editingStock) return;

    const newQty = parseInt(editStockQty) || 0;
    if (newQty < 0) return;

    setLoading(true);
    setError(null);

    try {
      // Set absolute quantity (isDelta = false)
      await updateWarehouseStock(editingStock.warehouseId, editingStock.sku, newQty, false);
      setEditingStock(null);
    } catch (err) {
      setError(err.message || 'Failed to update stock');
    } finally {
      setLoading(false);
    }
  };

  // Check for SKU conflicts (same SKU, different name)
  const checkSkuConflict = (sku, name) => {
    const existingProduct = data.products.find(p => p.sku === sku);
    if (existingProduct && existingProduct.name.toLowerCase() !== name.toLowerCase()) {
      return {
        existingSku: existingProduct.sku,
        existingName: existingProduct.name,
        newName: name
      };
    }
    return null;
  };

  // ===== CSV UPLOAD FUNCTIONS =====

  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvProcessing(true);
    setShowCsvUpload(true);
    setError(null);

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());

    if (lines.length < 2) {
      setCsvProcessing(false);
      return;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());

    // Detect CSV format
    const skuCol = headers.findIndex(h =>
      h.includes('sku') || h.includes('product id') || h.includes('product__id') || h.includes('external_id')
    );
    const nameCol = headers.findIndex(h =>
      h.includes('name') || h.includes('item name') || h.includes('product name') || h.includes('description')
    );
    const qtyCol = headers.findIndex(h =>
      h.includes('quantity') || h.includes('stock') || h.includes('current stock') || h.includes('qty')
    );
    const categoryCol = headers.findIndex(h =>
      h.includes('category') || h.includes('product__category__name')
    );
    const priceCol = headers.findIndex(h =>
      h.includes('price') || h.includes('unit price') || h.includes('cost') || h.includes('unit cost')
    );
    const supplierCol = headers.findIndex(h =>
      h.includes('supplier') || h.includes('vendor')
    );

    const items = [];
    const conflicts = [];
    const seenSkus = new Set();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      let sku = skuCol >= 0 ? values[skuCol]?.trim() : '';
      const name = nameCol >= 0 ? values[nameCol]?.trim() : '';
      const qtyStr = qtyCol >= 0 ? values[qtyCol]?.trim() : '0';
      const category = categoryCol >= 0 ? values[categoryCol]?.trim() : 'Other';
      let priceStr = priceCol >= 0 ? values[priceCol]?.trim() : '0';
      const supplier = supplierCol >= 0 ? values[supplierCol]?.trim() : '';

      // Skip if no name
      if (!name) continue;

      // Generate SKU if not provided
      if (!sku) {
        const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
        sku = `${cleanName}-${Date.now().toString().slice(-4)}-${i}`;
      }

      // Skip duplicates in same CSV
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);

      // Parse quantity
      const qty = parseInt(qtyStr.replace(/[^0-9]/g, '')) || 0;

      // Parse price (remove currency symbols)
      const price = parseFloat(priceStr.replace(/[^0-9.]/g, '')) || 0;

      // Check for conflicts with existing products
      const conflict = checkSkuConflict(sku, name);

      const item = {
        sku,
        name,
        quantity: qty,
        category: category || 'Other',
        unitCost: price,
        supplier,
        selected: true,
        isNew: !data.products.find(p => p.sku === sku),
        hasConflict: !!conflict,
        conflict,
        action: conflict ? 'review' : 'add'
      };

      items.push(item);

      if (conflict) {
        conflicts.push(item);
      }
    }

    setCsvItems(items);
    setCsvConflicts(conflicts);
    setCsvReviewMode(true);
    setCsvProcessing(false);
  };

  const updateCsvItem = (idx, field, value) => {
    const items = [...csvItems];
    items[idx][field] = value;
    setCsvItems(items);
  };

  const toggleCsvItemSelection = (idx) => {
    const items = [...csvItems];
    items[idx].selected = !items[idx].selected;
    setCsvItems(items);
  };

  const resolveConflict = (idx, action) => {
    const items = [...csvItems];
    items[idx].action = action;
    if (action === 'use-existing') {
      items[idx].name = items[idx].conflict.existingName;
      items[idx].hasConflict = false;
    } else if (action === 'use-new') {
      items[idx].hasConflict = false;
    }
    setCsvItems(items);
    setCsvConflicts(prev => prev.filter((_, i) => csvConflicts.indexOf(items[idx]) !== i));
  };

  const applyCsvData = async () => {
    const targetWarehouse = selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || '');
    if (!targetWarehouse) return;

    setLoading(true);
    setError(null);

    try {
      // Prepare new products
      const newProducts = [];
      const stockUpdates = [];

      for (const item of csvItems) {
        if (!item.selected || item.action === 'skip') continue;

        const existingProduct = data.products.find(p => p.sku === item.sku);

        if (!existingProduct) {
          newProducts.push({
            sku: item.sku,
            name: item.name,
            category: item.category || 'Other',
            unitCost: item.unitCost || 0,
            salePrice: item.unitCost || 0
          });
        }

        // Stock update
        const currentQty = (data.stock[targetWarehouse] || {})[item.sku] || 0;
        stockUpdates.push({
          sku: item.sku,
          quantity: currentQty + item.quantity
        });
      }

      // Import new products
      if (newProducts.length > 0) {
        await bulkImportProducts(newProducts);
      }

      // Update stock
      if (stockUpdates.length > 0) {
        await bulkUpdateWarehouseStock(targetWarehouse, stockUpdates);
      }

      // Reset
      setShowCsvUpload(false);
      setCsvReviewMode(false);
      setCsvItems([]);
      setCsvConflicts([]);
    } catch (err) {
      setError(err.message || 'Failed to import CSV data');
    } finally {
      setLoading(false);
    }
  };

  const unresolvedConflicts = csvItems.filter(i => i.selected && i.hasConflict && i.action === 'review');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Warehouse Inventory</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <select
            value={selectedWarehouse}
            onChange={e => setSelectedWarehouse(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="all">All Warehouses</option>
            {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button
              onClick={openAddStock}
              className="flex-1 sm:flex-none px-3 py-2.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
            >
              + Add Stock
            </button>
            <label className="flex-1 sm:flex-none px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 cursor-pointer text-center">
              CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Add Stock Modal */}
      {showAddStock && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">Add Stock</h3>
            <button onClick={() => setShowAddStock(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">x</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Warehouse *</label>
              <select
                value={addStockForm.warehouseId}
                onChange={e => setAddStockForm({ ...addStockForm, warehouseId: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Product *</label>
              <select
                value={addStockForm.sku}
                onChange={e => {
                  const sku = e.target.value;
                  if (sku === '__new__') {
                    setAddStockForm({ ...addStockForm, sku: '', productName: '', category: 'Other', unitCost: '' });
                  } else {
                    const existing = data.products.find(p => p.sku === sku);
                    setAddStockForm({
                      ...addStockForm,
                      sku,
                      productName: existing?.name || '',
                      category: existing?.category || 'Other',
                      unitCost: existing?.unitCost?.toString() || ''
                    });
                  }
                }}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                <option value="">Select a product...</option>
                {data.products.map(p => (
                  <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>
                ))}
                <option value="__new__">+ Add New Product</option>
              </select>
            </div>

            {/* New product fields */}
            {addStockForm.sku === '' && (
              <>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">New SKU *</label>
                  <input
                    type="text"
                    value={addStockForm.sku}
                    onChange={e => setAddStockForm({ ...addStockForm, sku: e.target.value })}
                    placeholder="e.g., PROD-001"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Product Name *</label>
                  <input
                    type="text"
                    value={addStockForm.productName}
                    onChange={e => setAddStockForm({ ...addStockForm, productName: e.target.value })}
                    placeholder="Product name"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Category</label>
                  <select
                    value={addStockForm.category}
                    onChange={e => setAddStockForm({ ...addStockForm, category: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  >
                    <option value="Meals">Meals</option>
                    <option value="Drinks">Drinks</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Breakfast">Breakfast</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Unit Cost</label>
                  <input
                    type="number"
                    step="0.01"
                    value={addStockForm.unitCost}
                    onChange={e => setAddStockForm({ ...addStockForm, unitCost: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Quantity to Add *</label>
              <input
                type="number"
                value={addStockForm.quantity}
                onChange={e => setAddStockForm({ ...addStockForm, quantity: e.target.value })}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          {addStockForm.sku && data.products.find(p => p.sku === addStockForm.sku) && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-emerald-400 text-sm">
                Adding to existing product: <strong>{data.products.find(p => p.sku === addStockForm.sku)?.name}</strong>
                {addStockForm.warehouseId && (
                  <span className="text-zinc-400 ml-2">
                    (Current stock: {(data.stock[addStockForm.warehouseId] || {})[addStockForm.sku] || 0})
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={handleAddStockSubmit}
              disabled={!addStockForm.warehouseId || !addStockForm.sku || !addStockForm.quantity || loading}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Stock'}
            </button>
            <button
              onClick={() => setShowAddStock(false)}
              className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Edit Stock Modal */}
      {editingStock && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">Adjust Stock Level</h3>
            <button onClick={() => setEditingStock(null)} className="text-zinc-500 hover:text-zinc-300 text-xl">x</button>
          </div>

          <div className="bg-zinc-800/50 rounded-lg p-4">
            <p className="text-zinc-400 text-sm">
              <span className="text-zinc-500">Product:</span>{' '}
              <span className="text-zinc-200">{data.products.find(p => p.sku === editingStock.sku)?.name || editingStock.sku}</span>
            </p>
            <p className="text-zinc-400 text-sm mt-1">
              <span className="text-zinc-500">Warehouse:</span>{' '}
              <span className="text-zinc-200">{data.warehouses.find(w => w.id === editingStock.warehouseId)?.name}</span>
            </p>
            <p className="text-zinc-400 text-sm mt-1">
              <span className="text-zinc-500">Current Stock:</span>{' '}
              <span className="text-emerald-400 font-medium">{editingStock.currentQty}</span>
            </p>
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">New Quantity</label>
            <input
              type="number"
              value={editStockQty}
              onChange={e => setEditStockQty(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
            />
            {editStockQty && parseInt(editStockQty) !== editingStock.currentQty && (
              <p className="text-xs mt-1 text-zinc-500">
                Change: <span className={parseInt(editStockQty) > editingStock.currentQty ? 'text-emerald-400' : 'text-red-400'}>
                  {parseInt(editStockQty) > editingStock.currentQty ? '+' : ''}{parseInt(editStockQty) - editingStock.currentQty}
                </span>
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={handleEditStockSubmit}
              disabled={editStockQty === '' || parseInt(editStockQty) < 0 || loading}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditingStock(null)}
              className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* CSV Upload Modal */}
      {showCsvUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">CSV Stock Import</h3>
              <p className="text-zinc-500 text-sm mt-1">
                {selectedWarehouse !== 'all'
                  ? `Importing to: ${data.warehouses.find(w => w.id === selectedWarehouse)?.name}`
                  : `Importing to: ${data.warehouses[0]?.name || 'Default Warehouse'}`
                }
              </p>
            </div>
            <button onClick={() => { setShowCsvUpload(false); setCsvReviewMode(false); setCsvItems([]); }} className="text-zinc-500 hover:text-zinc-300 text-xl">x</button>
          </div>

          {csvProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-teal-400 text-3xl mb-4">*</div>
              <p className="text-zinc-400">Processing CSV...</p>
            </div>
          )}

          {csvReviewMode && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-teal-400">{csvItems.length}</div>
                  <div className="text-xs text-zinc-500">Total Items</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-emerald-400">
                    {csvItems.filter(i => !i.isNew && !i.hasConflict).length}
                  </div>
                  <div className="text-xs text-zinc-500">Matched</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-yellow-400">
                    {csvItems.filter(i => i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">New Products</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-red-400">
                    {unresolvedConflicts.length}
                  </div>
                  <div className="text-xs text-zinc-500">Conflicts</div>
                </div>
              </div>

              {/* Conflicts Warning */}
              {unresolvedConflicts.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <h4 className="text-red-400 font-medium mb-2">SKU Conflicts Detected</h4>
                  <p className="text-zinc-400 text-sm mb-3">
                    The following items have matching SKUs but different names. Please resolve each conflict before importing.
                  </p>
                  <div className="space-y-3">
                    {unresolvedConflicts.map((item, idx) => {
                      const itemIdx = csvItems.findIndex(i => i.sku === item.sku);
                      return (
                        <div key={item.sku} className="bg-zinc-800/50 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="text-zinc-300 text-sm font-medium">SKU: {item.sku}</p>
                              <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-zinc-500 text-xs">Existing in System:</p>
                                  <p className="text-emerald-400">{item.conflict.existingName}</p>
                                </div>
                                <div>
                                  <p className="text-zinc-500 text-xs">From CSV:</p>
                                  <p className="text-yellow-400">{item.conflict.newName}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => resolveConflict(itemIdx, 'use-existing')}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-500"
                              >
                                Keep Existing
                              </button>
                              <button
                                onClick={() => resolveConflict(itemIdx, 'use-new')}
                                className="px-3 py-1.5 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-500"
                              >
                                Use New Name
                              </button>
                              <button
                                onClick={() => resolveConflict(itemIdx, 'skip')}
                                className="px-3 py-1.5 bg-zinc-600 text-zinc-300 rounded text-xs hover:bg-zinc-500"
                              >
                                Skip Item
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {csvItems.map((item, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      item.action === 'skip' ? 'bg-zinc-800/30 border-zinc-700 opacity-50' :
                      item.hasConflict ? 'bg-red-500/5 border-red-500/30' :
                      item.isNew ? 'bg-yellow-500/5 border-yellow-500/30' :
                      'bg-emerald-500/5 border-emerald-500/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected && item.action !== 'skip'}
                      onChange={() => toggleCsvItemSelection(idx)}
                      disabled={item.action === 'skip'}
                      className="w-4 h-4 rounded border-zinc-600"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.action === 'skip' ? 'bg-zinc-600 text-zinc-400' :
                          item.hasConflict ? 'bg-red-500/20 text-red-400' :
                          item.isNew ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {item.action === 'skip' ? 'SKIP' :
                           item.hasConflict ? 'CONFLICT' :
                           item.isNew ? 'NEW' : 'MATCHED'}
                        </span>
                        <span className="text-xs text-zinc-500 font-mono">{item.sku}</span>
                      </div>
                      <p className="text-sm text-zinc-200 mt-1">{item.name}</p>
                      {item.category && (
                        <span className="text-xs text-zinc-500">{item.category}</span>
                      )}
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Qty</p>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateCsvItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                        className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                      />
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Price</p>
                      <p className="text-zinc-300 text-sm">{(item.unitCost || 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyCsvData}
                  disabled={unresolvedConflicts.length > 0 || csvItems.filter(i => i.selected && i.action !== 'skip').length === 0 || loading}
                  className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Importing...' :
                   unresolvedConflicts.length > 0
                    ? `Resolve ${unresolvedConflicts.length} Conflict${unresolvedConflicts.length > 1 ? 's' : ''} First`
                    : `Import ${csvItems.filter(i => i.selected && i.action !== 'skip').length} Items`
                  }
                </button>
                <button
                  onClick={() => { setShowCsvUpload(false); setCsvReviewMode(false); setCsvItems([]); }}
                  className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'stock', label: 'Stock Levels' },
          { id: 'expiry', label: 'Expiry Tracking' },
          { id: 'batches', label: 'All Batches' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
            {tab.id === 'expiry' && (expiredBatches.length > 0 || expiringBatches.length > 0) && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded">
                {expiredBatches.length + expiringBatches.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeSubTab === 'stock' && (
        <>
          {selectedWarehouse === 'all' ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                      {data.warehouses.map(wh => (
                        <th key={wh.id} className="text-right px-4 py-3 text-zinc-500 font-medium">{wh.name}</th>
                      ))}
                      <th className="text-right px-4 py-3 text-zinc-500 font-medium">Total</th>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Earliest Expiry</th>
                      <th className="text-right px-4 py-3 text-zinc-500 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(getAllStock()).length === 0 ? (
                      <tr>
                        <td colSpan={data.warehouses.length + 5} className="px-4 py-8 text-center text-zinc-600">
                          No stock recorded yet. Use "Add Stock" or "Upload CSV" to add inventory.
                        </td>
                      </tr>
                    ) : (
                      Object.entries(getAllStock()).map(([sku, locs]) => {
                        const total = Object.values(locs).reduce((a, b) => a + b, 0);
                        const product = data.products.find(p => p.sku === sku);
                        const value = (product?.unitCost || 0) * total;
                        const earliestExpiry = getEarliestExpiry(sku);
                        const expiryStatus = getExpiryStatus(earliestExpiry);
                        return (
                          <tr key={sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                            <td className="px-4 py-3 text-zinc-200">{product?.name || '-'}</td>
                            <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                            {data.warehouses.map(wh => (
                              <td key={wh.id} className="text-right px-4 py-3 text-zinc-400">{locs[wh.id] || '-'}</td>
                            ))}
                            <td className="text-right px-4 py-3 text-emerald-400 font-medium">{total}</td>
                            <td className="text-center px-4 py-3">
                              {earliestExpiry ? (
                                <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                  {new Date(earliestExpiry).toLocaleDateString('en-GB')}
                                </span>
                              ) : (
                                <span className="text-zinc-600 text-xs">-</span>
                              )}
                            </td>
                            <td className="text-right px-4 py-3 text-zinc-400">{value.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Quantity</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Earliest Expiry</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Value</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(getStockForWarehouse(selectedWarehouse)).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                        No stock in this warehouse. Use "Add Stock" or "Upload CSV" to add inventory.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(getStockForWarehouse(selectedWarehouse)).map(([sku, qty]) => {
                      const product = data.products.find(p => p.sku === sku);
                      const value = (product?.unitCost || 0) * qty;
                      const earliestExpiry = getEarliestExpiry(sku, selectedWarehouse);
                      const expiryStatus = getExpiryStatus(earliestExpiry);
                      return (
                        <tr key={sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-3 text-zinc-200">{product?.name || '-'}</td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                          <td className="text-right px-4 py-3 text-emerald-400 font-medium">{qty}</td>
                          <td className="text-center px-4 py-3">
                            {earliestExpiry ? (
                              <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                {new Date(earliestExpiry).toLocaleDateString('en-GB')}
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-xs">-</span>
                            )}
                          </td>
                          <td className="text-right px-4 py-3 text-zinc-400">{value.toFixed(2)}</td>
                          <td className="text-right px-4 py-3">
                            <button
                              onClick={() => openEditStock(selectedWarehouse, sku, qty)}
                              className="text-emerald-400 hover:text-emerald-300 text-sm"
                            >
                              Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeSubTab === 'expiry' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{expiredBatches.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Expired Batches</div>
              <div className="text-xs text-red-400 mt-1">
                {expiredBatches.reduce((acc, b) => acc + b.remainingQty, 0)} units affected
              </div>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {getBatches().filter(b => getExpiryStatus(b.expiryDate)?.status === 'critical').length}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Expiring in 7 days</div>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {getBatches().filter(b => getExpiryStatus(b.expiryDate)?.status === 'warning').length}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Expiring in 30 days</div>
            </div>
          </div>

          {/* Expiring/Expired items list */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400">Items Requiring Attention</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry Date</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {getBatches()
                  .filter(b => {
                    const status = getExpiryStatus(b.expiryDate);
                    return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                  })
                  .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
                  .map(batch => {
                    const product = data.products.find(p => p.sku === batch.sku);
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    return (
                      <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3">
                          <div className="text-zinc-200">{product?.name || batch.sku}</div>
                          <div className="text-zinc-600 text-xs">{batch.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>
                        <td className="text-right px-4 py-3 text-zinc-300">{batch.remainingQty}</td>
                        <td className="text-center px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                            {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                          </span>
                        </td>
                        <td className="text-center px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                            {expiryStatus?.status === 'expired' ? 'EXPIRED' : expiryStatus?.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                {getBatches().filter(b => {
                  const status = getExpiryStatus(b.expiryDate);
                  return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                }).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                      No items expiring soon
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'batches' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Received</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Condition</th>
              </tr>
            </thead>
            <tbody>
              {getBatches().length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No batch records</td>
                </tr>
              ) : (
                getBatches()
                  .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
                  .map(batch => {
                    const product = data.products.find(p => p.sku === batch.sku);
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    return (
                      <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3">
                          <div className="text-zinc-200">{product?.name || batch.sku}</div>
                          <div className="text-zinc-600 text-xs">{batch.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>
                        <td className="text-right px-4 py-3 text-zinc-300">{batch.remainingQty}</td>
                        <td className="text-center px-4 py-3">
                          {batch.expiryDate ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                              {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">-</span>
                          )}
                        </td>
                        <td className="text-center px-4 py-3 text-zinc-500 text-xs">
                          {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                        </td>
                        <td className="text-center px-4 py-3">
                          {batch.hasDamage ? (
                            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={batch.damageNotes}>
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
                  })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
