import React, { useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';
import { vendliveService } from '../../services/vendlive.service';
import { salesService } from '../../services/sales.service';

export default function SalesOverview() {
  const { data, importSales, bulkImportProducts, updateLocationStock } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [locationFilter, setLocationFilter] = useState('all');

  // Server-side aggregates: computed over the WHOLE sales table in SQL with
  // refunds excluded and quantities summed. The client-side fallback below
  // only sees the most recent rows the API returns (capped at 1000), which
  // is what previously pinned "Units Sold" at 1000 and skewed revenue.
  const [serverStats, setServerStats] = useState(null);
  useEffect(() => {
    const params = {};
    if (dateFilter.start) params.startDate = dateFilter.start;
    if (dateFilter.end) params.endDate = `${dateFilter.end}T23:59:59.999`;
    if (locationFilter !== 'all') params.locationName = locationFilter;
    Promise.all([
      salesService.getAnalytics(params),
      // /daily defaults to the last 30 days when no start date — ask for
      // effectively-all history to match the unfiltered view
      salesService.getDailySales(dateFilter.start ? params : { ...params, days: 3650 }),
      salesService.getByProduct({ ...params, limit: 500 }),
    ])
      .then(([analytics, daily, byProduct]) => setServerStats({ analytics, daily, byProduct }))
      .catch(() => setServerStats(null)); // offline mode → client-side fallback
  }, [dateFilter.start, dateFilter.end, locationFilter]);

  // VendLive sync status
  const [syncStatus, setSyncStatus] = useState(null);
  useEffect(() => {
    vendliveService.getSyncStatus().then(setSyncStatus).catch(() => {});
  }, []);

  // Stock sync state
  const [showStockSync, setShowStockSync] = useState(false);
  const [stockDeductions, setStockDeductions] = useState([]);
  const [locationMappings, setLocationMappings] = useState({});
  const [syncingStock, setSyncingStock] = useState(false);

  // Parse Vendlive CSV format
  const parseVendliveCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return { sales: [], products: [] };

    // Find header line (skip empty first line if present)
    let headerIndex = 0;
    if (lines[0].startsWith(',')) headerIndex = 1;

    const headers = lines[headerIndex].split(',').map(h => h.trim());

    // Find column indices
    const cols = {
      transactionId: headers.indexOf('transaction_id'),
      timestamp: headers.indexOf('timestamp'),
      productId: headers.indexOf('product__id'),
      productName: headers.indexOf('name'),
      category: headers.indexOf('product__category__name'),
      vendStatus: headers.indexOf('vend_status'),
      charged: headers.indexOf('order_sale__charged'),
      price: headers.indexOf('price'),
      costPrice: headers.indexOf('cost_price'),
      defaultPrice: headers.indexOf('product_price_default'),
      barcode: headers.indexOf('product_universal_product_codes'),
      venueName: headers.indexOf('location__venue__name'),
      machineName: headers.indexOf('machine__friendly_name')
    };

    const sales = [];
    const productsMap = new Map();
    const seenTransactions = new Set();

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 10) continue;

      const transactionId = values[cols.transactionId];
      const productId = values[cols.productId];
      const vendStatus = values[cols.vendStatus];
      const charged = values[cols.charged];

      // Only process successful sales
      if (vendStatus !== 'Success') continue;
      if (charged === 'Payment Declined') continue;

      // Parse timestamp (DD/MM/YYYY HH:MM format)
      const timestamp = parseVendliveDate(values[cols.timestamp]);
      if (!timestamp) continue;

      const productName = values[cols.productName]?.trim();
      const category = values[cols.category]?.trim();
      const price = parseFloat(values[cols.price]) || 0;
      const costPrice = parseFloat(values[cols.costPrice]) || 0;
      const defaultPrice = parseFloat(values[cols.defaultPrice]) || 0;
      const barcode = values[cols.barcode]?.trim();

      // Create unique key for deduplication
      const saleKey = `${transactionId}-${productId}-${timestamp.getTime()}`;
      if (seenTransactions.has(saleKey)) continue;
      seenTransactions.add(saleKey);

      // Get location info
      const venueName = values[cols.venueName]?.trim() || '';
      const machineName = values[cols.machineName]?.trim() || '';
      const locationKey = machineName || venueName || 'Unknown';

      // Add to sales
      sales.push({
        id: saleKey,
        transactionId,
        timestamp: timestamp.toISOString(),
        sku: productId,
        productId,
        productName,
        category,
        price,
        costPrice,
        charged: charged === 'Free Vend' ? 0 : price,
        isFreeVend: charged === 'Free Vend',
        quantity: 1,
        locationName: locationKey,
        venueName,
        machineName
      });

      // Track products
      if (productId && productName && !productsMap.has(productId)) {
        productsMap.set(productId, {
          sku: productId,
          name: productName,
          category: category || '',
          unitCost: costPrice,
          salePrice: defaultPrice || price,
          barcode: barcode || '',
          unitsPerBox: 1
        });
      }
    }

    return { sales, products: Array.from(productsMap.values()) };
  };

  const parseCSVLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const parseVendliveDate = (dateStr) => {
    if (!dateStr) return null;
    // Format: DD/MM/YYYY HH:MM or DD/MM/YYYY H:MM
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const [, day, month, year, hour, minute] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const { sales, products } = parseVendliveCSV(text);

      // Merge products - update existing or add new
      const existingProducts = [...data.products];
      let newProductCount = 0;
      let updatedProductCount = 0;

      products.forEach(newProduct => {
        const existingIdx = existingProducts.findIndex(p => p.sku === newProduct.sku);
        if (existingIdx >= 0) {
          // Update existing product with new data
          existingProducts[existingIdx] = {
            ...existingProducts[existingIdx],
            name: newProduct.name,
            category: newProduct.category || existingProducts[existingIdx].category,
            unitCost: newProduct.unitCost || existingProducts[existingIdx].unitCost,
            salePrice: newProduct.salePrice || existingProducts[existingIdx].salePrice,
            barcode: newProduct.barcode || existingProducts[existingIdx].barcode
          };
          updatedProductCount++;
        } else {
          existingProducts.push(newProduct);
          newProductCount++;
        }
      });

      // Merge sales - avoid duplicates
      const existingSales = data.salesData || [];
      const existingIds = new Set(existingSales.map(s => s.id));
      const newSales = sales.filter(s => !existingIds.has(s.id));

      // Use context methods to save data
      if (products.length > 0) {
        await bulkImportProducts(existingProducts);
      }

      if (newSales.length > 0) {
        await importSales(newSales, file.name);
      }

      setImportResult({
        success: true,
        salesImported: newSales.length,
        salesSkipped: sales.length - newSales.length,
        productsAdded: newProductCount,
        productsUpdated: updatedProductCount
      });

      // Calculate stock deductions from new sales
      if (newSales.length > 0) {
        calculateStockDeductions(newSales);
      }
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({ success: false, error: error.message });
    }

    setImporting(false);
    e.target.value = '';
  };

  // Calculate stock deductions from sales data
  const calculateStockDeductions = (sales) => {
    // Group sales by location and product
    const deductionMap = new Map();
    const uniqueLocations = new Set();

    sales.forEach(sale => {
      const locKey = sale.locationName || 'Unknown';
      uniqueLocations.add(locKey);

      const key = `${locKey}|${sale.sku}`;
      if (deductionMap.has(key)) {
        deductionMap.get(key).quantity += sale.quantity || 1;
      } else {
        deductionMap.set(key, {
          locationName: locKey,
          sku: sale.sku,
          productName: sale.productName,
          quantity: sale.quantity || 1
        });
      }
    });

    // Auto-match locations by name: exact case-insensitive match first,
    // then a startsWith match only when it's unambiguous (exactly one
    // candidate). Otherwise leave unmapped for the user to map manually.
    const mappings = {};
    uniqueLocations.forEach(locName => {
      const target = locName.toLowerCase();

      const exactMatch = data.locations.find(l => l.name.toLowerCase() === target);
      if (exactMatch) {
        mappings[locName] = exactMatch.id;
        return;
      }

      const candidates = data.locations.filter(l => {
        const name = l.name.toLowerCase();
        return name.startsWith(target) || target.startsWith(name);
      });
      if (candidates.length === 1) {
        mappings[locName] = candidates[0].id;
      }
    });

    setLocationMappings(mappings);
    setStockDeductions(Array.from(deductionMap.values()));

    // Show sync modal if there are deductions
    if (deductionMap.size > 0) {
      setShowStockSync(true);
    }
  };

  // Apply stock deductions to location stock
  const applyStockDeductions = async () => {
    setSyncingStock(true);

    try {
      // Group deductions by mapped location
      const updatesByLocation = new Map();

      stockDeductions.forEach(deduction => {
        const mappedLocationId = locationMappings[deduction.locationName];
        if (!mappedLocationId) return; // Skip unmapped locations

        if (!updatesByLocation.has(mappedLocationId)) {
          updatesByLocation.set(mappedLocationId, []);
        }
        updatesByLocation.get(mappedLocationId).push(deduction);
      });

      // Apply updates
      for (const [locationId, deductions] of updatesByLocation) {
        const currentStock = data.locationStock[locationId] || {};

        for (const deduction of deductions) {
          const currentQty = currentStock[deduction.sku] || 0;
          const newQty = Math.max(0, currentQty - deduction.quantity);
          await updateLocationStock(locationId, deduction.sku, newQty);
        }
      }

      setShowStockSync(false);
      setStockDeductions([]);
      setImportResult(prev => ({
        ...prev,
        stockSynced: true,
        locationsUpdated: updatesByLocation.size
      }));
    } catch (error) {
      console.error('Stock sync error:', error);
    }

    setSyncingStock(false);
  };

  const updateLocationMapping = (locationName, locationId) => {
    setLocationMappings(prev => ({
      ...prev,
      [locationName]: locationId
    }));
  };

  // Normalize sales data - handle both CSV import format and database format
  const normalizeSale = (sale) => ({
    ...sale,
    productId: sale.productId || sale.sku,
    productName: sale.productName || sale.product_name || 'Unknown',
    category: sale.category || sale.product?.category || '',
    price: sale.price ?? sale.charged ?? 0,
    charged: sale.charged ?? sale.price ?? 0,
    costPrice: sale.costPrice ?? sale.cost_price ?? 0,
    isFreeVend: sale.isFreeVend ?? (sale.charged === 0),
    isRefunded: sale.isRefunded ?? sale.is_refunded ?? false,
    quantity: sale.quantity || 1,
  });

  // Distinct location names present in the sales data, for the filter dropdown
  const salesLocations = [...new Set(
    (data.salesData || []).map(s => s.locationName || 'Unknown')
  )].sort((a, b) => a.localeCompare(b));

  // Filter sales by location and date
  const getFilteredSales = () => {
    let sales = (data.salesData || []).map(normalizeSale);
    if (locationFilter !== 'all') {
      sales = sales.filter(s => (s.locationName || 'Unknown') === locationFilter);
    }
    if (dateFilter.start) {
      const start = new Date(dateFilter.start);
      sales = sales.filter(s => new Date(s.timestamp) >= start);
    }
    if (dateFilter.end) {
      const end = new Date(dateFilter.end);
      end.setHours(23, 59, 59);
      sales = sales.filter(s => new Date(s.timestamp) <= end);
    }
    return sales;
  };

  const filteredSales = getFilteredSales();

  // Client-side fallback metrics (offline mode only): refunds excluded and
  // quantities summed, mirroring the server analytics. Note this only covers
  // the rows the API returned — the server figures are authoritative.
  const settledSales = filteredSales.filter(s => !s.isRefunded);

  const clientByProduct = settledSales.reduce((acc, s) => {
    if (!acc[s.productId]) {
      acc[s.productId] = { sku: s.productId, name: s.productName, category: s.category || 'Other', units: 0, revenue: 0, cost: 0 };
    }
    acc[s.productId].units += s.quantity;
    acc[s.productId].revenue += s.charged;
    acc[s.productId].cost += s.costPrice * s.quantity;
    return acc;
  }, {});

  const clientByDay = settledSales.reduce((acc, s) => {
    const day = new Date(s.timestamp).toISOString().split('T')[0];
    if (!acc[day]) acc[day] = { date: day, units: 0, revenue: 0, transactions: 0 };
    acc[day].units += s.quantity;
    acc[day].revenue += s.charged;
    acc[day].transactions++;
    return acc;
  }, {});

  const clientByCategory = settledSales.reduce((acc, s) => {
    const cat = s.category || 'Other';
    if (!acc[cat]) acc[cat] = { units: 0, revenue: 0 };
    acc[cat].units += s.quantity;
    acc[cat].revenue += s.charged;
    return acc;
  }, {});

  // View model: server aggregates when available, client fallback otherwise
  const overview = serverStats ? {
    revenue: serverStats.analytics.totalRevenue,
    cost: serverStats.analytics.totalCost,
    profit: serverStats.analytics.totalProfit,
    units: serverStats.analytics.totalUnits,
    freeVends: serverStats.analytics.freeVends,
    refundedCount: serverStats.analytics.refundedCount,
    refundedValue: serverStats.analytics.refundedValue,
    byCategory: serverStats.analytics.byCategory,
  } : {
    revenue: settledSales.reduce((acc, s) => acc + s.charged, 0),
    cost: settledSales.reduce((acc, s) => acc + s.costPrice * s.quantity, 0),
    profit: settledSales.reduce((acc, s) => acc + s.charged - s.costPrice * s.quantity, 0),
    units: settledSales.reduce((acc, s) => acc + s.quantity, 0),
    freeVends: settledSales.filter(s => s.isFreeVend).length,
    refundedCount: filteredSales.length - settledSales.length,
    refundedValue: filteredSales.filter(s => s.isRefunded).reduce((acc, s) => acc + s.charged, 0),
    byCategory: clientByCategory,
  };

  const productRows = serverStats
    ? serverStats.byProduct
    : Object.values(clientByProduct);

  const dailyRows = serverStats
    ? serverStats.daily
    : Object.values(clientByDay);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold">Sales Overview</h2>
          <p className="text-zinc-500 text-sm mt-1">Track vending machine sales</p>
        </div>
      </div>

      {/* VendLive Sync Status Bar */}
      {syncStatus && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-4 py-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-2 h-2 rounded-full ${syncStatus.active ? 'bg-emerald-400 animate-pulse' : syncStatus.connected ? 'bg-zinc-500' : 'bg-zinc-700'}`} />
            <span className="text-sm text-zinc-300">
              {syncStatus.active ? 'VendLive Sync Active' : syncStatus.connected ? 'VendLive Sync Inactive' : 'VendLive Not Configured'}
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm">
            {syncStatus.lastSaleAt && (
              <span className="text-zinc-500">Last sale: {new Date(syncStatus.lastSaleAt).toLocaleString('en-GB')}</span>
            )}
            {syncStatus.active && (
              <span className="text-emerald-400">
                Today: {syncStatus.todaySalesCount} sales / £{(syncStatus.todaySalesRevenue || 0).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Manual CSV Import (Legacy) */}
      <details className="bg-zinc-900/50 border border-zinc-800 rounded-lg">
        <summary className="px-4 py-3 text-sm text-zinc-400 cursor-pointer hover:text-zinc-200">
          Manual CSV Import (Legacy)
        </summary>
        <div className="px-4 pb-4 pt-1 flex items-center gap-3">
          <label className={`px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors ${
            importing ? 'bg-zinc-700 text-zinc-400' : 'bg-emerald-600 text-white hover:bg-emerald-500'
          }`}>
            {importing ? 'Importing...' : 'Import CSV'}
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={importing}
              className="hidden"
            />
          </label>
        </div>
      </details>

      {importResult && (
        <div className={`p-4 rounded-lg ${importResult.success ? 'bg-emerald-900/20 border border-emerald-900/50' : 'bg-red-900/20 border border-red-900/50'}`}>
          {importResult.success ? (
            <div className="text-emerald-300 text-sm">
              <strong>Import successful!</strong> {importResult.salesImported} sales imported, {importResult.salesSkipped} duplicates skipped.
              {importResult.productsAdded > 0 && ` ${importResult.productsAdded} new products added.`}
              {importResult.productsUpdated > 0 && ` ${importResult.productsUpdated} products updated.`}
              {importResult.stockSynced && ` Stock updated for ${importResult.locationsUpdated} location(s).`}
            </div>
          ) : (
            <div className="text-red-300 text-sm">Import failed: {importResult.error}</div>
          )}
        </div>
      )}

      {/* Stock Sync Modal */}
      {showStockSync && (
        <div className="bg-zinc-900/50 border border-teal-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">Sync Location Stock</h3>
              <p className="text-zinc-500 text-sm mt-1">Deduct sold items from location stock</p>
            </div>
            <button onClick={() => setShowStockSync(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {/* Location Mapping */}
          <div className="bg-zinc-800/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-zinc-300 mb-3">Match Sales Locations to Your Locations</h4>
            <div className="space-y-2">
              {[...new Set(stockDeductions.map(d => d.locationName))].map(locName => (
                <div key={locName} className="flex items-center gap-3">
                  <span className="text-sm text-zinc-400 w-48 truncate">{locName}</span>
                  <span className="text-zinc-600">→</span>
                  <select
                    value={locationMappings[locName] || ''}
                    onChange={(e) => updateLocationMapping(locName, e.target.value)}
                    className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm"
                  >
                    <option value="">-- Skip (don't deduct) --</option>
                    {data.locations.map(loc => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                  {locationMappings[locName] && (
                    <span className="text-emerald-400 text-xs">✓ Mapped</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Deductions Preview */}
          <div className="bg-zinc-800/30 rounded-lg p-4">
            <h4 className="text-sm font-medium text-zinc-300 mb-3">
              Stock Deductions Preview ({stockDeductions.filter(d => locationMappings[d.locationName]).length} items will be deducted)
            </h4>
            <div className="max-h-60 overflow-y-auto space-y-1">
              {stockDeductions.map((deduction, idx) => {
                const isMapped = !!locationMappings[deduction.locationName];
                const mappedLocation = data.locations.find(l => l.id === locationMappings[deduction.locationName]);
                const currentStock = data.locationStock[locationMappings[deduction.locationName]]?.[deduction.sku] || 0;

                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between p-2 rounded text-sm ${
                      isMapped ? 'bg-teal-500/10 border border-teal-500/30' : 'bg-zinc-800/50 opacity-50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-zinc-200">{deduction.productName}</span>
                      <span className="text-zinc-500 ml-2 text-xs">({deduction.sku})</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-zinc-500 text-xs">{deduction.locationName}</span>
                      {isMapped ? (
                        <>
                          <span className="text-zinc-400">{currentStock}</span>
                          <span className="text-red-400">-{deduction.quantity}</span>
                          <span className="text-emerald-400">= {Math.max(0, currentStock - deduction.quantity)}</span>
                        </>
                      ) : (
                        <span className="text-zinc-600 text-xs">Skipped</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-zinc-300">{stockDeductions.length}</div>
              <div className="text-xs text-zinc-500">Total Deductions</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">
                {stockDeductions.filter(d => locationMappings[d.locationName]).length}
              </div>
              <div className="text-xs text-zinc-500">Will Apply</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">
                {stockDeductions.filter(d => locationMappings[d.locationName]).reduce((a, d) => a + d.quantity, 0)}
              </div>
              <div className="text-xs text-zinc-500">Units to Deduct</div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={applyStockDeductions}
              disabled={syncingStock || stockDeductions.filter(d => locationMappings[d.locationName]).length === 0}
              className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncingStock ? 'Syncing...' : 'Apply Stock Deductions'}
            </button>
            <button
              onClick={() => setShowStockSync(false)}
              className="px-4 py-3 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'products', label: 'By Product' },
          { id: 'daily', label: 'Daily Sales' },
          { id: 'transactions', label: 'Transactions' },
          { id: 'imports', label: 'Import History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Location + Date Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">Location:</span>
          <select
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="all">All locations</option>
            {salesLocations.map(loc => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">From:</span>
          <input
            type="date"
            value={dateFilter.start}
            onChange={e => setDateFilter({ ...dateFilter, start: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">To:</span>
          <input
            type="date"
            value={dateFilter.end}
            onChange={e => setDateFilter({ ...dateFilter, end: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        {(dateFilter.start || dateFilter.end || locationFilter !== 'all') && (
          <button
            onClick={() => { setDateFilter({ start: '', end: '' }); setLocationFilter('all'); }}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Clear filters
          </button>
        )}
        {locationFilter !== 'all' && (
          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
            Showing: {locationFilter}
          </span>
        )}
      </div>

      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{overview.revenue.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Revenue</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">£{overview.cost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Cost</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{overview.profit.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Gross Profit</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{overview.units.toLocaleString('en-GB')}</div>
              <div className="text-xs text-zinc-500 mt-1">Units Sold</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">{overview.freeVends}</div>
              <div className="text-xs text-zinc-500 mt-1">Free Vends</div>
            </div>
          </div>

          {overview.refundedCount > 0 && (
            <p className="text-xs text-zinc-500">
              {overview.refundedCount} refunded sale{overview.refundedCount === 1 ? '' : 's'} totalling
              £{overview.refundedValue.toFixed(2)} {overview.refundedCount === 1 ? 'is' : 'are'} excluded
              from these figures.
            </p>
          )}

          {/* Category breakdown */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Sales by Category</h3>
            <div className="space-y-3">
              {Object.entries(overview.byCategory)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([category, stats]) => (
                  <div key={category} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{category}</span>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-500">{stats.units} units</span>
                      <span className="text-emerald-400 font-medium">£{stats.revenue.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Top products */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Top Selling Products</h3>
            <div className="space-y-3">
              {productRows.slice()
                .sort((a, b) => b.units - a.units)
                .slice(0, 10)
                .map(stats => (
                  <div key={stats.sku} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <div>
                      <span className="text-zinc-300">{stats.name}</span>
                      <span className="text-zinc-600 text-xs ml-2">{stats.category}</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-500">{stats.units} sold</span>
                      <span className="text-emerald-400 font-medium">£{stats.revenue.toFixed(2)}</span>
                      <span className="text-emerald-400">£{(stats.revenue - stats.cost).toFixed(2)} profit</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'products' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Cost</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Profit</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {productRows.slice()
                .sort((a, b) => b.revenue - a.revenue)
                .map(stats => {
                  const profit = stats.revenue - stats.cost;
                  const margin = stats.revenue > 0 ? (profit / stats.revenue * 100) : 0;
                  return (
                    <tr key={stats.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-200">{stats.name}</td>
                      <td className="px-4 py-3 text-zinc-500">{stats.category}</td>
                      <td className="text-right px-4 py-3 text-zinc-300">{stats.units}</td>
                      <td className="text-right px-4 py-3 text-emerald-400">£{stats.revenue.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-red-400">£{stats.cost.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-emerald-400">£{profit.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-zinc-400">{margin.toFixed(1)}%</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'daily' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Sold</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Avg per Sale</th>
              </tr>
            </thead>
            <tbody>
              {dailyRows.slice()
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(stats => (
                  <tr key={stats.date} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-200">{new Date(stats.date).toLocaleDateString('en-GB')}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">{stats.units}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">£{stats.revenue.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">£{stats.units > 0 ? (stats.revenue / stats.units).toFixed(2) : '0.00'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'transactions' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date/Time</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Price</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Charged</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 100)
                .map(sale => (
                  <tr key={sale.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {new Date(sale.timestamp).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{sale.productName}</td>
                    <td className="px-4 py-3 text-zinc-500">{sale.category}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">£{sale.price.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">£{sale.charged.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {sale.isRefunded ? (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Refunded</span>
                      ) : sale.isFreeVend ? (
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Free</span>
                      ) : (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Paid</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {sale.syncSource === 'webhook' || sale.syncSource === 'poll' ? (
                        <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded">VL</span>
                      ) : (
                        <span className="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded">CSV</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {filteredSales.length > 100 && (
            <div className="px-4 py-3 text-center text-zinc-500 text-sm border-t border-zinc-800">
              Showing 100 of {filteredSales.length} transactions
            </div>
          )}
          {(data.salesData || []).length >= 1000 && (
            <div className="px-4 py-2 text-center text-zinc-600 text-xs border-t border-zinc-800">
              This list covers the most recent 1,000 transactions — older sales are still included in the totals and charts above.
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'imports' && (
        <div className="space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Import History</h3>
            {(!data.salesImports || data.salesImports.length === 0) ? (
              <p className="text-zinc-500 text-sm">No imports yet. Upload a Vendlive CSV export to get started.</p>
            ) : (
              <div className="space-y-3">
                {data.salesImports.slice().reverse().map(imp => (
                  <div key={imp.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <div>
                      <span className="text-zinc-300">{imp.filename}</span>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {new Date(imp.importedAt || imp.imported_at).toLocaleString('en-GB')}
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-400">{imp.recordsAdded || imp.records_added || imp.salesCount || 0} sales</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
            <p className="text-blue-300 text-sm">
              <strong>Supported Format:</strong> Vendlive transaction export CSV. The system will automatically extract products (SKU, name, category, cost price, sale price) and sales transactions from successful vends.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
