import React, { useState, useEffect, useMemo } from 'react';
import planogramService from '../../services/planogram.service';
import FridgeDiagram from './FridgeDiagram';
import PlanogramEditor from './PlanogramEditor';

/**
 * Visual planogram view for Location Stock.
 *
 * Fetches the location's saved layout + slot assignments and renders the SVG
 * fridge. Quantities and status colours come from the SAME functions the list
 * view uses (getQty / getStockStatus / mealGroups) so the two views never
 * disagree. Renders FROM slot assignments — an empty slot is a real gap.
 */
export default function PlanogramView({
  locationId,
  getQty,
  getStockStatus,
  getGroupStockStatus,
  mealGroups,
  mealTypes,
  products,
  location,
}) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [shareState, setShareState] = useState('idle'); // idle | copying | copied | error

  const copyShareLink = async () => {
    setShareState('copying');
    try {
      const { sharePath } = await planogramService.getShareInfo(locationId);
      const url = `${window.location.origin}${sharePath}`;
      await navigator.clipboard.writeText(url);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2500);
    } catch {
      setShareState('error');
      setTimeout(() => setShareState('idle'), 2500);
    }
  };

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEditing(false);
    planogramService
      .getLocationPlanogram(locationId)
      .then((p) => !cancelled && setPayload(p))
      .catch((err) => !cancelled && setError(err.response?.data?.error || err.message || 'Failed to load planogram'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [locationId]);

  const productBySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products]);
  const groupByName = useMemo(() => new Map((mealGroups || []).map((g) => [g.mealType, g])), [mealGroups]);

  const { slotModels, staleCount } = useMemo(() => {
    const models = {};
    let stale = 0;
    if (!payload?.assignments) return { slotModels: models, staleCount: 0 };

    // How many slots each target occupies (×N marker on shared totals)
    const slotCounts = new Map();
    for (const a of payload.assignments) {
      const key = a.targetType === 'mealType' ? `g:${a.mealType}` : `s:${a.sku}`;
      slotCounts.set(key, (slotCounts.get(key) || 0) + 1);
    }

    for (const a of payload.assignments) {
      if (a.stale) stale += 1;
      let label, qty, color, subtitle;
      const lines = [];

      if (a.targetType === 'mealType') {
        const group = groupByName.get(a.mealType);
        label = a.mealType;
        qty = group ? group.totalQty : 0;
        color = group ? getGroupStockStatus(group.totalQty, group.config).color : 'zinc';
        subtitle = 'Fresh meal group · rotating flavours';
        if (group?.config?.minStock || group?.config?.maxStock) {
          lines.push(`Min ${group.config.minStock || 0} · Max ${group.config.maxStock || 0}`);
        }
      } else {
        const product = a.product || productBySku.get(a.sku);
        label = product?.name || a.sku;
        qty = getQty(a.sku);
        color = getStockStatus(a.sku, qty).color;
        subtitle = a.sku;
      }

      const count = slotCounts.get(a.targetType === 'mealType' ? `g:${a.mealType}` : `s:${a.sku}`) || 1;
      if (count > 1) lines.push(`Total across ${count} slots — per-slot split unknown`);
      if (a.effectiveCapacity != null) {
        lines.push(`Holds ${a.effectiveCapacity} units${a.capacity != null ? ' (slot override)' : ''}`);
      }
      if (a.stale) lines.push('No longer stocked at this location — reassign in Admin › Machine Layout');
      lines.push(`Slot ${a.slotCode}`);

      models[`${a.shelf}-${a.position}`] = {
        label,
        qty,
        multiSlotCount: count,
        statusColor: color,
        stale: a.stale,
        isGroup: a.targetType === 'mealType',
        tooltip: { title: label, subtitle, lines },
      };
    }
    return { slotModels: models, staleCount: stale };
  }, [payload, productBySku, groupByName, getQty, getStockStatus, getGroupStockStatus]);

  // Unplaced products/groups that actually have stock — the weekly gap-check.
  const notPlaced = useMemo(() => {
    if (!payload?.unplaced) return [];
    const items = [];
    for (const g of payload.unplaced.mealTypes || []) {
      const group = groupByName.get(g);
      if (group && group.totalQty > 0) items.push({ key: `g-${g}`, label: g, qty: group.totalQty, isGroup: true });
    }
    for (const sku of payload.unplaced.skus || []) {
      const qty = getQty(sku);
      if (qty > 0) items.push({ key: sku, label: productBySku.get(sku)?.name || sku, qty, isGroup: false });
    }
    return items;
  }, [payload, groupByName, getQty, productBySku]);

  if (loading) return <div className="text-zinc-500 text-sm py-12 text-center">Loading planogram…</div>;
  if (error) {
    return <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{error}</div>;
  }

  if (editing) {
    return (
      <PlanogramEditor
        locationId={locationId}
        payload={payload}
        products={products}
        mealGroups={mealGroups}
        mealTypes={mealTypes}
        location={location}
        onSaved={(fresh) => { setPayload(fresh); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  if (!payload?.layout) {
    return (
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center space-y-3">
        <p className="text-zinc-300 text-sm font-medium">No fridge layout configured for this location.</p>
        <p className="text-zinc-500 text-sm">Set it up right here — drag products into slots and save.</p>
        <button
          onClick={() => setEditing(true)}
          className="px-4 py-2 rounded text-sm font-medium bg-emerald-500 text-zinc-900 hover:bg-emerald-400"
        >
          Configure slots
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={copyShareLink}
          disabled={shareState === 'copying'}
          title="Copy a public link to this machine's restock sheet — hand it to whoever restocks"
          className={`px-3 py-1.5 rounded text-sm transition-colors border ${
            shareState === 'copied'
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
              : shareState === 'error'
                ? 'bg-red-500/15 text-red-400 border-red-500/40'
                : 'bg-zinc-800 text-zinc-400 hover:text-white border-zinc-700'
          }`}
        >
          {shareState === 'copied' ? 'Link copied ✓' : shareState === 'error' ? 'Copy failed' : '⇪ Share restock sheet'}
        </button>
        <button
          onClick={() => setEditing(true)}
          className="px-3 py-1.5 rounded text-sm bg-zinc-800 text-zinc-400 hover:text-white transition-colors border border-zinc-700"
        >
          ✎ Configure slots
        </button>
      </div>

      {staleCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm rounded-lg px-4 py-3">
          {staleCount} slot(s) reference products no longer stocked here — update them in Admin → Machine Layout.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4 items-start">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <FridgeDiagram shelves={payload.layout.shelves} slotModels={slotModels} />
        </div>

        <div className="space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
            <h4 className="text-sm font-medium text-zinc-300 mb-2">Not placed</h4>
            {notPlaced.length === 0 ? (
              <p className="text-xs text-emerald-400">All stocked products have a slot ✓</p>
            ) : (
              <ul className="space-y-1">
                {notPlaced.map((item) => (
                  <li key={item.key} className="flex items-center justify-between text-xs">
                    <span className={`truncate ${item.isGroup ? 'text-teal-300' : 'text-zinc-300'}`}>{item.label}</span>
                    <span className="text-zinc-500 ml-2 shrink-0">{item.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-1.5 text-xs">
            <h4 className="text-sm font-medium text-zinc-300 mb-2">Legend</h4>
            <LegendRow swatch="bg-emerald-500/20 border-emerald-500/40" label="Full / at max" />
            <LegendRow swatch="bg-yellow-500/20 border-yellow-500/40" label="Getting low" />
            <LegendRow swatch="bg-red-500/20 border-red-500/40" label="Low stock" />
            <LegendRow swatch="bg-zinc-700/40 border-zinc-600" label="No min/max set" />
            <LegendRow swatch="border-zinc-600 border-dashed" label="Empty slot (gap)" dashed />
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-zinc-400">Stale — product left the location</span>
            </div>
            <p className="text-zinc-600 pt-1">Teal names are fresh-meal groups (rotating flavours).</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ swatch, label, dashed }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-4 h-3 rounded-sm border ${dashed ? 'border-dashed' : ''} ${swatch}`} />
      <span className="text-zinc-400">{label}</span>
    </div>
  );
}
