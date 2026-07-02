import React, { useState, useMemo } from 'react';
import { useStock } from '../../context/StockContext';
import { inventoryService } from '../../services';

// One-tap categorisation chips for discrepancy lines (API vocabulary)
const CHIP_REASONS = [
  { value: 'theft', label: 'Theft' },
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'miscount', label: 'Miscount' },
  { value: 'unknown', label: 'Unknown' },
];

export default function Shrinkage() {
  const { data } = useStock();
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });
  const [locationFilter, setLocationFilter] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('overview');
  // Optimistic reason edits keyed `${checkId}:${sku}` — layered over the
  // stock-check items so the by-reason breakdown updates without a refetch.
  const [reasonOverrides, setReasonOverrides] = useState({});
  const [reasonSaving, setReasonSaving] = useState({});
  const [reasonError, setReasonError] = useState(null);

  const stockChecks = data.stockCheckHistory || [];

  // Reason for a line, with any optimistic local edit applied
  const effectiveReason = (check, item) =>
    (check.id && reasonOverrides[`${check.id}:${item.sku}`]) || item.reason || 'unknown';

  // Tag a discrepancy line with a reason — optimistic UI, revert on error
  const setLineReason = async (line, reason) => {
    if (!line.checkId || reason === line.reason) return;
    const key = `${line.checkId}:${line.sku}`;
    if (reasonSaving[key]) return;
    const previous = reasonOverrides[key];
    setReasonError(null);
    setReasonSaving(prev => ({ ...prev, [key]: true }));
    setReasonOverrides(prev => ({ ...prev, [key]: reason }));
    try {
      await inventoryService.setStockCheckItemReason(line.checkId, line.sku, reason);
    } catch (err) {
      // Revert the optimistic update
      setReasonOverrides(prev => {
        const next = { ...prev };
        if (previous === undefined) delete next[key];
        else next[key] = previous;
        return next;
      });
      setReasonError(err.message || 'Failed to save the reason — please try again.');
    } finally {
      setReasonSaving(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

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

  // Normalise variance orientation per check source. VendLive-generated checks
  // store variance = expected − confirmed (POSITIVE = loss), while manual
  // restock checks store variance = counted − expected (NEGATIVE = loss).
  // Returns units oriented so positive = loss, negative = overage.
  const lossOrientedVariance = (check, item) => {
    const isVendlive = check.source === 'vendlive';
    if (item.variance != null) {
      return isVendlive ? item.variance : -item.variance;
    }
    // Fallback when variance is missing: expected − counted (positive = loss)
    return (item.expected ?? 0) - (item.counted ?? item.confirmed ?? 0);
  };

  // Calculate shrinkage metrics from stock checks
  const shrinkageData = useMemo(() => {
    const byLocation = {};
    const byProduct = {};
    const byReason = {
      theft: { count: 0, units: 0, cost: 0 },
      expired: { count: 0, units: 0, cost: 0 },
      damaged: { count: 0, units: 0, cost: 0 },
      miscount: { count: 0, units: 0, cost: 0 },
      swap: { count: 0, units: 0, cost: 0 },
      malfunction: { count: 0, units: 0, cost: 0 },
      unknown: { count: 0, units: 0, cost: 0 },
    };
    let totalShrinkage = 0;
    let totalShrinkageCost = 0;
    let totalVarianceEvents = 0;
    let totalOverage = 0;
    let totalOverageEvents = 0;

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
        const oriented = lossOrientedVariance(check, item);
        if (oriented === 0) return;
        if (oriented < 0) {
          // Overage — extra units found (restock noise), tracked separately
          totalOverage += -oriented;
          totalOverageEvents++;
          return;
        }

        const shrinkageUnits = oriented;
        const product = data.products.find(p => p.sku === item.sku);
        // Loss is valued at COST only — using sale price would overstate it
        const unitCost = product?.unitCost || 0;
        const shrinkageCost = shrinkageUnits * unitCost;
        const reason = effectiveReason(check, item);

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
      totalOverage,
      totalOverageEvents,
      byLocation: Object.values(byLocation).sort((a, b) => b.shrinkageCost - a.shrinkageCost),
      byProduct: Object.values(byProduct).sort((a, b) => b.shrinkageCost - a.shrinkageCost),
      byReason,
    };
  }, [filteredChecks, data.products, data.locations, reasonOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

  // Individual discrepancy (loss) lines across the filtered checks —
  // these are what get tagged with a reason on the Discrepancies tab.
  const lossLines = useMemo(() => {
    const lines = [];
    filteredChecks.forEach(check => {
      const locationName = check.locationName || data.locations.find(l => l.id === check.locationId)?.name || 'Unknown';
      (check.items || []).forEach(item => {
        const units = lossOrientedVariance(check, item);
        if (units <= 0) return;
        const product = data.products.find(p => p.sku === item.sku);
        lines.push({
          key: `${check.id || 'nocheck'}:${item.sku}:${check.timestamp || check.createdAt || ''}`,
          checkId: check.id || null,
          sku: item.sku,
          name: product?.name || item.sku,
          units,
          cost: units * (product?.unitCost || 0),
          date: check.timestamp || check.createdAt,
          locationName,
          reason: effectiveReason(check, item),
        });
      });
    });
    return lines.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [filteredChecks, data.products, data.locations, reasonOverrides]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const oriented = lossOrientedVariance(check, item);
        if (oriented <= 0) return; // only losses feed the trend

        const shrinkageUnits = oriented;
        const product = data.products.find(p => p.sku === item.sku);
        const unitCost = product?.unitCost || 0;

        byMonth[monthKey].units += shrinkageUnits;
        byMonth[monthKey].cost += shrinkageUnits * unitCost;
      });
    });

    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredChecks, data.products]);

  // Reason labels for display ('swap'/'malfunction' are legacy values kept
  // so historical checks still group correctly)
  const reasonLabels = {
    theft: 'Suspected Theft',
    expired: 'Expired',
    damaged: 'Damaged',
    miscount: 'Miscount',
    swap: 'Wrong Item Taken',
    malfunction: 'Machine Malfunction',
    unknown: 'Unknown',
  };

  const reasonColors = {
    theft: 'text-red-400 bg-red-500/10',
    expired: 'text-amber-400 bg-amber-500/10',
    damaged: 'text-orange-400 bg-orange-500/10',
    miscount: 'text-purple-400 bg-purple-500/10',
    swap: 'text-yellow-400 bg-yellow-500/10',
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
          { id: 'items', label: 'Discrepancies' },
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
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{shrinkageData.totalShrinkage}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Units Lost</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">£{shrinkageData.totalShrinkageCost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Loss Value</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">{shrinkageData.totalOverage}</div>
              <div className="text-xs text-zinc-500 mt-1">Overage Units ({shrinkageData.totalOverageEvents} events)</div>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

      {/* Discrepancies Tab — individual loss lines with one-tap reason chips */}
      {activeSubTab === 'items' && (
        <div className="space-y-3">
          {reasonError && (
            <div className="flex items-start justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
              <p className="min-w-0">{reasonError}</p>
              <button
                onClick={() => setReasonError(null)}
                className="flex-shrink-0 text-red-300 hover:text-red-100"
              >
                Dismiss
              </button>
            </div>
          )}

          {lossLines.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-sm">
              No discrepancies in the selected period
            </div>
          ) : (
            lossLines.map(line => {
              const saving = line.checkId ? reasonSaving[`${line.checkId}:${line.sku}`] : false;
              return (
                <div key={line.key} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-zinc-200 truncate">{line.name}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {line.locationName}
                        {line.date && (
                          <> · {new Date(line.date).toLocaleDateString('en-GB')}</>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-red-400 font-medium">−{line.units} unit{line.units === 1 ? '' : 's'}</div>
                      <div className="text-xs text-red-400/70">£{line.cost.toFixed(2)}</div>
                    </div>
                  </div>

                  {line.checkId ? (
                    <div className="flex flex-wrap gap-2">
                      {CHIP_REASONS.map(chip => {
                        const active = line.reason === chip.value;
                        return (
                          <button
                            key={chip.value}
                            onClick={() => setLineReason(line, chip.value)}
                            disabled={saving}
                            className={`min-h-[44px] px-4 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 ${
                              active
                                ? `${reasonColors[chip.value]} border-current`
                                : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                            }`}
                          >
                            {chip.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-600">
                      Reason tagging isn&rsquo;t available for this record
                    </p>
                  )}
                </div>
              );
            })
          )}
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
                            reason === 'expired' ? 'bg-amber-500' :
                            reason === 'swap' ? 'bg-yellow-500' :
                            reason === 'damaged' ? 'bg-orange-500' :
                            reason === 'miscount' ? 'bg-purple-500' :
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
