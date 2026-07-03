import React, { useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';
import { vendliveService } from '../../services/vendlive.service';
import { salesService } from '../../services/sales.service';
import AnalyticsDashboard from './analytics/AnalyticsDashboard';
import ClientReports from './reports/ClientReports';

// Small hoverable (i) marker with an explanatory tooltip
function InfoTip({ text }) {
  return (
    <span className="relative inline-block group align-middle ml-1.5">
      <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-zinc-600 text-zinc-500 text-[9px] leading-none cursor-help select-none group-hover:text-zinc-300 group-hover:border-zinc-400 transition-colors">
        i
      </span>
      <span className="invisible group-hover:visible absolute top-full left-1/2 -translate-x-1/2 mt-2 w-60 bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-300 text-left font-normal normal-case shadow-xl z-20">
        {text}
      </span>
    </span>
  );
}

export default function SalesOverview() {
  const { data } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('analytics');
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  // Multi-select: VendLive can report one physical site under several
  // location names, so users can tick several and combine the feeds.
  // Empty array = all locations.
  const [locationFilter, setLocationFilter] = useState([]);
  const [locPickerOpen, setLocPickerOpen] = useState(false);

  const toggleLocation = (name) => {
    setLocationFilter(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // Server-side aggregates: computed over the WHOLE sales table in SQL with
  // refunds excluded and quantities summed. The client-side fallback below
  // only sees the most recent rows the API returns (capped at 1000), which
  // is what previously pinned "Units Sold" at 1000 and skewed revenue.
  const [serverStats, setServerStats] = useState(null);
  useEffect(() => {
    const params = {};
    if (dateFilter.start) params.startDate = dateFilter.start;
    if (dateFilter.end) params.endDate = `${dateFilter.end}T23:59:59.999`;
    if (locationFilter.length > 0) params.locationName = locationFilter;
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
    if (locationFilter.length > 0) {
      sales = sales.filter(s => locationFilter.includes(s.locationName || 'Unknown'));
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

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'analytics', label: 'Analytics' },
          { id: 'overview', label: 'Overview' },
          { id: 'products', label: 'By Product' },
          { id: 'daily', label: 'Daily Sales' },
          { id: 'transactions', label: 'Transactions' },
          { id: 'reports', label: 'Reports' }
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

      {/* Location + Date Filter — hidden on the Analytics and Reports tabs,
          which own their own filters */}
      {activeSubTab !== 'analytics' && activeSubTab !== 'reports' && (
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 relative">
          <span className="text-zinc-500 text-sm">Locations:</span>
          <button
            onClick={() => setLocPickerOpen(o => !o)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500 hover:border-zinc-500 text-left min-w-[10rem]"
          >
            {locationFilter.length === 0
              ? 'All locations'
              : locationFilter.length === 1
                ? locationFilter[0]
                : `${locationFilter.length} locations combined`}
            <span className="ml-2 text-zinc-500 text-xs">▾</span>
          </button>
          {locPickerOpen && (
            <>
              {/* click-away catcher */}
              <div className="fixed inset-0 z-10" onClick={() => setLocPickerOpen(false)} />
              <div className="absolute top-full left-0 mt-2 z-20 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl p-2 space-y-0.5">
                <button
                  onClick={() => { setLocationFilter([]); setLocPickerOpen(false); }}
                  className={`w-full text-left px-2 py-1.5 rounded text-sm hover:bg-zinc-700 ${locationFilter.length === 0 ? 'text-emerald-400' : 'text-zinc-300'}`}
                >
                  All locations
                </button>
                <div className="border-t border-zinc-700 my-1" />
                {salesLocations.map(loc => (
                  <label key={loc} className="flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-zinc-700 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={locationFilter.includes(loc)}
                      onChange={() => toggleLocation(loc)}
                      className="w-4 h-4 rounded border-zinc-600 accent-emerald-500"
                    />
                    <span className="truncate">{loc}</span>
                  </label>
                ))}
                <div className="border-t border-zinc-700 my-1" />
                <p className="px-2 py-1 text-xs text-zinc-500">
                  Tick several to combine feeds — useful when VendLive reports one site under multiple names.
                </p>
              </div>
            </>
          )}
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
        {(dateFilter.start || dateFilter.end || locationFilter.length > 0) && (
          <button
            onClick={() => { setDateFilter({ start: '', end: '' }); setLocationFilter([]); }}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Clear filters
          </button>
        )}
        {locationFilter.length > 0 && (
          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
            Showing: {locationFilter.join(' + ')}
          </span>
        )}
      </div>
      )}

      {activeSubTab === 'analytics' && (
        <AnalyticsDashboard
          locationOptions={salesLocations}
          routes={data.restockRoutes || []}
        />
      )}

      {activeSubTab === 'reports' && (
        <ClientReports
          locationOptions={salesLocations}
          routes={data.restockRoutes || []}
        />
      )}

      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{overview.revenue.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Total Revenue
                <InfoTip text="What customers actually paid, excluding refunds. Discounted and free vends count at the amount really charged — VendLive's dashboard shows list prices, so its figure can read slightly higher. This is the true takings number." />
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">£{overview.cost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Total Cost
                <InfoTip text="Cost price × units for every non-refunded sale. Products with no cost price recorded contribute £0, so fill missing costs (Stock Levels tab) for an accurate figure." />
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{overview.profit.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Gross Profit
                <InfoTip text="Revenue minus cost of goods sold. Does not include delivery fees, wastage or expired stock write-offs." />
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{overview.units.toLocaleString('en-GB')}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Units Sold
                <InfoTip text="Total units across all non-refunded sales in the selected period — a multi-unit sale counts each unit." />
              </div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">{overview.freeVends}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Free Vends
                <InfoTip text="Vends where nothing was charged — staff codes, vouchers and 100% discounts. Counted in Units Sold but contribute £0 to revenue." />
              </div>
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
          <div className="overflow-x-auto">
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
        </div>
      )}

      {activeSubTab === 'daily' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
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
        </div>
      )}

      {activeSubTab === 'transactions' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          {/* Mobile: stacked transaction cards */}
          <div className="md:hidden divide-y divide-zinc-800/50">
            {filteredSales
              .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
              .slice(0, 100)
              .map(sale => (
                <div key={sale.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-zinc-200 text-sm truncate">{sale.productName}</div>
                      <div className="text-zinc-500 text-xs">{sale.category}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-emerald-400 text-sm">£{sale.charged.toFixed(2)}</div>
                      {sale.charged !== sale.price && (
                        <div className="text-zinc-500 text-xs">Price £{sale.price.toFixed(2)}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-zinc-400 text-xs">{new Date(sale.timestamp).toLocaleString('en-GB')}</span>
                    <span className="flex items-center gap-1.5">
                      {sale.isRefunded ? (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Refunded</span>
                      ) : sale.isFreeVend ? (
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Free</span>
                      ) : (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Paid</span>
                      )}
                      {sale.syncSource === 'webhook' || sale.syncSource === 'poll' ? (
                        <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded">VL</span>
                      ) : (
                        <span className="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded">CSV</span>
                      )}
                    </span>
                  </div>
                </div>
              ))}
          </div>
          {/* Desktop: full table */}
          <div className="hidden md:block overflow-x-auto">
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
          </div>
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

    </div>
  );
}
