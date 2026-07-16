import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';
import inventoryService from '../../services/inventory.service';
import vendliveService from '../../services/vendlive.service';

export default function Inventory() {
  const { data, addProduct, updateProduct, bulkImportProducts, updateWarehouseStock, bulkUpdateWarehouseStock, createBatch, updateBatch, deleteBatch, transferWarehouseStock, refresh } = useStock();
  // Single-warehouse installs (the norm today) hide every warehouse selector,
  // column and per-row warehouse label. Adding a second warehouse in the DB
  // lights them all back up — nothing is hard-deleted.
  const multiWarehouse = data.warehouses.length > 1;
  const [selectedWarehouseState, setSelectedWarehouse] = useState('all');
  // With exactly one warehouse the view is pinned to it so the richer
  // per-warehouse table/cards render instead of the all-warehouses matrix.
  const selectedWarehouse = multiWarehouse
    ? selectedWarehouseState
    : (data.warehouses[0]?.id || 'all');
  const [activeSubTab, setActiveSubTab] = useState('stock');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Inline "set expiry" edits on the Missing Expiry list, keyed by batch id
  const [expiryEdits, setExpiryEdits] = useState({});
  const [savingExpiryId, setSavingExpiryId] = useState(null);

  // Missing-cost-price drill-down on the Stock Levels finance tiles
  const [showMissingCost, setShowMissingCost] = useState(false);
  const [costEdits, setCostEdits] = useState({});
  const [savingCostSku, setSavingCostSku] = useState(null);

  // Stock Levels search (product name, SKU or category)
  const [stockSearch, setStockSearch] = useState('');
  const isStockSearching = stockSearch.trim().length > 0;
  const matchesStockSearch = (sku) => {
    const query = stockSearch.trim().toLowerCase();
    if (!query) return true;
    const product = data.products.find(p => p.sku === sku);
    const haystack = `${product?.name || ''} ${sku} ${product?.category || ''}`.toLowerCase();
    return query.split(/\s+/).every(token => haystack.includes(token));
  };

  // Expiry / All Batches search (product name, SKU or category) — shared by
  // the two batch-centric tabs so the query survives switching between them.
  const [batchSearch, setBatchSearch] = useState('');
  const matchesBatchSearch = (sku) => {
    const query = batchSearch.trim().toLowerCase();
    if (!query) return true;
    const product = data.products.find(p => p.sku === sku);
    const haystack = `${product?.name || ''} ${sku} ${product?.category || ''}`.toLowerCase();
    return query.split(/\s+/).every(token => haystack.includes(token));
  };

  // Add Stock states
  const [showAddStock, setShowAddStock] = useState(false);
  // Explicit flag for "adding a brand-new product". The new product's SKU
  // lives in its own newSku field so typing it can't collapse the new-product
  // block (which previously keyed off sku === '').
  const [isNewProduct, setIsNewProduct] = useState(false);
  const [addStockForm, setAddStockForm] = useState({
    warehouseId: '',
    sku: '',
    newSku: '',
    productName: '',
    quantity: '',
    category: 'Other',
    unitCost: '',
    expiryDate: ''
  });

  // Edit Stock states
  const [editingStock, setEditingStock] = useState(null); // { warehouseId, sku, currentQty }
  const [editStockQty, setEditStockQty] = useState('');

  // Warehouse-to-warehouse transfer states
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ fromWarehouseId: '', toWarehouseId: '', notes: '' });
  const [transferQtys, setTransferQtys] = useState({}); // { [sku]: qtyString }
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState(null);
  // Recent transfers history
  const [showTransfers, setShowTransfers] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [transfersLoaded, setTransfersLoaded] = useState(false);

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

  // Stock Levels rows: zero-quantity items hidden, grouped by product
  // category (alphabetical), products alphabetical within each group.
  // While searching, zero-stock items are INCLUDED so the search answers
  // "do we have any X?" honestly with a 0 rather than hiding the row.
  // Returns { groups: [{ category, items }], hiddenCount }.
  const groupStockRows = (rows) => {
    const searched = rows.filter(r => matchesStockSearch(r.sku));
    const visible = isStockSearching ? searched : searched.filter(r => r.total > 0);
    const groups = {};
    visible.forEach(row => {
      const product = data.products.find(p => p.sku === row.sku);
      const category = product?.category || 'Uncategorised';
      if (!groups[category]) groups[category] = [];
      groups[category].push({ ...row, product });
    });
    return {
      groups: Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, items]) => ({
          category,
          items: items.sort((x, y) =>
            (x.product?.name || x.sku).localeCompare(y.product?.name || y.sku)
          ),
        })),
      hiddenCount: searched.length - visible.length,
    };
  };

  // Finance snapshot for the Stock Levels tab: units held and their value at
  // COST price (product.unitCost — synced from VendLive cost price for
  // auto-created products, editable in the product editor). Respects the
  // warehouse selector. Products in stock with no cost price are counted
  // separately — they contribute £0, so the total understates true value
  // until their costs are filled in.
  const stockSummary = (() => {
    const rows = selectedWarehouse === 'all'
      ? Object.entries(getAllStock()).map(([sku, locs]) => ({
          sku,
          qty: Object.values(locs).reduce((a, b) => a + b, 0),
        }))
      : Object.entries(getStockForWarehouse(selectedWarehouse)).map(([sku, qty]) => ({ sku, qty }));

    let products = 0, units = 0, value = 0, revenue = 0, missingPrice = 0;
    const missing = [];
    rows.forEach(r => {
      if (r.qty <= 0) return;
      const product = data.products.find(p => p.sku === r.sku);
      products++;
      units += r.qty;
      if (product?.unitCost) {
        value += product.unitCost * r.qty;
      } else {
        missing.push({ sku: r.sku, name: product?.name || r.sku, qty: r.qty });
      }
      // Expected revenue if every unit held sells at its VendLive sale price
      if (product?.salePrice) {
        revenue += product.salePrice * r.qty;
      } else {
        missingPrice++;
      }
    });
    missing.sort((a, b) => b.qty - a.qty); // biggest holdings first — they distort the total most
    return { products, units, value, revenue, missingPrice, missing, missingCost: missing.length };
  })();

  const saveProductCost = async (sku) => {
    const value = parseFloat(costEdits[sku]);
    if (!value || value <= 0) return;
    setSavingCostSku(sku);
    setError(null);
    try {
      await updateProduct(sku, { unitCost: value });
      setCostEdits(prev => {
        const next = { ...prev };
        delete next[sku];
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to set cost price');
    } finally {
      setSavingCostSku(null);
    }
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

  // Summary stats
  const expiredBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'expired';
  });
  const expiringBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'critical' || status?.status === 'warning';
  });
  // Batches signed in without an expiry date — surfaced for correction
  const missingExpiryBatches = getBatches().filter(b => !b.expiryDate);

  // Search-narrowed views for the Expiry and All Batches tabs. Summary cards
  // and the tab badge stay unfiltered — they always reflect the whole
  // warehouse, only the lists narrow.
  const searchedBatches = () => getBatches().filter(b => matchesBatchSearch(b.sku));
  const searchedMissingExpiry = missingExpiryBatches.filter(b => matchesBatchSearch(b.sku));

  const batchSearchBox = (
    <div className="relative flex-1 max-w-md">
      <input
        type="search"
        value={batchSearch}
        onChange={e => setBatchSearch(e.target.value)}
        placeholder="Search batches — product, SKU, category..."
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600"
      />
      {batchSearch.trim() && (
        <button
          onClick={() => setBatchSearch('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
          title="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );

  const saveBatchExpiry = async (batchId) => {
    const value = expiryEdits[batchId];
    if (!value) return;
    setSavingExpiryId(batchId);
    setError(null);
    try {
      await updateBatch(batchId, { expiryDate: value });
      setExpiryEdits(prev => {
        const next = { ...prev };
        delete next[batchId];
        return next;
      });
    } catch (err) {
      setError(err.message || 'Failed to set expiry date');
    } finally {
      setSavingExpiryId(null);
    }
  };

  // ===== PER-PRODUCT BATCH VIEW / EDIT =====

  // Expanded product on the Stock Levels tab: `${sku}` (all-warehouses view) or
  // `${sku}|${warehouseId}` (single-warehouse view).
  const [expandedBatchKey, setExpandedBatchKey] = useState(null);
  // Inline batch edits keyed by batch id: { remainingQty, expiryDate, hasDamage }
  const [batchEdits, setBatchEdits] = useState({});
  const [savingBatchId, setSavingBatchId] = useState(null);
  const [deletingBatchId, setDeletingBatchId] = useState(null);

  // VendLive product-catalog sync (pulls all VendLive products into our DB)
  const [syncingProducts, setSyncingProducts] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);

  // Batches with remaining stock for a SKU, earliest-expiry first (FEFO order);
  // missing-expiry batches sort last, oldest received first as a tiebreak.
  const batchesForSku = (sku, warehouseId = null) =>
    (data.stockBatches || [])
      .filter(b => b.sku === sku && b.remainingQty > 0 && (warehouseId ? b.warehouseId === warehouseId : true))
      .sort((a, b) => {
        if (!a.expiryDate && !b.expiryDate) return new Date(a.receivedAt) - new Date(b.receivedAt);
        if (!a.expiryDate) return 1;
        if (!b.expiryDate) return -1;
        return new Date(a.expiryDate) - new Date(b.expiryDate);
      });

  const startBatchEdit = (batch) => setBatchEdits(prev => ({
    ...prev,
    [batch.id]: {
      remainingQty: String(batch.remainingQty),
      expiryDate: batch.expiryDate ? new Date(batch.expiryDate).toISOString().slice(0, 10) : '',
      hasDamage: !!batch.hasDamage,
    },
  }));

  const cancelBatchEdit = (batchId) => setBatchEdits(prev => {
    const next = { ...prev };
    delete next[batchId];
    return next;
  });

  const saveBatchEditRow = async (batchId) => {
    const edit = batchEdits[batchId];
    if (!edit) return;
    const qty = parseInt(edit.remainingQty);
    if (isNaN(qty) || qty < 0) { setError('Quantity must be 0 or more'); return; }
    setSavingBatchId(batchId);
    setError(null);
    try {
      await updateBatch(batchId, {
        remainingQty: qty,
        expiryDate: edit.expiryDate || null,
        hasDamage: edit.hasDamage,
      });
      cancelBatchEdit(batchId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update batch');
    } finally {
      setSavingBatchId(null);
    }
  };

  const deleteBatchRow = async (batchId) => {
    if (!window.confirm('Delete this batch? Its units are removed from stock. If this is wastage you need to record, use write-off instead.')) return;
    setDeletingBatchId(batchId);
    setError(null);
    try {
      await deleteBatch(batchId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete batch');
    } finally {
      setDeletingBatchId(null);
    }
  };

  const handleSyncProducts = async () => {
    setSyncingProducts(true);
    setSyncMessage(null);
    setError(null);
    try {
      const result = await vendliveService.syncProducts();
      setSyncMessage(`Synced ${result.total} VendLive products — ${result.created} new, ${result.updated} updated.`);
      // New products won't be in context until we reload the dataset.
      if (refresh) await refresh();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Product sync failed');
    } finally {
      setSyncingProducts(false);
    }
  };

  // Expandable batch breakdown for a product row on the Stock Levels tab.
  // Rendered as a full-width sub-row; reused by both the all-warehouses and
  // single-warehouse tables (pass warehouseId to scope to one warehouse).
  const renderBatchDetailRow = (sku, warehouseId, colSpan) => {
    const batches = batchesForSku(sku, warehouseId);
    return (
      <tr key={`${sku}-${warehouseId || 'all'}-batches`} className="bg-zinc-950/40">
        <td colSpan={colSpan} className="px-4 py-3">
          <div className="text-xs text-zinc-500 mb-2">Batches — earliest expiry first (taken out first)</div>
          {batches.length === 0 ? (
            <div className="text-zinc-600 text-sm">No batches with remaining stock.</div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-zinc-500">
                  <th className="text-left py-1 font-medium">Qty</th>
                  <th className="text-left py-1 font-medium">Expiry</th>
                  {!warehouseId && multiWarehouse && <th className="text-left py-1 font-medium">Warehouse</th>}
                  <th className="text-left py-1 font-medium">Received</th>
                  <th className="text-left py-1 font-medium">Condition</th>
                  <th className="text-right py-1 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map(batch => {
                  const editing = batchEdits[batch.id];
                  const wh = data.warehouses.find(w => w.id === batch.warehouseId);
                  const status = getExpiryStatus(batch.expiryDate);
                  return (
                    <tr key={batch.id} className="border-t border-zinc-800/50">
                      <td className="py-1.5 pr-3">
                        {editing ? (
                          <input
                            type="number" min="0" value={editing.remainingQty}
                            onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], remainingQty: e.target.value } }))}
                            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
                          />
                        ) : <span className="text-zinc-200">{batch.remainingQty}</span>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {editing ? (
                          <input
                            type="date" value={editing.expiryDate}
                            onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], expiryDate: e.target.value } }))}
                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
                          />
                        ) : batch.expiryDate ? (
                          <span className={`px-2 py-0.5 rounded ${status?.color || ''}`}>{new Date(batch.expiryDate).toLocaleDateString('en-GB')}</span>
                        ) : <span className="text-amber-400">No expiry</span>}
                      </td>
                      {!warehouseId && multiWarehouse && <td className="py-1.5 pr-3 text-zinc-400">{wh?.name || batch.warehouseId}</td>}
                      <td className="py-1.5 pr-3 text-zinc-500">{new Date(batch.receivedAt).toLocaleDateString('en-GB')}</td>
                      <td className="py-1.5 pr-3">
                        {editing ? (
                          <label className="flex items-center gap-1 text-zinc-400">
                            <input
                              type="checkbox" checked={editing.hasDamage}
                              onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], hasDamage: e.target.checked } }))}
                            />
                            Damaged
                          </label>
                        ) : batch.hasDamage ? <span className="text-red-400">Damaged</span> : <span className="text-emerald-400">OK</span>}
                      </td>
                      <td className="py-1.5 text-right whitespace-nowrap">
                        {editing ? (
                          <>
                            <button
                              onClick={() => saveBatchEditRow(batch.id)} disabled={savingBatchId === batch.id}
                              className="px-2 py-1 bg-emerald-600 text-white rounded mr-1 disabled:opacity-50"
                            >
                              {savingBatchId === batch.id ? '...' : 'Save'}
                            </button>
                            <button onClick={() => cancelBatchEdit(batch.id)} className="px-2 py-1 bg-zinc-700 text-zinc-300 rounded">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startBatchEdit(batch)} className="text-emerald-400 hover:text-emerald-300 mr-3">Edit</button>
                            <button
                              onClick={() => deleteBatchRow(batch.id)} disabled={deletingBatchId === batch.id}
                              className="text-red-400 hover:text-red-300 disabled:opacity-50"
                            >
                              {deletingBatchId === batch.id ? '...' : 'Delete'}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </td>
      </tr>
    );
  };

  // Clickable expiry/batch summary cell for a Stock Levels product row.
  const renderBatchSummaryCell = (sku, warehouseId) => {
    const key = warehouseId ? `${sku}|${warehouseId}` : sku;
    const skuBatches = batchesForSku(sku, warehouseId);
    if (skuBatches.length === 0) return <span className="text-zinc-600 text-xs">-</span>;
    const earliest = skuBatches.find(b => b.expiryDate)?.expiryDate || null;
    const st = getExpiryStatus(earliest);
    const isOpen = expandedBatchKey === key;
    return (
      <button
        onClick={() => setExpandedBatchKey(isOpen ? null : key)}
        className="inline-flex items-center gap-1.5 text-xs hover:underline"
        title="View / edit batches"
      >
        <span className="text-zinc-500">{isOpen ? '▾' : '▸'}</span>
        <span className={`px-2 py-0.5 rounded ${st?.color || 'text-zinc-400'}`}>
          {earliest ? new Date(earliest).toLocaleDateString('en-GB') : 'No expiry'}
        </span>
        <span className="text-zinc-500">· {skuBatches.length} batch{skuBatches.length === 1 ? '' : 'es'}</span>
      </button>
    );
  };

  // ===== ADD STOCK FUNCTIONS =====

  const openAddStock = () => {
    setAddStockForm({
      warehouseId: selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || ''),
      sku: '',
      newSku: '',
      productName: '',
      quantity: '',
      category: 'Other',
      unitCost: '',
      expiryDate: ''
    });
    setIsNewProduct(false);
    setShowAddStock(true);
    setError(null);
  };

  const closeAddStock = () => {
    setShowAddStock(false);
    setIsNewProduct(false);
  };

  const handleAddStockSubmit = async () => {
    const sku = isNewProduct ? addStockForm.newSku.trim() : addStockForm.sku;
    if (!addStockForm.warehouseId || !sku || !addStockForm.quantity) return;
    if (isNewProduct && !addStockForm.productName.trim()) return;

    const qty = parseInt(addStockForm.quantity) || 0;
    if (qty <= 0) return;

    setLoading(true);
    setError(null);

    try {
      if (isNewProduct) {
        // Create the product first (unless the typed SKU already exists)
        const existingProduct = data.products.find(p => p.sku === sku);
        if (!existingProduct) {
          await addProduct({
            sku,
            name: addStockForm.productName.trim(),
            category: addStockForm.category,
            unitCost: parseFloat(addStockForm.unitCost) || 0,
            salePrice: parseFloat(addStockForm.unitCost) || 0
          });
        }
      }

      // Add the stock as a batch — batches are authoritative, so creating the
      // batch raises the warehouse total. No separate stock write (which would
      // double-count). No expiry typed -> null expiry, flagged as "missing".
      await createBatch({
        warehouseId: addStockForm.warehouseId,
        sku,
        quantity: qty,
        expiryDate: addStockForm.expiryDate || null,
      });

      closeAddStock();
    } catch (err) {
      setError(err.message || 'Failed to add stock');
    } finally {
      setLoading(false);
    }
  };

  // ===== Warehouse-to-warehouse transfer =====
  const openTransfer = () => {
    const from = selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || '');
    const to = data.warehouses.find(w => w.id !== from)?.id || '';
    setTransferForm({ fromWarehouseId: from, toWarehouseId: to, notes: '' });
    setTransferQtys({});
    setTransferError(null);
    setShowTransfer(true);
  };

  const refreshTransfers = async () => {
    try {
      const list = await inventoryService.getTransfers();
      setTransfers(list);
      setTransfersLoaded(true);
    } catch (err) {
      // history is best-effort; don't block the page
      setTransfersLoaded(true);
    }
  };

  const toggleTransfers = () => {
    const next = !showTransfers;
    setShowTransfers(next);
    if (next && !transfersLoaded) refreshTransfers();
  };

  const handleTransferSubmit = async () => {
    const { fromWarehouseId, toWarehouseId, notes } = transferForm;
    if (!fromWarehouseId || !toWarehouseId) return;
    if (fromWarehouseId === toWarehouseId) {
      setTransferError('Source and destination warehouses must differ');
      return;
    }
    const sourceStock = data.stock[fromWarehouseId] || {};
    const items = [];
    for (const [sku, raw] of Object.entries(transferQtys)) {
      const qty = parseInt(raw) || 0;
      if (qty <= 0) continue;
      const available = sourceStock[sku] || 0;
      if (qty > available) {
        setTransferError(`Cannot transfer ${qty} of ${sku}: only ${available} available`);
        return;
      }
      items.push({ sku, quantity: qty });
    }
    if (items.length === 0) {
      setTransferError('Enter a quantity for at least one product');
      return;
    }

    setTransferring(true);
    setTransferError(null);
    try {
      await transferWarehouseStock({ fromWarehouseId, toWarehouseId, items, notes: notes || undefined });
      setShowTransfer(false);
      if (transfersLoaded) refreshTransfers();
    } catch (err) {
      setTransferError(err.response?.data?.error || err.message || 'Transfer failed');
    } finally {
      setTransferring(false);
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
          {multiWarehouse && (
            <select
              value={selectedWarehouse}
              onChange={e => setSelectedWarehouse(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="all">All Warehouses</option>
              {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <button
              onClick={openAddStock}
              className="flex-1 sm:flex-none px-3 py-2.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
            >
              + Add Stock
            </button>
            <button
              onClick={openTransfer}
              disabled={data.warehouses.length < 2}
              title={data.warehouses.length < 2 ? 'Needs at least two warehouses' : 'Transfer stock between warehouses'}
              className="flex-1 sm:flex-none px-3 py-2.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              Transfer
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
            <button
              onClick={handleSyncProducts}
              disabled={syncingProducts}
              title="Pull the full product catalogue from VendLive so every product exists here, even ones never sold"
              className="flex-1 sm:flex-none px-3 py-2.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
            >
              {syncingProducts ? 'Syncing…' : 'Sync VendLive'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {syncMessage && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-lg p-4 text-indigo-300 text-sm flex items-center justify-between gap-4">
          <span>{syncMessage}</span>
          <button onClick={() => setSyncMessage(null)} className="text-indigo-400 hover:text-indigo-200">×</button>
        </div>
      )}

      {/* Add Stock Modal */}
      {showAddStock && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">Add Stock</h3>
            <button onClick={closeAddStock} className="text-zinc-500 hover:text-zinc-300 text-xl">x</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {multiWarehouse && (
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
            )}
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Product *</label>
              <select
                value={isNewProduct ? '__new__' : addStockForm.sku}
                onChange={e => {
                  const sku = e.target.value;
                  if (sku === '__new__') {
                    setIsNewProduct(true);
                    setAddStockForm({ ...addStockForm, sku: '', newSku: '', productName: '', category: 'Other', unitCost: '' });
                  } else {
                    setIsNewProduct(false);
                    const existing = data.products.find(p => p.sku === sku);
                    setAddStockForm({
                      ...addStockForm,
                      sku,
                      newSku: '',
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
            {isNewProduct && (
              <>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">New SKU *</label>
                  <input
                    type="text"
                    value={addStockForm.newSku}
                    onChange={e => setAddStockForm({ ...addStockForm, newSku: e.target.value })}
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

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Expiry Date</label>
              <input
                type="date"
                value={addStockForm.expiryDate}
                onChange={e => setAddStockForm({ ...addStockForm, expiryDate: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
              <p className="text-xs text-zinc-600 mt-1">Optional — if left blank the batch is flagged under Expiry Tracking as missing an expiry.</p>
            </div>
          </div>

          {addStockForm.sku && data.products.find(p => p.sku === addStockForm.sku) && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
              <p className="text-emerald-400 text-sm">
                Adding a new batch to: <strong>{data.products.find(p => p.sku === addStockForm.sku)?.name}</strong>
                {addStockForm.warehouseId && (
                  <span className="text-zinc-400 ml-2">
                    (Current stock: {(data.stock[addStockForm.warehouseId] || {})[addStockForm.sku] || 0})
                  </span>
                )}
              </p>
              {(() => {
                const existing = batchesForSku(addStockForm.sku, addStockForm.warehouseId || null);
                if (existing.length === 0) {
                  return <p className="text-xs text-zinc-500">No existing batches{addStockForm.warehouseId ? ' in this warehouse' : ''} — this will be the first.</p>;
                }
                return (
                  <div className="text-xs text-zinc-400">
                    <p className="text-zinc-500 mb-1">Existing batches (this add creates a separate one):</p>
                    <ul className="space-y-0.5">
                      {existing.map(b => (
                        <li key={b.id} className="flex items-center gap-2">
                          <span className="text-zinc-300">{b.remainingQty} units</span>
                          <span className="text-zinc-600">·</span>
                          <span>{b.expiryDate ? `expires ${new Date(b.expiryDate).toLocaleDateString('en-GB')}` : 'no expiry'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={handleAddStockSubmit}
              disabled={
                !addStockForm.warehouseId ||
                (isNewProduct ? (!addStockForm.newSku.trim() || !addStockForm.productName.trim()) : !addStockForm.sku) ||
                !addStockForm.quantity ||
                loading
              }
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {loading ? 'Adding...' : 'Add Stock'}
            </button>
            <button
              onClick={closeAddStock}
              className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transfer Stock Modal */}
      {showTransfer && (() => {
        const { fromWarehouseId, toWarehouseId } = transferForm;
        const sourceStock = data.stock[fromWarehouseId] || {};
        const sourceRows = Object.entries(sourceStock)
          .filter(([, qty]) => qty > 0)
          .map(([sku, qty]) => ({ sku, qty, name: data.products.find(p => p.sku === sku)?.name || sku }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const totalToMove = Object.values(transferQtys).reduce((sum, v) => sum + (parseInt(v) || 0), 0);
        return (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-zinc-200">Transfer Stock Between Warehouses</h3>
              <button onClick={() => setShowTransfer(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">x</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">From *</label>
                <select
                  value={fromWarehouseId}
                  onChange={e => { setTransferForm({ ...transferForm, fromWarehouseId: e.target.value }); setTransferQtys({}); }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                >
                  {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">To *</label>
                <select
                  value={toWarehouseId}
                  onChange={e => setTransferForm({ ...transferForm, toWarehouseId: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                >
                  <option value="">Select destination...</option>
                  {data.warehouses.filter(w => w.id !== fromWarehouseId).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-2">Products to move (max = available at source)</label>
              {sourceRows.length === 0 ? (
                <p className="text-zinc-500 text-sm">No stock available at the source warehouse.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-zinc-800 rounded divide-y divide-zinc-800">
                  {sourceRows.map(row => (
                    <div key={row.sku} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-200 truncate">{row.name}</p>
                        <p className="text-xs text-zinc-500">{row.sku} · {row.qty} available</p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        max={row.qty}
                        value={transferQtys[row.sku] || ''}
                        onChange={e => setTransferQtys({ ...transferQtys, [row.sku]: e.target.value })}
                        placeholder="0"
                        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-right"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1">Notes</label>
              <input
                type="text"
                value={transferForm.notes}
                onChange={e => setTransferForm({ ...transferForm, notes: e.target.value })}
                placeholder="Optional — reason / reference"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>

            {transferError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {transferError}
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-zinc-800">
              <button
                onClick={handleTransferSubmit}
                disabled={!toWarehouseId || totalToMove <= 0 || transferring}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                {transferring ? 'Transferring...' : `Transfer${totalToMove > 0 ? ` ${totalToMove} unit${totalToMove === 1 ? '' : 's'}` : ''}`}
              </button>
              <button
                onClick={() => setShowTransfer(false)}
                className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

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
            {multiWarehouse && (
              <p className="text-zinc-400 text-sm mt-1">
                <span className="text-zinc-500">Warehouse:</span>{' '}
                <span className="text-zinc-200">{data.warehouses.find(w => w.id === editingStock.warehouseId)?.name}</span>
              </p>
            )}
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
              {multiWarehouse && (
                <p className="text-zinc-500 text-sm mt-1">
                  {selectedWarehouse !== 'all'
                    ? `Importing to: ${data.warehouses.find(w => w.id === selectedWarehouse)?.name}`
                    : `Importing to: ${data.warehouses[0]?.name || 'Default Warehouse'}`
                  }
                </p>
              )}
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
            {tab.id === 'expiry' && missingExpiryBatches.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-amber-500 text-zinc-900 rounded" title="Batches missing an expiry date">
                {missingExpiryBatches.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeSubTab === 'stock' && (
        <>
          {/* Finance snapshot — stock held and its value at cost price */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-zinc-200">{stockSummary.units.toLocaleString('en-GB')}</div>
              <div className="text-xs text-zinc-500 mt-1">Units in stock</div>
              <div className="text-xs text-zinc-600 mt-1">
                {stockSummary.products.toLocaleString('en-GB')} product{stockSummary.products === 1 ? '' : 's'}
                {multiWarehouse && selectedWarehouse !== 'all' && ` · ${data.warehouses.find(w => w.id === selectedWarehouse)?.name || ''}`}
              </div>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">
                £{stockSummary.value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Stock value (at cost)</div>
              <div className="text-xs text-zinc-600 mt-1">Sum of cost price × quantity held</div>
            </div>
            <div className="bg-sky-900/20 border border-sky-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-sky-400">
                £{stockSummary.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Expected revenue</div>
              {stockSummary.missingPrice > 0 ? (
                <div className="text-xs text-amber-400 mt-1">
                  {stockSummary.missingPrice} product{stockSummary.missingPrice === 1 ? '' : 's'} missing sale price (count as £0)
                </div>
              ) : (
                <div className="text-xs text-zinc-600 mt-1">
                  Potential margin: £{(stockSummary.revenue - stockSummary.value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowMissingCost(s => !s)}
              disabled={stockSummary.missingCost === 0}
              className={`rounded-lg p-4 border text-left transition-colors ${
                stockSummary.missingCost > 0
                  ? 'bg-amber-900/20 border-amber-700/50 hover:border-amber-500 cursor-pointer'
                  : 'bg-zinc-900/50 border-zinc-800 cursor-default'
              }`}
            >
              <div className={`text-2xl font-bold ${stockSummary.missingCost > 0 ? 'text-amber-400' : 'text-zinc-200'}`}>
                {stockSummary.missingCost}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Products missing cost price</div>
              {stockSummary.missingCost > 0 && (
                <div className="text-xs text-amber-400 mt-1">
                  These count as £0 — {showMissingCost ? 'click to hide list' : 'click to view & fix'}
                </div>
              )}
            </button>
          </div>

          {/* Drill-down: which products have no cost price, fixable inline */}
          {showMissingCost && stockSummary.missingCost > 0 && (
            <div className="bg-zinc-900/50 border border-amber-700/50 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                <h3 className="text-sm font-medium text-amber-400">Products Missing Cost Price</h3>
                <span className="text-xs text-zinc-500">— largest holdings first; set a cost and it leaves this list</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units held</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Set Cost Price</th>
                  </tr>
                </thead>
                <tbody>
                  {stockSummary.missing.map(item => (
                    <tr key={item.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-200">{item.name}</td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">{item.sku}</td>
                      <td className="text-right px-4 py-3 text-zinc-300">{item.qty}</td>
                      <td className="text-center px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <span className="text-zinc-500 text-sm">£</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={costEdits[item.sku] || ''}
                            onChange={e => setCostEdits(prev => ({ ...prev, [item.sku]: e.target.value }))}
                            className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-right focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => saveProductCost(item.sku)}
                            disabled={!parseFloat(costEdits[item.sku]) || savingCostSku === item.sku}
                            className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingCostSku === item.sku ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Stock search — works in single-warehouse and all-warehouses views */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                value={stockSearch}
                onChange={e => setStockSearch(e.target.value)}
                placeholder="Search stock — product, SKU, category..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600"
              />
              {isStockSearching && (
                <button
                  onClick={() => setStockSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  title="Clear search"
                >
                  ×
                </button>
              )}
            </div>
            {isStockSearching && (
              <span className="text-xs text-zinc-500">includes out-of-stock items</span>
            )}
          </div>

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
                    {(() => {
                      const allRows = Object.entries(getAllStock()).map(([sku, locs]) => ({
                        sku,
                        locs,
                        total: Object.values(locs).reduce((a, b) => a + b, 0),
                      }));
                      const colCount = data.warehouses.length + 5;
                      if (allRows.length === 0) {
                        return (
                          <tr>
                            <td colSpan={colCount} className="px-4 py-8 text-center text-zinc-600">
                              No stock recorded yet. Use "Add Stock" or "Upload CSV" to add inventory.
                            </td>
                          </tr>
                        );
                      }
                      const { groups, hiddenCount } = groupStockRows(allRows);
                      if (groups.length === 0) {
                        return (
                          <tr>
                            <td colSpan={colCount} className="px-4 py-8 text-center text-zinc-600">
                              {isStockSearching ? 'No stock items match your search.' : `All ${hiddenCount} item(s) are out of stock.`}
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <>
                          {groups.map(group => (
                            <React.Fragment key={group.category}>
                              <tr className="bg-zinc-800/60">
                                <td colSpan={colCount} className="px-4 py-2">
                                  <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                                  <span className="text-zinc-500 text-xs ml-3">
                                    {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, r) => acc + r.total, 0)} units
                                  </span>
                                </td>
                              </tr>
                              {group.items.map(({ sku, locs, total, product }) => {
                                const value = (product?.unitCost || 0) * total;
                                return (
                                  <React.Fragment key={sku}>
                                    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                      <td className="px-4 py-3 text-zinc-200">{product?.name || '-'}</td>
                                      <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                                      {data.warehouses.map(wh => (
                                        <td key={wh.id} className="text-right px-4 py-3 text-zinc-400">{locs[wh.id] || '-'}</td>
                                      ))}
                                      <td className="text-right px-4 py-3 text-emerald-400 font-medium">{total}</td>
                                      <td className="text-center px-4 py-3">{renderBatchSummaryCell(sku, null)}</td>
                                      <td className="text-right px-4 py-3 text-zinc-400">{value.toFixed(2)}</td>
                                    </tr>
                                    {expandedBatchKey === sku && renderBatchDetailRow(sku, null, colCount)}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          ))}
                          {hiddenCount > 0 && (
                            <tr>
                              <td colSpan={colCount} className="px-4 py-2 text-center text-zinc-600 text-xs">
                                {hiddenCount} out-of-stock item{hiddenCount === 1 ? '' : 's'} hidden
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              {/* Mobile stacked cards */}
              <div className="md:hidden">
                {(() => {
                  const whRows = Object.entries(getStockForWarehouse(selectedWarehouse)).map(([sku, qty]) => ({
                    sku,
                    total: qty,
                  }));
                  if (whRows.length === 0) {
                    return (
                      <p className="px-4 py-8 text-center text-zinc-600 text-sm">
                        No stock in this warehouse. Use "Add Stock" or "Upload CSV" to add inventory.
                      </p>
                    );
                  }
                  const { groups, hiddenCount } = groupStockRows(whRows);
                  if (groups.length === 0) {
                    return (
                      <p className="px-4 py-8 text-center text-zinc-600 text-sm">
                        {isStockSearching ? 'No stock items match your search.' : `All ${hiddenCount} item(s) are out of stock in this warehouse.`}
                      </p>
                    );
                  }
                  return (
                    <>
                      {groups.map(group => (
                        <React.Fragment key={group.category}>
                          <div className="bg-zinc-800/60 px-4 py-2">
                            <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, r) => acc + r.total, 0)} units
                            </span>
                          </div>
                          {group.items.map(({ sku, total: qty, product }) => {
                            const value = (product?.unitCost || 0) * qty;
                            return (
                              <div key={sku} className="border-b border-zinc-800/50 px-4 py-3 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="min-w-0 text-zinc-200 text-sm">{product?.name || '-'}</p>
                                  <div className="text-right shrink-0">
                                    <p className="text-emerald-400 font-bold text-lg leading-tight">{qty}</p>
                                    <p className="text-zinc-500 text-xs">£{value.toFixed(2)}</p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  {renderBatchSummaryCell(sku, selectedWarehouse)}
                                  <button
                                    onClick={() => openEditStock(selectedWarehouse, sku, qty)}
                                    className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-emerald-400 hover:text-emerald-300 text-sm"
                                  >
                                    Edit
                                  </button>
                                </div>
                                {expandedBatchKey === `${sku}|${selectedWarehouse}` && (
                                  <div className="overflow-x-auto">
                                    <table className="w-full">
                                      <tbody>{renderBatchDetailRow(sku, selectedWarehouse, 1)}</tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </React.Fragment>
                      ))}
                      {hiddenCount > 0 && (
                        <p className="px-4 py-2 text-center text-zinc-600 text-xs">
                          {hiddenCount} out-of-stock item{hiddenCount === 1 ? '' : 's'} hidden
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
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
                  {(() => {
                    const whRows = Object.entries(getStockForWarehouse(selectedWarehouse)).map(([sku, qty]) => ({
                      sku,
                      total: qty,
                    }));
                    if (whRows.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                            No stock in this warehouse. Use "Add Stock" or "Upload CSV" to add inventory.
                          </td>
                        </tr>
                      );
                    }
                    const { groups, hiddenCount } = groupStockRows(whRows);
                    if (groups.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                            {isStockSearching ? 'No stock items match your search.' : `All ${hiddenCount} item(s) are out of stock in this warehouse.`}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <>
                        {groups.map(group => (
                          <React.Fragment key={group.category}>
                            <tr className="bg-zinc-800/60">
                              <td colSpan={6} className="px-4 py-2">
                                <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                                <span className="text-zinc-500 text-xs ml-3">
                                  {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, r) => acc + r.total, 0)} units
                                </span>
                              </td>
                            </tr>
                            {group.items.map(({ sku, total: qty, product }) => {
                              const value = (product?.unitCost || 0) * qty;
                              return (
                                <React.Fragment key={sku}>
                                  <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                    <td className="px-4 py-3 text-zinc-200">{product?.name || '-'}</td>
                                    <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                                    <td className="text-right px-4 py-3 text-emerald-400 font-medium">{qty}</td>
                                    <td className="text-center px-4 py-3">{renderBatchSummaryCell(sku, selectedWarehouse)}</td>
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
                                  {expandedBatchKey === `${sku}|${selectedWarehouse}` && renderBatchDetailRow(sku, selectedWarehouse, 6)}
                                </React.Fragment>
                              );
                            })}
                          </React.Fragment>
                        ))}
                        {hiddenCount > 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-2 text-center text-zinc-600 text-xs">
                              {hiddenCount} out-of-stock item{hiddenCount === 1 ? '' : 's'} hidden
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })()}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Recent warehouse-to-warehouse transfers */}
          <div className="pt-2">
            <button
              onClick={toggleTransfers}
              className="text-sm text-zinc-400 hover:text-zinc-200"
            >
              {showTransfers ? '▾' : '▸'} Recent transfers
            </button>
            {showTransfers && (
              <div className="mt-3 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
                {!transfersLoaded ? (
                  <p className="px-4 py-3 text-sm text-zinc-500">Loading…</p>
                ) : transfers.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-zinc-500">No transfers recorded yet.</p>
                ) : (
                  transfers.map(t => {
                    const itemCount = Array.isArray(t.items) ? t.items.reduce((s, i) => s + (i.quantity || 0), 0) : 0;
                    const skuCount = Array.isArray(t.items) ? t.items.length : 0;
                    return (
                      <div key={t.id} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <div className="text-sm text-zinc-200">
                          <span className="text-zinc-400">{t.fromWarehouse?.name || t.fromWarehouseId}</span>
                          <span className="text-zinc-600 mx-2">→</span>
                          <span className="text-zinc-400">{t.toWarehouse?.name || t.toWarehouseId}</span>
                          <span className="text-zinc-500 ml-3">{itemCount} unit{itemCount === 1 ? '' : 's'} · {skuCount} SKU{skuCount === 1 ? '' : 's'}</span>
                          {t.notes && <span className="text-zinc-600 ml-3 italic">{t.notes}</span>}
                        </div>
                        <div className="text-xs text-zinc-500">{new Date(t.createdAt).toLocaleString()}</div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}

      {activeSubTab === 'expiry' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-amber-400">{missingExpiryBatches.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Missing Expiry</div>
              <div className="text-xs text-amber-400 mt-1">
                {missingExpiryBatches.reduce((acc, b) => acc + b.remainingQty, 0)} units untracked
              </div>
            </div>
          </div>

          {/* Search — narrows the Missing Expiry and Requiring Attention lists */}
          {batchSearchBox}

          {/* Batches signed in without an expiry date — correct them inline */}
          {missingExpiryBatches.length > 0 && (
            <div className="bg-zinc-900/50 border border-amber-700/50 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
                <h3 className="text-sm font-medium text-amber-400">Missing Expiry Date</h3>
                <span className="text-xs text-zinc-500">— signed in without an expiry; set one below</span>
              </div>
              {/* Mobile cards */}
              <div className="md:hidden">
                {searchedMissingExpiry.length === 0 && (
                  <p className="px-4 py-6 text-center text-zinc-600 text-sm">No dateless batches match the search</p>
                )}
                {[...searchedMissingExpiry]
                  .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
                  .map(batch => {
                    const product = data.products.find(p => p.sku === batch.sku);
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    return (
                      <div key={batch.id} className="border-b border-zinc-800/50 px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-zinc-200 text-sm flex items-center gap-2 flex-wrap">
                              {product?.name || batch.sku}
                              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">No expiry</span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-zinc-300 font-bold text-lg leading-tight">{batch.remainingQty}</p>
                            <p className="text-zinc-500 text-xs">units</p>
                          </div>
                        </div>
                        <div className="text-xs text-zinc-500">
                          {multiWarehouse && `${warehouse?.name || batch.warehouseId} · `}Received {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            value={expiryEdits[batch.id] || ''}
                            onChange={e => setExpiryEdits(prev => ({ ...prev, [batch.id]: e.target.value }))}
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => saveBatchExpiry(batch.id)}
                            disabled={!expiryEdits[batch.id] || savingExpiryId === batch.id}
                            className="px-3 py-2 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {savingExpiryId === batch.id ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                    {multiWarehouse && <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>}
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Received</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Set Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {[...searchedMissingExpiry]
                    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
                    .map(batch => {
                      const product = data.products.find(p => p.sku === batch.sku);
                      const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                      return (
                        <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-3">
                            <div className="text-zinc-200 flex items-center gap-2">
                              {product?.name || batch.sku}
                              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">No expiry</span>
                            </div>
                            <div className="text-zinc-600 text-xs">{batch.sku}</div>
                          </td>
                          {multiWarehouse && <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>}
                          <td className="text-right px-4 py-3 text-zinc-300">{batch.remainingQty}</td>
                          <td className="text-center px-4 py-3 text-zinc-500 text-xs">
                            {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                          </td>
                          <td className="text-center px-4 py-3">
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="date"
                                value={expiryEdits[batch.id] || ''}
                                onChange={e => setExpiryEdits(prev => ({ ...prev, [batch.id]: e.target.value }))}
                                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-amber-500"
                              />
                              <button
                                onClick={() => saveBatchExpiry(batch.id)}
                                disabled={!expiryEdits[batch.id] || savingExpiryId === batch.id}
                                className="px-3 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {savingExpiryId === batch.id ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Expiring/Expired items list */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400">Items Requiring Attention</h3>
            </div>
            {/* Mobile cards */}
            <div className="md:hidden">
              {(() => {
                const attention = searchedBatches()
                  .filter(b => {
                    const status = getExpiryStatus(b.expiryDate);
                    return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                  })
                  .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
                if (attention.length === 0) {
                  return <p className="px-4 py-8 text-center text-zinc-600 text-sm">No items expiring soon</p>;
                }
                return attention.map(batch => {
                  const product = data.products.find(p => p.sku === batch.sku);
                  const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                  const expiryStatus = getExpiryStatus(batch.expiryDate);
                  return (
                    <div key={batch.id} className="border-b border-zinc-800/50 px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 text-zinc-200 text-sm">{product?.name || batch.sku}</div>
                        <div className="text-right shrink-0">
                          <p className="text-zinc-300 font-bold text-lg leading-tight">{batch.remainingQty}</p>
                          <p className="text-zinc-500 text-xs">units</p>
                        </div>
                      </div>
                      {multiWarehouse && <div className="text-xs text-zinc-500">{warehouse?.name || batch.warehouseId}</div>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                          {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                          {expiryStatus?.status === 'expired' ? 'EXPIRED' : expiryStatus?.label}
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  {multiWarehouse && <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>}
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry Date</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {searchedBatches()
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
                        {multiWarehouse && <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>}
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
                {searchedBatches().filter(b => {
                  const status = getExpiryStatus(b.expiryDate);
                  return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                }).length === 0 && (
                  <tr>
                    <td colSpan={multiWarehouse ? 5 : 4} className="px-4 py-8 text-center text-zinc-600">
                      No items expiring soon
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'batches' && (
        <div className="space-y-4">
        {batchSearchBox}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
            <h3 className="text-sm font-medium text-zinc-400">All Batches</h3>
            <span className="text-xs text-zinc-500">— grouped by product, earliest expiry first. Edit volume / expiry or delete a mistaken batch.</span>
          </div>
          {/* Mobile cards */}
          <div className="md:hidden">
            {(() => {
              const batches = searchedBatches();
              if (batches.length === 0) {
                return <p className="px-4 py-8 text-center text-zinc-600 text-sm">No batch records</p>;
              }
              // Group by SKU, products alphabetical, batches earliest-expiry first
              const bySku = {};
              batches.forEach(b => { (bySku[b.sku] ||= []).push(b); });
              const groups = Object.keys(bySku)
                .map(sku => ({
                  sku,
                  name: data.products.find(p => p.sku === sku)?.name || sku,
                  batches: bySku[sku].sort((a, b) => {
                    if (!a.expiryDate && !b.expiryDate) return new Date(a.receivedAt) - new Date(b.receivedAt);
                    if (!a.expiryDate) return 1;
                    if (!b.expiryDate) return -1;
                    return new Date(a.expiryDate) - new Date(b.expiryDate);
                  }),
                }))
                .sort((a, b) => a.name.localeCompare(b.name));

              return groups.map(group => (
                <React.Fragment key={group.sku}>
                  <div className="bg-zinc-800/60 px-4 py-2">
                    <span className="text-emerald-400 font-medium text-xs">{group.name}</span>
                    <span className="text-zinc-500 text-xs ml-3">
                      {group.batches.length} batch{group.batches.length === 1 ? '' : 'es'} · {group.batches.reduce((acc, b) => acc + b.remainingQty, 0)} units
                    </span>
                  </div>
                  {group.batches.map(batch => {
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    const editing = batchEdits[batch.id];
                    return (
                      <div key={batch.id} className="border-b border-zinc-800/50 px-4 py-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {multiWarehouse && <p className="text-zinc-400 text-xs">{warehouse?.name || batch.warehouseId}</p>}
                            <p className="text-zinc-500 text-xs">Received {new Date(batch.receivedAt).toLocaleDateString('en-GB')}</p>
                          </div>
                          <div className="text-right shrink-0">
                            {editing ? (
                              <input
                                type="number" min="0" value={editing.remainingQty}
                                onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], remainingQty: e.target.value } }))}
                                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-right"
                              />
                            ) : (
                              <p className="text-zinc-200 font-bold text-lg leading-tight">{batch.remainingQty}</p>
                            )}
                            <p className="text-zinc-500 text-xs">units</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {editing ? (
                            <input
                              type="date" value={editing.expiryDate}
                              onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], expiryDate: e.target.value } }))}
                              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"
                            />
                          ) : batch.expiryDate ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                              {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                            </span>
                          ) : (
                            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded" title="No expiry recorded">
                              No expiry
                            </span>
                          )}
                          {editing ? (
                            <label className="flex items-center gap-1 text-zinc-400 text-xs">
                              <input
                                type="checkbox" checked={editing.hasDamage}
                                onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], hasDamage: e.target.checked } }))}
                              />
                              Damaged
                            </label>
                          ) : batch.hasDamage ? (
                            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={batch.damageNotes}>Damaged</span>
                          ) : (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">OK</span>
                          )}
                        </div>
                        <div className="flex gap-2 text-xs">
                          {editing ? (
                            <>
                              <button
                                onClick={() => saveBatchEditRow(batch.id)} disabled={savingBatchId === batch.id}
                                className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50"
                              >
                                {savingBatchId === batch.id ? '...' : 'Save'}
                              </button>
                              <button onClick={() => cancelBatchEdit(batch.id)} className="px-3 py-2 bg-zinc-700 text-zinc-300 rounded">Cancel</button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startBatchEdit(batch)}
                                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-emerald-400 hover:text-emerald-300"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteBatchRow(batch.id)} disabled={deletingBatchId === batch.id}
                                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-red-400 hover:text-red-300 disabled:opacity-50"
                              >
                                {deletingBatchId === batch.id ? '...' : 'Delete'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ));
            })()}
          </div>
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                {multiWarehouse && <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>}
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Received</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Condition</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const batches = searchedBatches();
                if (batches.length === 0) {
                  return (
                    <tr>
                      <td colSpan={multiWarehouse ? 7 : 6} className="px-4 py-8 text-center text-zinc-600">No batch records</td>
                    </tr>
                  );
                }
                // Group by SKU, products alphabetical, batches earliest-expiry first
                const bySku = {};
                batches.forEach(b => { (bySku[b.sku] ||= []).push(b); });
                const groups = Object.keys(bySku)
                  .map(sku => ({
                    sku,
                    name: data.products.find(p => p.sku === sku)?.name || sku,
                    batches: bySku[sku].sort((a, b) => {
                      if (!a.expiryDate && !b.expiryDate) return new Date(a.receivedAt) - new Date(b.receivedAt);
                      if (!a.expiryDate) return 1;
                      if (!b.expiryDate) return -1;
                      return new Date(a.expiryDate) - new Date(b.expiryDate);
                    }),
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name));

                return groups.map(group => (
                  <React.Fragment key={group.sku}>
                    <tr className="bg-zinc-800/60">
                      <td colSpan={multiWarehouse ? 7 : 6} className="px-4 py-2">
                        <span className="text-emerald-400 font-medium text-xs">{group.name}</span>
                        <span className="text-zinc-500 text-xs ml-3">
                          {group.sku} · {group.batches.length} batch{group.batches.length === 1 ? '' : 'es'} · {group.batches.reduce((acc, b) => acc + b.remainingQty, 0)} units
                        </span>
                      </td>
                    </tr>
                    {group.batches.map(batch => {
                      const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                      const expiryStatus = getExpiryStatus(batch.expiryDate);
                      const editing = batchEdits[batch.id];
                      return (
                        <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-3 text-zinc-600 text-xs">{batch.sku}</td>
                          {multiWarehouse && <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>}
                          <td className="text-right px-4 py-3 text-zinc-300">
                            {editing ? (
                              <input
                                type="number" min="0" value={editing.remainingQty}
                                onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], remainingQty: e.target.value } }))}
                                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-right"
                              />
                            ) : batch.remainingQty}
                          </td>
                          <td className="text-center px-4 py-3">
                            {editing ? (
                              <input
                                type="date" value={editing.expiryDate}
                                onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], expiryDate: e.target.value } }))}
                                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs"
                              />
                            ) : batch.expiryDate ? (
                              <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                              </span>
                            ) : (
                              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded" title="No expiry recorded">
                                No expiry
                              </span>
                            )}
                          </td>
                          <td className="text-center px-4 py-3 text-zinc-500 text-xs">
                            {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                          </td>
                          <td className="text-center px-4 py-3">
                            {editing ? (
                              <label className="flex items-center justify-center gap-1 text-zinc-400 text-xs">
                                <input
                                  type="checkbox" checked={editing.hasDamage}
                                  onChange={e => setBatchEdits(p => ({ ...p, [batch.id]: { ...p[batch.id], hasDamage: e.target.checked } }))}
                                />
                                Damaged
                              </label>
                            ) : batch.hasDamage ? (
                              <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={batch.damageNotes}>Damaged</span>
                            ) : (
                              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">OK</span>
                            )}
                          </td>
                          <td className="text-right px-4 py-3 whitespace-nowrap text-xs">
                            {editing ? (
                              <>
                                <button
                                  onClick={() => saveBatchEditRow(batch.id)} disabled={savingBatchId === batch.id}
                                  className="px-2 py-1 bg-emerald-600 text-white rounded mr-1 disabled:opacity-50"
                                >
                                  {savingBatchId === batch.id ? '...' : 'Save'}
                                </button>
                                <button onClick={() => cancelBatchEdit(batch.id)} className="px-2 py-1 bg-zinc-700 text-zinc-300 rounded">Cancel</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => startBatchEdit(batch)} className="text-emerald-400 hover:text-emerald-300 mr-3">Edit</button>
                                <button
                                  onClick={() => deleteBatchRow(batch.id)} disabled={deletingBatchId === batch.id}
                                  className="text-red-400 hover:text-red-300 disabled:opacity-50"
                                >
                                  {deletingBatchId === batch.id ? '...' : 'Delete'}
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ));
              })()}
            </tbody>
          </table>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}
