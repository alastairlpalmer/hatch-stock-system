import React, { useState, useEffect, useCallback } from 'react';
import { useStock } from '../../context/StockContext';
import vendliveService from '../../services/vendlive.service';
import { inventoryService } from '../../services/inventory.service';
import PlanogramView from '../planogram/PlanogramView';
import { useToast } from '../ui/Toast';

export default function LocationStock() {
  const { data, updateLocationStock, updateLocationConfig, updateLocationAssignedItems, updateMealTypeConfig, updateProductMeal, updateProductParentConfig } = useStock();
  const toast = useToast();
  const [selectedLocation, setSelectedLocation] = useState('');
  // 'list' = existing table; 'visual' = SVG fridge planogram
  const [view, setView] = useState('list');
  // Which collapsed meal-type groups are expanded to show member flavours.
  const [expandedGroups, setExpandedGroups] = useState({});

  // VendLive truth: machine→location mappings (loaded once) and the live channel
  // stock for the selected location's mapped machine(s).
  const [machineMappings, setMachineMappings] = useState([]);
  const [liveStock, setLiveStock] = useState({});       // { sku: stockLevel }
  // status: 'none' (no machine mapped) | 'loading' | 'live' | 'error'
  const [liveStatus, setLiveStatus] = useState('none');
  const [liveUpdatedAt, setLiveUpdatedAt] = useState(null);

  useEffect(() => {
    vendliveService.getMachineMappings()
      .then(setMachineMappings)
      .catch(() => setMachineMappings([]));
  }, []);

  // Earliest known expiry per SKU in machines (60-day window) — one cheap
  // fetch, filtered to the selected location for the per-row chips. Purely
  // informational, so failures just mean no chips. Works alongside live
  // VendLive stock too (expiry comes from our batch records, not VendLive).
  const [machineExpiryRows, setMachineExpiryRows] = useState([]);
  useEffect(() => {
    let cancelled = false;
    inventoryService.getMachineExpiry(60)
      .then(result => {
        if (!cancelled) setMachineExpiryRows(Array.isArray(result?.rows) ? result.rows : []);
      })
      .catch(err => {
        console.error('Machine expiry fetch failed:', err);
        if (!cancelled) setMachineExpiryRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  // Machines mapped to the currently selected location.
  const locationMachines = machineMappings.filter(m => m.locationId === selectedLocation);

  // Fetch VendLive's live channel stock for the selected location and aggregate
  // by SKU. Sums across machines if a location has more than one. No DB writes —
  // this is read-only truth straight from VendLive.
  const fetchLiveStock = useCallback(async () => {
    if (locationMachines.length === 0) {
      setLiveStock({});
      setLiveStatus('none');
      setLiveUpdatedAt(null);
      return;
    }
    setLiveStatus('loading');
    try {
      const responses = await Promise.all(
        locationMachines.map(m => vendliveService.getLiveStock(m.vendliveMachineId))
      );
      const map = {};
      for (const res of responses) {
        for (const p of res.products || []) {
          map[p.sku] = (map[p.sku] || 0) + Math.round(p.totalStock || 0);
        }
      }
      setLiveStock(map);
      setLiveStatus('live');
      setLiveUpdatedAt(new Date());
    } catch (err) {
      console.error('VendLive live stock fetch failed:', err);
      setLiveStatus('error');
    }
  }, [JSON.stringify(locationMachines.map(m => m.vendliveMachineId))]);

  useEffect(() => { fetchLiveStock(); }, [fetchLiveStock]);

  // True when we're showing VendLive truth (a machine is mapped and the fetch
  // succeeded). Drives read-only display and which number feeds totals/status.
  const isLive = liveStatus === 'live';

  // Update selected location when locations load or change
  useEffect(() => {
    if (data.locations.length > 0 && !selectedLocation) {
      setSelectedLocation(data.locations[0].id);
    }
  }, [data.locations, selectedLocation]);
  const [showConfig, setShowConfig] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);

  const location = data.locations.find(l => l.id === selectedLocation);
  const locStock = data.locationStock[selectedLocation] || {};
  const locConfig = data.locationConfig[selectedLocation] || {};

  // Earliest expiry per SKU at the selected location (soonest row wins)
  const expiryBySku = {};
  machineExpiryRows.forEach(r => {
    if (r.locationId !== selectedLocation || !r.earliestExpiry) return;
    const current = expiryBySku[r.sku];
    if (!current || (r.daysUntil ?? 999) < (current.daysUntil ?? 999)) {
      expiryBySku[r.sku] = r;
    }
  });

  // Small expiry chip for a per-SKU row: expired/≤7d red, 8–30d amber, >30d zinc
  const renderExpiryChip = (sku) => {
    const row = expiryBySku[sku];
    if (!row) return null;
    const days = row.daysUntil ?? 999;
    const color = days <= 7
      ? 'bg-red-500/20 text-red-400'
      : days <= 30
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-zinc-700 text-zinc-400';
    const label = days < 0 ? 'expired' : `exp ${days}d`;
    return (
      <span
        className={`inline-block px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap ml-2 align-middle ${color}`}
        title={`Earliest expiry at this location: ${new Date(row.earliestExpiry).toLocaleDateString('en-GB')}`}
      >
        {label}
      </span>
    );
  };

  // The displayed quantity for a SKU. When VendLive truth is available we show
  // its live channel level; otherwise we fall back to the stored DB estimate
  // (non-VendLive locations, or if the live fetch failed).
  const getQty = (sku) => (isLive ? (liveStock[sku] || 0) : (locStock[sku] || 0));

  const getProductsForLocation = () => {
    if (!location) return [];
    if (location.assignedItems?.length > 0) {
      return data.products.filter(p => location.assignedItems.includes(p.sku));
    }
    return data.products;
  };

  const getUnassignedProducts = () => {
    if (!location) return [];
    const assigned = location.assignedItems || [];
    return data.products.filter(p => !assigned.includes(p.sku));
  };

  const addProductToLocation = async (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = [...currentAssigned, sku];
    await updateLocationAssignedItems(selectedLocation, newAssigned);
  };

  const removeProductFromLocation = async (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = currentAssigned.filter(s => s !== sku);
    await updateLocationAssignedItems(selectedLocation, newAssigned);
  };

  const updateStock = async (sku, value) => {
    const newVal = Math.max(0, parseInt(value) || 0);
    await updateLocationStock(selectedLocation, sku, newVal);
  };

  const adjustStock = async (sku, delta) => {
    const current = locStock[sku] || 0;
    await updateStock(sku, current + delta);
  };

  const handleUpdateConfig = async (sku, field, value) => {
    const currentConfig = locConfig[sku] || {};
    const newConfig = {
      ...currentConfig,
      [field]: parseInt(value) || 0
    };
    await updateLocationConfig(selectedLocation, sku, newConfig);
  };

  // Shared status thresholds so per-SKU rows and collapsed meal groups agree.
  const computeStatus = (qty, min = 0, max = 0) => {
    if (max > 0 && qty >= max) return { status: 'full', color: 'green' };
    if (min > 0 && qty <= min) return { status: 'low', color: 'red' };
    if (min > 0 && qty <= min * 1.5) return { status: 'warning', color: 'yellow' };
    return { status: 'ok', color: 'zinc' };
  };

  const getStockStatus = (sku, qty) => {
    const config = locConfig[sku] || {};
    return computeStatus(qty, config.minStock || 0, config.maxStock || 0);
  };

  const getGroupStockStatus = (qty, config = {}) =>
    computeStatus(qty, config.minStock || 0, config.maxStock || 0);

  // Update group capacity (min/max) for a meal-type bucket at this location.
  // Failures surface as a toast — these fire per keystroke, and an unhandled
  // rejection (e.g. offline) previously just did nothing silently.
  const handleUpdateMealConfig = async (mealType, field, value) => {
    const current = (data.locationMealConfig[selectedLocation] || {})[mealType] || {};
    try {
      await updateMealTypeConfig(selectedLocation, mealType, {
        ...current,
        [field]: parseInt(value) || 0,
      });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the group min/max — check the connection');
    }
  };

  // Same, for a product family (Barebells etc.) — keyed by parentId.
  const handleUpdateParentConfig = async (parentId, field, value) => {
    const current = (data.locationParentConfig?.[selectedLocation] || {})[parentId] || {};
    try {
      await updateProductParentConfig(selectedLocation, parentId, {
        ...current,
        [field]: parseInt(value) || 0,
      });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save the family min/max — check the connection');
    }
  };

  const products = getProductsForLocation();
  const unassignedProducts = getUnassignedProducts();

  // Frive fresh meals collapse into meal-type group rows; product-family
  // flavours collapse into family rows; everything else renders per-SKU.
  const freshMeals = products.filter(p => p.isFreshMeal);
  const parentedProducts = products.filter(p => !p.isFreshMeal && p.parentId);
  const regularProducts = products.filter(p => !p.isFreshMeal && !p.parentId);

  // Regular products grouped by category (alphabetical, products alphabetical
  // within), matching the Stock Levels page layout
  const groupedProducts = (() => {
    const groups = {};
    regularProducts.forEach(p => {
      const cat = p.category || 'Uncategorised';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
      }));
  })();

  // Collapse fresh meals into one row per meal-type bucket. Current stock is the
  // SUM of member SKUs' location stock (single source of truth — VendLive sync,
  // restocks keep writing per-SKU). Capacity is per group.
  const mealConfig = data.locationMealConfig[selectedLocation] || {};
  const mealGroups = (() => {
    const groups = {};
    freshMeals.forEach(p => {
      const key = p.mealType || 'Unclassified';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });
    const order = (data.mealTypes || []).map(m => m.name);
    const rank = (name) => {
      const i = order.indexOf(name);
      return i === -1 ? 999 : i; // unknown/Unclassified buckets sort last
    };
    return Object.entries(groups)
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([mealType, items]) => ({
        mealType,
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
        totalQty: items.reduce((acc, p) => acc + getQty(p.sku), 0),
        config: mealConfig[mealType] || {},
      }));
  })();

  // Product families collapse the same way. Reuses the meal-group row renderers
  // (isFamily flags the differences: config keyed by parentId, no
  // "unclassified" state). `mealType` carries the display name.
  const parentConfig = data.locationParentConfig?.[selectedLocation] || {};
  const familyGroups = (() => {
    const byParent = {};
    parentedProducts.forEach(p => {
      (byParent[p.parentId] = byParent[p.parentId] || []).push(p);
    });
    const nameOf = new Map((data.productParents || []).map(pp => [pp.id, pp.name]));
    return Object.entries(byParent)
      .map(([parentId, items]) => ({
        isFamily: true,
        parentId,
        mealType: nameOf.get(parentId) || 'Product family',
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
        totalQty: items.reduce((acc, p) => acc + getQty(p.sku), 0),
        config: parentConfig[parentId] || {},
      }))
      .sort((a, b) => a.mealType.localeCompare(b.mealType));
  })();

  // Gross margin from the VendLive-synced prices; null when either is missing
  const getMargin = (product) => {
    if (!product.salePrice || !product.unitCost) return null;
    const amount = product.salePrice - product.unitCost;
    return { amount, pct: (amount / product.salePrice) * 100 };
  };
  const totalUnits = products.reduce((acc, p) => acc + getQty(p.sku), 0);
  // Value of stock currently in the machine, at cost and at sale price.
  // Products missing a price contribute nothing to that total (rather than
  // guessing), so both figures are floors when prices are incomplete.
  const stockValue = products.reduce(
    (acc, p) => {
      const qty = getQty(p.sku);
      if (qty > 0) {
        acc.cost += qty * (p.unitCost || 0);
        acc.sale += qty * (p.salePrice || 0);
        if (!p.unitCost || !p.salePrice) acc.unpriced += 1;
      }
      return acc;
    },
    { cost: 0, sale: 0, unpriced: 0 }
  );
  // Low-stock: regular products counted per-SKU; each meal group / family once.
  const lowStockCount =
    regularProducts.filter(p => {
      const config = locConfig[p.sku] || {};
      return config.minStock && getQty(p.sku) <= config.minStock;
    }).length +
    mealGroups.filter(g => g.config.minStock && g.totalQty <= g.config.minStock).length +
    familyGroups.filter(g => g.config.minStock && g.totalQty <= g.config.minStock).length;
  const rowCount = regularProducts.length + mealGroups.length + familyGroups.length;

  const hasAssignedItems = location?.assignedItems?.length > 0;
  // Mapped locations mirror their product list from the VendLive planogram on
  // every stock sync — manual add/remove would be silently reverted, so the
  // controls are hidden and a banner points at VendLive instead. Unmapped
  // locations keep the manual workflow.
  const planogramManaged = locationMachines.length > 0;
  const colSpan = showConfig ? 9 : 7;

  // Fresh-meal flavours at this location awaiting a human-confirmed bucket.
  // Surfaced inline (banner + per-row controls) so the weekly review happens
  // right here instead of a hidden Admin page.
  const unconfirmedMeals = freshMeals.filter(p => !p.mealTypeConfirmed);
  const expandGroupsNeedingReview = () => {
    const groups = {};
    unconfirmedMeals.forEach(p => { groups[p.mealType || 'Unclassified'] = true; });
    setExpandedGroups(prev => ({ ...prev, ...groups }));
  };

  // One per-SKU stock row. Reused for regular products and for the expanded
  // member flavours inside a collapsed meal group (indent flag).
  const renderProductRow = (product, { indent = false } = {}) => {
    const qty = getQty(product.sku);
    const config = locConfig[product.sku] || {};
    const { status, color } = getStockStatus(product.sku, qty);
    const margin = getMargin(product);

    return (
      <tr key={product.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
        <td className={`px-4 py-3 text-zinc-200 ${indent ? 'pl-10' : ''}`}>
          {product.name}
          {renderExpiryChip(product.sku)}
          {product.isFreshMeal && !product.mealTypeConfirmed && (
            <InlineMealReview
              product={product}
              mealTypes={data.mealTypes || []}
              updateProductMeal={updateProductMeal}
            />
          )}
        </td>
        <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{product.sku}</td>
        {showConfig && (
          <>
            <td className="px-4 py-3">
              <input
                type="number"
                value={config.minStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'minStock', e.target.value)}
                placeholder="0"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </td>
            <td className="px-4 py-3">
              <input
                type="number"
                value={config.maxStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'maxStock', e.target.value)}
                placeholder="0"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </td>
          </>
        )}
        <td className="px-4 py-3 text-right text-zinc-300">
          {product.salePrice ? (
            `£${product.salePrice.toFixed(2)}`
          ) : (
            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">No price</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          {margin ? (
            <span className={margin.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              £{margin.amount.toFixed(2)}
              <span className="text-zinc-500 text-xs ml-1">({margin.pct.toFixed(0)}%)</span>
            </span>
          ) : (
            <span className="text-zinc-600 text-xs" title="Needs both sale price and cost price">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          <span className={`inline-block px-2 py-0.5 rounded text-xs ${
            color === 'red' ? 'bg-red-500/20 text-red-400' :
            color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
            color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
            'bg-zinc-700 text-zinc-400'
          }`}>
            {status}
          </span>
        </td>
        <td className="px-4 py-3">
          {isLive ? (
            // VendLive truth — read-only. Hand-editing would diverge from the
            // machine. The future "found at machine" count (for shrinkage) lands
            // in its own column, not here.
            <div className="text-right">
              <span className="text-sm text-zinc-200 font-medium">{qty}</span>
            </div>
          ) : (
            <input
              type="number"
              value={qty}
              onChange={e => updateStock(product.sku, e.target.value)}
              className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500 ml-auto block"
            />
          )}
        </td>
        <td className="px-4 py-3">
          {isLive ? (
            <div className="flex items-center justify-center gap-1">
              <span className="text-xs text-zinc-600" title="Stock is read from VendLive">via VendLive</span>
              {showConfig && hasAssignedItems && !planogramManaged && (
                <button
                  onClick={() => removeProductFromLocation(product.sku)}
                  className="w-8 h-8 rounded bg-zinc-800 text-red-400 hover:bg-red-900/50 hover:text-red-300 ml-2"
                  title="Remove from location"
                >
                  ×
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1">
              <button onClick={() => adjustStock(product.sku, -10)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">-10</button>
              <button onClick={() => adjustStock(product.sku, -1)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">-</button>
              <button onClick={() => adjustStock(product.sku, 1)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">+</button>
              <button onClick={() => adjustStock(product.sku, 10)} className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">+10</button>
              {showConfig && hasAssignedItems && !planogramManaged && (
                <button
                  onClick={() => removeProductFromLocation(product.sku)}
                  className="w-8 h-8 rounded bg-zinc-800 text-red-400 hover:bg-red-900/50 hover:text-red-300 ml-2"
                  title="Remove from location"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  };

  // One collapsed group row (meal-type bucket OR product family — isFamily
  // switches the config handler and drops the unclassified state), plus member
  // flavour rows when expanded.
  const groupExpandKey = (group) => (group.isFamily ? `fam:${group.parentId}` : group.mealType);
  const groupConfigChange = (group, field, value) =>
    group.isFamily
      ? handleUpdateParentConfig(group.parentId, field, value)
      : handleUpdateMealConfig(group.mealType, field, value);

  const renderMealGroup = (group) => {
    const expanded = !!expandedGroups[groupExpandKey(group)];
    const { status, color } = getGroupStockStatus(group.totalQty, group.config);
    const unclassified = !group.isFamily && group.mealType === 'Unclassified';
    // Restock planning aid: how many to load to reach the group's target (max).
    const toAdd = group.config.maxStock ? Math.max(0, group.config.maxStock - group.totalQty) : 0;

    return (
      <React.Fragment key={`${group.isFamily ? 'fam' : 'meal'}-${group.mealType}`}>
        <tr className="border-b border-zinc-800/50 bg-teal-500/5 hover:bg-teal-500/10">
          <td className="px-4 py-3">
            <button
              onClick={() => setExpandedGroups(prev => ({ ...prev, [groupExpandKey(group)]: !expanded }))}
              className="flex items-center gap-2 text-left"
            >
              <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
              <span className="text-zinc-100 font-medium">{group.mealType}</span>
            </button>
          </td>
          <td className="px-4 py-3 text-zinc-500 text-xs">
            {group.items.length} flavour{group.items.length === 1 ? '' : 's'}
          </td>
          {showConfig && (
            <>
              <td className="px-4 py-3">
                <input
                  type="number"
                  value={group.config.minStock || ''}
                  onChange={e => groupConfigChange(group, 'minStock', e.target.value)}
                  placeholder="0"
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </td>
              <td className="px-4 py-3">
                <input
                  type="number"
                  value={group.config.maxStock || ''}
                  onChange={e => groupConfigChange(group, 'maxStock', e.target.value)}
                  placeholder="0"
                  className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </td>
            </>
          )}
          <td className="px-4 py-3 text-right text-zinc-600 text-xs">—</td>
          <td className="px-4 py-3 text-right text-zinc-600 text-xs">—</td>
          <td className="px-4 py-3 text-center">
            {unclassified ? (
              <span className="inline-block px-2 py-0.5 rounded text-xs bg-zinc-700 text-zinc-400" title="Set a meal type in Admin → Fresh Meals">unclassified</span>
            ) : (
              <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                color === 'red' ? 'bg-red-500/20 text-red-400' :
                color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-zinc-700 text-zinc-400'
              }`}>
                {status}
              </span>
            )}
          </td>
          <td className="px-4 py-3 text-right">
            <div>
              <span className="text-lg font-semibold text-teal-300">{group.totalQty}</span>
              <span className="text-zinc-500 text-xs ml-1">units</span>
            </div>
            {toAdd > 0 && (
              <div className="text-amber-400 text-xs mt-0.5">add {toAdd} → {group.config.maxStock}</div>
            )}
          </td>
          <td className="px-4 py-3 text-center text-zinc-600 text-xs">
            {expanded ? 'expanded' : 'tap to expand'}
          </td>
        </tr>
        {expanded && (
          group.items.length === 0 ? (
            <tr><td colSpan={colSpan} className="px-4 py-3 pl-10 text-zinc-600 text-xs">
              {group.isFamily ? 'No flavours assigned here.' : 'No flavours stocked this week.'}
            </td></tr>
          ) : (
            group.items.map(product => renderProductRow(product, { indent: true }))
          )
        )}
      </React.Fragment>
    );
  };

  // Mobile (below md) stacked card for one per-SKU product. Same data and
  // handlers as renderProductRow — layout only.
  const renderProductCard = (product, { indent = false } = {}) => {
    const qty = getQty(product.sku);
    const config = locConfig[product.sku] || {};
    const { status, color } = getStockStatus(product.sku, qty);
    const margin = getMargin(product);

    return (
      <div
        key={product.sku}
        className={`border-b border-zinc-800/50 px-4 py-3 space-y-3 ${indent ? 'pl-8 bg-zinc-800/20' : ''}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-zinc-200 text-sm">
              {product.name}
              {renderExpiryChip(product.sku)}
            </div>
            <div className="text-zinc-500 text-xs font-mono mt-0.5">{product.sku}</div>
            {product.isFreshMeal && !product.mealTypeConfirmed && (
              <InlineMealReview
                product={product}
                mealTypes={data.mealTypes || []}
                updateProductMeal={updateProductMeal}
              />
            )}
          </div>
          <span className={`inline-block px-2 py-0.5 rounded text-xs shrink-0 ${
            color === 'red' ? 'bg-red-500/20 text-red-400' :
            color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
            color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
            'bg-zinc-700 text-zinc-400'
          }`}>
            {status}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2 min-w-0">
            {product.salePrice ? (
              <span className="text-zinc-300">£{product.salePrice.toFixed(2)}</span>
            ) : (
              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">No price</span>
            )}
            {margin ? (
              <span className={margin.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                £{margin.amount.toFixed(2)}
                <span className="text-zinc-500 text-xs ml-1">({margin.pct.toFixed(0)}%)</span>
              </span>
            ) : (
              <span className="text-zinc-600 text-xs" title="Needs both sale price and cost price">—</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-500">{isLive ? 'Stock (VendLive)' : 'Stock'}</span>
            {isLive ? (
              // VendLive truth — read-only, same as the desktop row.
              <span className="text-sm text-zinc-200 font-medium">{qty}</span>
            ) : (
              <input
                type="number"
                inputMode="numeric"
                value={qty}
                onChange={e => updateStock(product.sku, e.target.value)}
                className="w-20 h-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500"
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="text-xs text-zinc-600" title="Stock is read from VendLive">via VendLive</span>
          ) : (
            <>
              <button onClick={() => adjustStock(product.sku, -10)} className="flex-1 h-10 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">-10</button>
              <button onClick={() => adjustStock(product.sku, -1)} className="flex-1 h-10 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">-</button>
              <button onClick={() => adjustStock(product.sku, 1)} className="flex-1 h-10 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white">+</button>
              <button onClick={() => adjustStock(product.sku, 10)} className="flex-1 h-10 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs">+10</button>
            </>
          )}
          {showConfig && hasAssignedItems && !planogramManaged && (
            <button
              onClick={() => removeProductFromLocation(product.sku)}
              className="h-10 w-10 shrink-0 rounded bg-zinc-800 text-red-400 hover:bg-red-900/50 hover:text-red-300 ml-auto"
              title="Remove from location"
            >
              ×
            </button>
          )}
        </div>

        {showConfig && (
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs text-zinc-500">Min Stock</span>
              <input
                type="number"
                inputMode="numeric"
                value={config.minStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'minStock', e.target.value)}
                placeholder="0"
                className="mt-1 w-full h-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block">
              <span className="text-xs text-zinc-500">Max Stock</span>
              <input
                type="number"
                inputMode="numeric"
                value={config.maxStock || ''}
                onChange={e => handleUpdateConfig(product.sku, 'maxStock', e.target.value)}
                placeholder="0"
                className="mt-1 w-full h-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
              />
            </label>
          </div>
        )}
      </div>
    );
  };

  // Mobile (below md) card for one collapsed meal-type group, plus member
  // flavour cards when expanded. Same handlers as renderMealGroup.
  const renderMealGroupCard = (group) => {
    const expanded = !!expandedGroups[groupExpandKey(group)];
    const { status, color } = getGroupStockStatus(group.totalQty, group.config);
    const unclassified = !group.isFamily && group.mealType === 'Unclassified';
    const toAdd = group.config.maxStock ? Math.max(0, group.config.maxStock - group.totalQty) : 0;

    return (
      <React.Fragment key={`${group.isFamily ? 'fam' : 'meal'}-${group.mealType}`}>
        <div className="border-b border-zinc-800/50 bg-teal-500/5 px-4 py-3 space-y-3">
          <button
            onClick={() => setExpandedGroups(prev => ({ ...prev, [groupExpandKey(group)]: !expanded }))}
            className="flex items-center justify-between gap-2 w-full min-h-[2.5rem] text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-zinc-500 text-xs w-3 shrink-0">{expanded ? '▾' : '▸'}</span>
              <span className="text-zinc-100 font-medium">{group.mealType}</span>
              <span className="text-zinc-500 text-xs">
                {group.items.length} flavour{group.items.length === 1 ? '' : 's'}
              </span>
            </span>
            {unclassified ? (
              <span className="inline-block px-2 py-0.5 rounded text-xs bg-zinc-700 text-zinc-400 shrink-0" title="Set a meal type in Admin → Fresh Meals">unclassified</span>
            ) : (
              <span className={`inline-block px-2 py-0.5 rounded text-xs shrink-0 ${
                color === 'red' ? 'bg-red-500/20 text-red-400' :
                color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
                'bg-zinc-700 text-zinc-400'
              }`}>
                {status}
              </span>
            )}
          </button>
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-lg font-semibold text-teal-300">{group.totalQty}</span>
              <span className="text-zinc-500 text-xs ml-1">units</span>
              {toAdd > 0 && (
                <div className="text-amber-400 text-xs mt-0.5">add {toAdd} → {group.config.maxStock}</div>
              )}
            </div>
            <span className="text-zinc-600 text-xs">{expanded ? 'expanded' : 'tap to expand'}</span>
          </div>
          {showConfig && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-zinc-500">Min Stock</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={group.config.minStock || ''}
                  onChange={e => groupConfigChange(group, 'minStock', e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full h-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </label>
              <label className="block">
                <span className="text-xs text-zinc-500">Max Stock</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={group.config.maxStock || ''}
                  onChange={e => groupConfigChange(group, 'maxStock', e.target.value)}
                  placeholder="0"
                  className="mt-1 w-full h-10 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </label>
            </div>
          )}
        </div>
        {expanded && (
          group.items.length === 0 ? (
            <div className="border-b border-zinc-800/50 px-4 py-3 pl-8 text-zinc-600 text-xs">
              {group.isFamily ? 'No flavours assigned here.' : 'No flavours stocked this week.'}
            </div>
          ) : (
            group.items.map(product => renderProductCard(product, { indent: true }))
          )
        )}
      </React.Fragment>
    );
  };

  // Show message if no locations exist
  if (data.locations.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold">Location Stock</h2>
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
          <p className="text-zinc-400 mb-4">No locations configured yet.</p>
          <p className="text-zinc-500 text-sm">Go to Admin → Locations to add your first location.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Location Stock</h2>
          <p className="text-zinc-500 text-sm mt-1 hidden md:block">View and update stock levels at each location</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          {liveStatus !== 'none' && (
            <div className="flex items-center gap-2">
              {liveStatus === 'loading' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-400">
                  <span className="animate-spin">↻</span> Loading VendLive…
                </span>
              )}
              {liveStatus === 'live' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-emerald-500/15 text-emerald-400" title={liveUpdatedAt ? `Updated ${liveUpdatedAt.toLocaleTimeString()}` : ''}>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> VendLive · live
                  {liveUpdatedAt && <span className="text-emerald-600/70">{liveUpdatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
                </span>
              )}
              {liveStatus === 'error' && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-red-500/15 text-red-400" title="Showing last-known DB stock instead">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400" /> VendLive unreachable
                </span>
              )}
              <button
                onClick={fetchLiveStock}
                disabled={liveStatus === 'loading'}
                className="px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-400 hover:text-white disabled:opacity-50"
                title="Refresh from VendLive"
              >
                ↻ Refresh
              </button>
            </div>
          )}
          <select
            value={selectedLocation}
            onChange={e => { setSelectedLocation(e.target.value); setShowAddProduct(false); }}
            className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            {data.locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <div className="flex rounded overflow-hidden border border-zinc-700">
              <button
                onClick={() => setView('list')}
                className={`px-3 py-2.5 text-sm transition-colors ${
                  view === 'list' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                List
              </button>
              <button
                onClick={() => { setView('visual'); setShowConfig(false); setShowAddProduct(false); }}
                className={`px-3 py-2.5 text-sm transition-colors ${
                  view === 'visual' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                Visual
              </button>
            </div>
            {view === 'list' && (
              <button
                onClick={() => { setShowConfig(!showConfig); setShowAddProduct(false); }}
                className={`flex-1 sm:flex-none px-3 py-2.5 rounded text-sm transition-colors ${
                  showConfig ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {showConfig ? 'Done' : 'Config'}
              </button>
            )}
          </div>
        </div>
      </div>

      {location && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">{rowCount}</div>
              <div className="text-xs text-zinc-500 mt-1">{mealGroups.length > 0 ? 'Products / meal groups' : 'Products'}</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{totalUnits}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Units</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{lowStockCount}</div>
              <div className="text-xs text-zinc-500 mt-1">Low Stock Items</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">
                £{stockValue.sale.toFixed(2)}
                <span className="text-sm font-medium text-zinc-400 ml-2">retail</span>
              </div>
              <div className="text-xs text-zinc-500 mt-1">
                £{stockValue.cost.toFixed(2)} at cost
                {stockValue.unpriced > 0 && (
                  <span
                    className="text-amber-400/80 ml-1"
                    title={`${stockValue.unpriced} stocked product(s) missing a cost or sale price — excluded from these totals`}
                  >
                    · {stockValue.unpriced} unpriced
                  </span>
                )}
              </div>
            </div>
          </div>

          {view === 'visual' && (
            <PlanogramView
              locationId={selectedLocation}
              getQty={getQty}
              getStockStatus={getStockStatus}
              getGroupStockStatus={getGroupStockStatus}
              mealGroups={mealGroups}
              mealTypes={data.mealTypes}
              parentGroups={familyGroups.map(g => ({
                parentId: g.parentId,
                name: g.mealType,
                totalQty: g.totalQty,
                config: g.config,
              }))}
              products={data.products}
              location={location}
            />
          )}

          {view === 'list' && (<>
          {unconfirmedMeals.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-amber-400">
                {unconfirmedMeals.length} fresh-meal flavour{unconfirmedMeals.length === 1 ? '' : 's'} need{unconfirmedMeals.length === 1 ? 's' : ''} a
                confirmed bucket — pick Meat / Veg on the flavour rows below so group counts and ordering stay right.
              </p>
              <button
                onClick={expandGroupsNeedingReview}
                className="px-3 py-1.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40"
              >
                Show them
              </button>
            </div>
          )}
          {showConfig && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div>
                  <h4 className="text-sm font-medium text-zinc-300">Assigned Products</h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    {planogramManaged
                      ? `${products.length} products — synced from the VendLive planogram`
                      : hasAssignedItems
                        ? `${products.length} products assigned to this location`
                        : 'All products allowed (no specific assignments)'}
                  </p>
                </div>
                {!planogramManaged && unassignedProducts.length > 0 && (
                  <button
                    onClick={() => setShowAddProduct(!showAddProduct)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-500"
                  >
                    + Add Product
                  </button>
                )}
              </div>

              {planogramManaged && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-teal-500/10 border border-teal-500/30 text-xs text-teal-300">
                  This machine's product list syncs from its VendLive planogram on every stock
                  sync — add or remove products in VendLive and they'll appear here automatically.
                </div>
              )}

              {!planogramManaged && showAddProduct && unassignedProducts.length > 0 && (
                <div className="mb-4 p-3 bg-zinc-800/50 rounded-lg">
                  <p className="text-xs text-zinc-400 mb-2">Select products to add:</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {unassignedProducts.map(p => (
                      <button
                        key={p.sku}
                        onClick={() => addProductToLocation(p.sku)}
                        className="px-3 py-1.5 bg-zinc-700 hover:bg-emerald-600 text-zinc-300 hover:text-white rounded text-sm transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            {/* Desktop (md+) table — horizontal scroll as fallback at narrow md widths */}
            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                  {showConfig && (
                    <>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Min Stock</th>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Max Stock</th>
                    </>
                  )}
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Sale Price</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Margin</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">{isLive ? 'Stock (VendLive)' : 'Current Stock'}</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rowCount === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="px-4 py-8 text-center text-zinc-600">
                      No products assigned to this location
                    </td>
                  </tr>
                ) : (
                  <>
                    {/* Frive fresh meals — collapsed into one row per meal type */}
                    {mealGroups.length > 0 && (
                      <React.Fragment key="fresh-meals">
                        <tr className="bg-teal-900/40">
                          <td colSpan={colSpan} className="px-4 py-2">
                            <span className="text-teal-300 font-medium text-xs uppercase tracking-wide">Fresh Meals (Frive)</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {mealGroups.length} group{mealGroups.length === 1 ? '' : 's'} · {mealGroups.reduce((acc, g) => acc + g.totalQty, 0)} units here · combined volume per meal type
                            </span>
                          </td>
                        </tr>
                        {mealGroups.map(group => renderMealGroup(group))}
                      </React.Fragment>
                    )}

                    {/* Product families — collapsed into one row per family */}
                    {familyGroups.length > 0 && (
                      <React.Fragment key="product-families">
                        <tr className="bg-teal-900/40">
                          <td colSpan={colSpan} className="px-4 py-2">
                            <span className="text-teal-300 font-medium text-xs uppercase tracking-wide">Product Families</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {familyGroups.length} famil{familyGroups.length === 1 ? 'y' : 'ies'} · {familyGroups.reduce((acc, g) => acc + g.totalQty, 0)} units here · min/max set per family
                            </span>
                          </td>
                        </tr>
                        {familyGroups.map(group => renderMealGroup(group))}
                      </React.Fragment>
                    )}

                    {/* Everything else — per-SKU, grouped by category */}
                    {groupedProducts.map(group => (
                      <React.Fragment key={group.category}>
                        <tr className="bg-zinc-800/60">
                          <td colSpan={colSpan} className="px-4 py-2">
                            <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                            <span className="text-zinc-500 text-xs ml-3">
                              {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, p) => acc + getQty(p.sku), 0)} units here
                            </span>
                          </td>
                        </tr>
                        {group.items.map(product => renderProductRow(product))}
                      </React.Fragment>
                    ))}
                  </>
                )}
              </tbody>
            </table>
            </div>

            {/* Mobile (below md) — stacked cards, same data and handlers */}
            <div className="md:hidden">
              {rowCount === 0 ? (
                <div className="px-4 py-8 text-center text-zinc-600">
                  No products assigned to this location
                </div>
              ) : (
                <>
                  {/* Frive fresh meals — collapsed into one card per meal type */}
                  {mealGroups.length > 0 && (
                    <React.Fragment key="fresh-meals-mobile">
                      <div className="bg-teal-900/40 px-4 py-2">
                        <span className="text-teal-300 font-medium text-xs uppercase tracking-wide">Fresh Meals (Frive)</span>
                        <span className="text-zinc-500 text-xs ml-3">
                          {mealGroups.length} group{mealGroups.length === 1 ? '' : 's'} · {mealGroups.reduce((acc, g) => acc + g.totalQty, 0)} units here · combined volume per meal type
                        </span>
                      </div>
                      {mealGroups.map(group => renderMealGroupCard(group))}
                    </React.Fragment>
                  )}

                  {/* Product families — collapsed into one card per family */}
                  {familyGroups.length > 0 && (
                    <React.Fragment key="product-families-mobile">
                      <div className="bg-teal-900/40 px-4 py-2">
                        <span className="text-teal-300 font-medium text-xs uppercase tracking-wide">Product Families</span>
                        <span className="text-zinc-500 text-xs ml-3">
                          {familyGroups.length} famil{familyGroups.length === 1 ? 'y' : 'ies'} · {familyGroups.reduce((acc, g) => acc + g.totalQty, 0)} units here
                        </span>
                      </div>
                      {familyGroups.map(group => renderMealGroupCard(group))}
                    </React.Fragment>
                  )}

                  {/* Everything else — per-SKU, grouped by category */}
                  {groupedProducts.map(group => (
                    <React.Fragment key={group.category}>
                      <div className="bg-zinc-800/60 px-4 py-2">
                        <span className="text-emerald-400 font-medium text-xs uppercase tracking-wide">{group.category}</span>
                        <span className="text-zinc-500 text-xs ml-3">
                          {group.items.length} product{group.items.length === 1 ? '' : 's'} · {group.items.reduce((acc, p) => acc + getQty(p.sku), 0)} units here
                        </span>
                      </div>
                      {group.items.map(product => renderProductCard(product))}
                    </React.Fragment>
                  ))}
                </>
              )}
            </div>
          </div>

          {showConfig && (
            <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                <strong>Configuration Tips:</strong> Set min/max stock levels per product. Items at or below minimum show as "low". Use the + Add Product button to assign new products to this location (syncs with Admin settings).
              </p>
            </div>
          )}
          </>)}
        </>
      )}
    </div>
  );
}

// Inline fresh-meal review — the Admin → Fresh Meals approval flow, moved to
// where the flavours are actually seen. Renders under an unconfirmed
// flavour's name: pick a bucket and confirm (moves it into that group row
// immediately), or mark it not-a-meal (drops it back into its raw category).
// Confirmed classifications are sticky — this control disappears after.
function InlineMealReview({ product, mealTypes, updateProductMeal }) {
  const [mealType, setMealType] = useState(product.mealType || '');
  const [busy, setBusy] = useState(false);
  const names = mealTypes.map(m => m.name);

  const run = async (body) => {
    setBusy(true);
    try {
      await updateProductMeal(product.sku, body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span
      className="inline-flex items-center gap-1.5 ml-2 align-middle"
      onClick={e => e.stopPropagation()}
    >
      <span className="text-[10px] uppercase tracking-wide bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
        review
      </span>
      <select
        value={mealType}
        onChange={e => setMealType(e.target.value)}
        disabled={busy}
        className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-emerald-500"
      >
        <option value="">Unclassified</option>
        {names.map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
        {product.mealType && !names.includes(product.mealType) && (
          <option value={product.mealType}>{product.mealType} (removed)</option>
        )}
      </select>
      <button
        onClick={() => run({ mealType: mealType || null, mealTypeConfirmed: true })}
        disabled={busy || !mealType}
        title={mealType ? `Confirm as ${mealType}` : 'Pick a bucket first'}
        className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        {busy ? '…' : 'Confirm'}
      </button>
      <button
        onClick={() => run({ isFreshMeal: false, mealTypeConfirmed: true })}
        disabled={busy}
        title="Not a fresh meal — moves back to its normal category"
        className="text-zinc-500 hover:text-red-400 text-xs"
      >
        not a meal
      </button>
    </span>
  );
}
