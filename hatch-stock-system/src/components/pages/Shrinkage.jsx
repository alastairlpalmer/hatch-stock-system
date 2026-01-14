import React, { useState, useMemo } from 'react';
import { useStock } from '../../context/StockContext';

export default function Shrinkage() {
  const { data } = useStock();
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [locationFilter, setLocationFilter] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('overview');

  const stockChecks = data.stockCheckHistory || [];

  // Filter stock checks by date and location
  const filteredChecks = useMemo(() => {
    let checks = stockChecks;

    if (dateFilter.start) {
      const start = new Date(dateFilter.start);
      checks = checks.filter(sc => new Date(sc.timestamp || sc.createdAt) >= start);
    }
    if (dateFilter.end) {
      const end = new Date(dateFilter.end);
      end.setHours(23, 59, 59);
      checks = checks.filter(sc => new Date(sc.timestamp || sc.createdAt) <= end);
    }
    if (locationFilter) {
      checks = checks.filter(sc => sc.locationId === locationFilter);
    }

    return checks;
  }, [stockChecks, dateFilter, locationFilter]);

  // Calculate shrinkage metrics from stock checks
  const shrinkageData = useMemo(() => {
    const byLocation = {};
    const byProduct = {};
    const byReason = {
      theft: { count: 0, units: 0, cost: 0 },
      swap: { count: 0, units: 0, cost: 0 },
      damaged: { count: 0, units: 0, cost: 0 },
      malfunction: { count: 0, units: 0, cost: 0 },
      unknown: { count: 0, units: 0, cost: 0 },
    };
    let totalShrinkage = 0;
    let totalShrinkageCost = 0;
    let totalVarianceEvents = 0;

    filteredChecks.forEach(check => {
      const locationName = check.locationName || data.locations.find(l => l.id === check.locationId)?.name || 'Unknown';

      if (!byLocation[check.locationId]) {
        byLocation[check.locationId] = {
          locationId: check.locationId,
          name: locationName,
          shrinkageUnits: 0,
          shrinkageCost: 0,
          checkCount: 0,
          varianceEvents: 0,
        };
      }
      byLocation[check.locationId].checkCount++;

      (check.items || []).forEach(item => {
        const variance = item.variance ?? (item.counted - item.expected);
        if (variance >= 0) return; // Only count negative variance (shrinkage)

        const shrinkageUnits = Math.abs(variance);
        const product = data.products.find(p => p.sku === item.sku);
        const unitCost = product?.unitCost || product?.salePrice || 0;
        const shrinkageCost = shrinkageUnits * unitCost;
        const reason = item.reason || 'unknown';

        // Total
        totalShrinkage += shrinkageUnits;
        totalShrinkageCost += shrinkageCost;
        totalVarianceEvents++;

        // By location
        byLocation[check.locationId].shrinkageUnits += shrinkageUnits;
        byLocation[check.locationId].shrinkageCost += shrinkageCost;
        byLocation[check.locationId].varianceEvents++;

        // By product
        if (!byProduct[item.sku]) {
          byProduct[item.sku] = {
            sku: item.sku,
            name: product?.name || item.sku,
            category: product?.category || 'Unknown',
            shrinkageUnits: 0,
            shrinkageCost: 0,
            occurrences: 0,
          };
        }
        byProduct[item.sku].shrinkageUnits += shrinkageUnits;
        byProduct[item.sku].shrinkageCost += shrinkageCost;
        byProduct[item.sku].occurrences++;

        // By reason
        if (byReason[reason]) {
          byReason[reason].count++;
          byReason[reason].units += shrinkageUnits;
          byReason[reason].cost += shrinkageCost;
        }
      });
    });

    return {
      totalShrinkage,
      totalShrinkageCost,
      totalVarianceEvents,
      byLocation: Object.values(byLocation).sort((a, b) => b.shrinkageCost - a.shrinkageCost),
      byProduct: Object.values(byProduct).sort((a, b) => b.shrinkageCost - a.shrinkageCost),
      byReason,
    };
  }, [filteredChecks, data.products, data.locations]);

  // Calculate shrinkage trend over time
  const trendData = useMemo(() => {
    const byMonth = {};

    filteredChecks.forEach(check => {
      const date = new Date(check.timestamp || check.createdAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

      if (!byMonth[monthKey]) {
        byMonth[monthKey] = { month: monthKey, units: 0, cost: 0, checks: 0 };
      }
      byMonth[monthKey].checks++;

      (check.items || []).forEach(item => {
        const variance = item.variance ?? (item.counted - item.expected);
        if (variance >= 0) return;

        const shrinkageUnits = Math.abs(variance);
        const product = data.products.find(p => p.sku === item.sku);
        const unitCost = product?.unitCost || product?.salePrice || 0;

        byMonth[monthKey].units += shrinkageUnits;
        byMonth[monthKey].cost += shrinkageUnits * unitCost;
      });
    });

    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredChecks, data.products]);

  // Reason labels for display
  const reasonLabels = {
    theft: 'Suspected Theft',
    swap: 'Wrong Item Taken',
    damaged: 'Damaged/Expired',
    malfunction: 'Machine Malfunction',
    unknown: 'Unknown',
  };

  const reasonColors = {
    theft: 'text-red-400 bg-red-500/10',
    swap: 'text-yellow-400 bg-yellow-500/10',
    damaged: 'text-orange-400 bg-orange-500/10',
    malfunction: 'text-blue-400 bg-blue-500/10',
    unknown: 'text-zinc-400 bg-zinc-500/10',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold">Shrinkage Analytics</h2>
          <p className="text-zinc-500 text-sm mt-1">Track and analyze stock variances and losses</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
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
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">Location:</span>
          <select
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="">All Locations</option>
            {data.locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>
        {(dateFilter.start || dateFilter.end || locationFilter) && (
          <button
            onClick={() => { setDateFilter({ start: '', end: '' }); setLocationFilter(''); }}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'byLocation', label: 'By Location' },
          { id: 'byProduct', label: 'By Product' },
          { id: 'byReason', label: 'By Reason' },
          { id: 'trend', label: 'Trend' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{shrinkageData.totalShrinkage}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Units Lost</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">£{shrinkageData.totalShrinkageCost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Loss Value</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-zinc-300">{shrinkageData.totalVarianceEvents}</div>
              <div className="text-xs text-zinc-500 mt-1">Variance Events</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-zinc-300">{filteredChecks.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Stock Checks</div>
            </div>
          </div>

          {/* Reason Breakdown */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Shrinkage by Reason</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {Object.entries(shrinkageData.byReason).map(([reason, stats]) => (
                <div key={reason} className={`rounded-lg p-4 ${reasonColors[reason]}`}>
                  <div className="text-lg font-bold">{stats.units}</div>
                  <div className="text-xs opacity-70">{reasonLabels[reason]}</div>
                  <div className="text-sm font-medium mt-2">£{stats.cost.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Problem Products */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Top Products with Shrinkage</h3>
            {shrinkageData.byProduct.length === 0 ? (
              <p className="text-zinc-600 text-sm">No shrinkage recorded yet</p>
            ) : (
              <div className="space-y-3">
                {shrinkageData.byProduct.slice(0, 5).map(product => (
                  <div key={product.sku} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <div>
                      <span className="text-zinc-200">{product.name}</span>
                      <span className="text-zinc-600 text-xs ml-2">{product.category}</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-400">{product.occurrences}x</span>
                      <span className="text-red-400">{product.shrinkageUnits} units</span>
                      <span className="text-red-400 font-medium">£{product.shrinkageCost.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Problem Locations */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Locations with Most Shrinkage</h3>
            {shrinkageData.byLocation.length === 0 ? (
              <p className="text-zinc-600 text-sm">No shrinkage recorded yet</p>
            ) : (
              <div className="space-y-3">
                {shrinkageData.byLocation.slice(0, 5).map(loc => (
                  <div key={loc.locationId} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-200">{loc.name}</span>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-400">{loc.checkCount} checks</span>
                      <span className="text-red-400">{loc.shrinkageUnits} units</span>
                      <span className="text-red-400 font-medium">£{loc.shrinkageCost.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* By Location Tab */}
      {activeSubTab === 'byLocation' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Location</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Stock Checks</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Variance Events</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Lost</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Loss Value</th>
              </tr>
            </thead>
            <tbody>
              {shrinkageData.byLocation.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                    No shrinkage data available
                  </td>
                </tr>
              ) : (
                shrinkageData.byLocation.map(loc => (
                  <tr key={loc.locationId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-200">{loc.name}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">{loc.checkCount}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">{loc.varianceEvents}</td>
                    <td className="text-right px-4 py-3 text-red-400">{loc.shrinkageUnits}</td>
                    <td className="text-right px-4 py-3 text-red-400 font-medium">£{loc.shrinkageCost.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* By Product Tab */}
      {activeSubTab === 'byProduct' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Occurrences</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Lost</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Loss Value</th>
              </tr>
            </thead>
            <tbody>
              {shrinkageData.byProduct.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                    No shrinkage data available
                  </td>
                </tr>
              ) : (
                shrinkageData.byProduct.map(product => (
                  <tr key={product.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3">
                      <div className="text-zinc-200">{product.name}</div>
                      <div className="text-zinc-600 text-xs">{product.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{product.category}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">{product.occurrences}</td>
                    <td className="text-right px-4 py-3 text-red-400">{product.shrinkageUnits}</td>
                    <td className="text-right px-4 py-3 text-red-400 font-medium">£{product.shrinkageCost.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* By Reason Tab */}
      {activeSubTab === 'byReason' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(shrinkageData.byReason).map(([reason, stats]) => (
              <div key={reason} className={`rounded-lg p-6 border ${reasonColors[reason]} border-current/20`}>
                <h4 className="font-medium mb-4">{reasonLabels[reason]}</h4>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Events</span>
                    <span className="font-medium">{stats.count}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Units Lost</span>
                    <span className="font-medium">{stats.units}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Value Lost</span>
                    <span className="font-medium">£{stats.cost.toFixed(2)}</span>
                  </div>
                  {shrinkageData.totalShrinkageCost > 0 && (
                    <div className="flex justify-between pt-2 border-t border-current/20">
                      <span className="text-zinc-500">% of Total</span>
                      <span className="font-medium">
                        {((stats.cost / shrinkageData.totalShrinkageCost) * 100).toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Reason Distribution (by Value)</h3>
            <div className="space-y-3">
              {Object.entries(shrinkageData.byReason)
                .filter(([, stats]) => stats.cost > 0)
                .sort((a, b) => b[1].cost - a[1].cost)
                .map(([reason, stats]) => {
                  const percentage = shrinkageData.totalShrinkageCost > 0
                    ? (stats.cost / shrinkageData.totalShrinkageCost) * 100
                    : 0;
                  return (
                    <div key={reason}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300">{reasonLabels[reason]}</span>
                        <span className="text-zinc-400">£{stats.cost.toFixed(2)} ({percentage.toFixed(1)}%)</span>
                      </div>
                      <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            reason === 'theft' ? 'bg-red-500' :
                            reason === 'swap' ? 'bg-yellow-500' :
                            reason === 'damaged' ? 'bg-orange-500' :
                            reason === 'malfunction' ? 'bg-blue-500' :
                            'bg-zinc-500'
                          }`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Trend Tab */}
      {activeSubTab === 'trend' && (
        <div className="space-y-6">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Monthly Shrinkage Trend</h3>
            {trendData.length === 0 ? (
              <p className="text-zinc-600 text-sm">No trend data available</p>
            ) : (
              <div className="space-y-4">
                {trendData.map(month => {
                  const maxCost = Math.max(...trendData.map(m => m.cost));
                  const barWidth = maxCost > 0 ? (month.cost / maxCost) * 100 : 0;
                  return (
                    <div key={month.month}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-zinc-300">
                          {new Date(month.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                        </span>
                        <div className="flex gap-4">
                          <span className="text-zinc-500">{month.checks} checks</span>
                          <span className="text-red-400">{month.units} units</span>
                          <span className="text-red-400 font-medium">£{month.cost.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="h-4 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-full transition-all"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Month</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Stock Checks</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Lost</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Value Lost</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Avg per Check</th>
                </tr>
              </thead>
              <tbody>
                {trendData.map(month => (
                  <tr key={month.month} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-200">
                      {new Date(month.month + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                    </td>
                    <td className="text-right px-4 py-3 text-zinc-400">{month.checks}</td>
                    <td className="text-right px-4 py-3 text-red-400">{month.units}</td>
                    <td className="text-right px-4 py-3 text-red-400 font-medium">£{month.cost.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">
                      £{month.checks > 0 ? (month.cost / month.checks).toFixed(2) : '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Data State */}
      {stockChecks.length === 0 && (
        <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-6 text-center">
          <p className="text-blue-300">
            No stock check data available yet. Complete stock checks during restocking to start tracking shrinkage.
          </p>
        </div>
      )}
    </div>
  );
}
