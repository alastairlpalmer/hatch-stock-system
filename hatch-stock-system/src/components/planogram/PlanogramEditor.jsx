import React, { useState, useMemo, useRef, useEffect } from 'react';
import planogramService from '../../services/planogram.service';
import { slotCode } from '../../utils/planogramGeometry';

/**
 * Drag-and-drop slot editor for the Location Stock Visual view.
 *
 * Left: palette of the location's products (fresh-meal groups first, then
 * products by category, searchable). Right: the fridge as an HTML grid of
 * drop-target slots. Drag a palette chip onto a slot to place it; drag a
 * filled slot onto another slot to move (or swap) it; × clears a slot.
 * Click-to-place works as a touch/keyboard fallback: click a chip to arm it,
 * then click a slot.
 *
 * All edits are a local draft until Save — the server writes position history
 * automatically (same PUT as the Admin editor). Shelf structure (adding
 * shelves / changing facings) stays in Admin → Machine Layout; this editor is
 * optimised for the weekly product-into-slot pass.
 */

const DEFAULT_SHELVES = 8;
const DEFAULT_FACINGS = 6;

const keyOf = (shelf, position) => `${shelf}-${position}`;

function sameTarget(a, b) {
  if (!a || !b) return false;
  return a.targetType === b.targetType && a.sku === b.sku && a.mealType === b.mealType;
}

export default function PlanogramEditor({ locationId, payload, products, mealGroups, mealTypes, location, onSaved, onCancel }) {
  const [shelves, setShelves] = useState(() =>
    payload?.layout?.shelves?.length
      ? payload.layout.shelves
      : Array.from({ length: DEFAULT_SHELVES }, (_, i) => ({ shelf: i + 1, slots: DEFAULT_FACINGS }))
  );
  const [slots, setSlots] = useState(() => {
    const map = {};
    for (const a of payload?.assignments || []) {
      map[keyOf(a.shelf, a.position)] = {
        targetType: a.targetType,
        sku: a.sku || undefined,
        mealType: a.mealType || undefined,
      };
    }
    return map;
  });
  const [dirty, setDirty] = useState(!payload?.layout); // fresh template = unsaved
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [armed, setArmed] = useState(null); // click-to-place fallback
  const [dragOver, setDragOver] = useState(null); // slot key under a drag
  const dragSource = useRef(null); // { target, fromKey|null }

  // Warn on tab close with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const productBySku = useMemo(() => new Map((products || []).map((p) => [p.sku, p])), [products]);

  // Palette vocabulary: this location's mirrored products; fresh meals as groups.
  const palette = useMemo(() => {
    const assigned = new Set(location?.assignedItems || []);
    const list = (products || []).filter((p) => assigned.has(p.sku));
    const groupNames = new Set();
    const byCategory = {};
    for (const p of list) {
      if (p.isFreshMeal) groupNames.add(p.mealType || 'Unclassified');
      else {
        const cat = p.category || 'Uncategorised';
        (byCategory[cat] = byCategory[cat] || []).push(p);
      }
    }
    const order = (mealTypes || []).map((m) => m.name);
    const groups = [...groupNames].sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });
    const categories = Object.entries(byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({
        category,
        items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)),
      }));
    return { groups, categories };
  }, [location, products, mealTypes]);

  // Placement counts so the palette shows what's already in the fridge
  const placedCounts = useMemo(() => {
    const counts = new Map();
    for (const t of Object.values(slots)) {
      const k = t.targetType === 'mealType' ? `g:${t.mealType}` : `s:${t.sku}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [slots]);

  const groupQty = (name) => (mealGroups || []).find((g) => g.mealType === name)?.totalQty ?? 0;

  const targetLabel = (t) =>
    t.targetType === 'mealType' ? t.mealType : productBySku.get(t.sku)?.name || t.sku;

  // ---- mutations ----

  const place = (shelf, position, target) => {
    setSlots((s) => ({ ...s, [keyOf(shelf, position)]: target }));
    setDirty(true);
  };

  const clear = (shelf, position) => {
    setSlots((s) => {
      const next = { ...s };
      delete next[keyOf(shelf, position)];
      return next;
    });
    setDirty(true);
  };

  const moveOrSwap = (fromKey, shelf, position) => {
    const toKey = keyOf(shelf, position);
    if (fromKey === toKey) return;
    setSlots((s) => {
      const next = { ...s };
      const moving = next[fromKey];
      if (!moving) return s;
      const displaced = next[toKey];
      next[toKey] = moving;
      if (displaced) next[fromKey] = displaced; // swap
      else delete next[fromKey];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        shelves,
        assignments: Object.entries(slots).map(([key, target]) => {
          const [shelf, position] = key.split('-').map(Number);
          return { shelf, position, ...target };
        }),
      };
      const fresh = await planogramService.saveLocationPlanogram(locationId, body);
      setDirty(false);
      onSaved(fresh);
    } catch (err) {
      const details = err.response?.data?.details;
      setError(details ? details.join('; ') : err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm('Discard unsaved slot changes?')) return;
    onCancel();
  };

  // ---- drag handlers ----

  const startPaletteDrag = (e, target) => {
    dragSource.current = { target, fromKey: null };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', targetLabel(target)); // required by some browsers
  };

  const startSlotDrag = (e, key) => {
    const target = slots[key];
    if (!target) return;
    dragSource.current = { target, fromKey: key };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', targetLabel(target));
  };

  const dropOnSlot = (e, shelf, position) => {
    e.preventDefault();
    setDragOver(null);
    const src = dragSource.current;
    dragSource.current = null;
    if (!src) return;
    if (src.fromKey) moveOrSwap(src.fromKey, shelf, position);
    else place(shelf, position, src.target);
  };

  const handleSlotClick = (shelf, position) => {
    if (armed) {
      place(shelf, position, armed);
      setArmed(null);
    }
  };

  // ---- palette filtering ----

  const q = search.trim().toLowerCase();
  const matches = (name) => !q || name.toLowerCase().includes(q);
  const visibleGroups = palette.groups.filter(matches);
  const visibleCategories = palette.categories
    .map((c) => ({ ...c, items: c.items.filter((p) => matches(p.name || p.sku)) }))
    .filter((c) => c.items.length > 0);

  const orderedShelves = [...shelves].sort((a, b) => a.shelf - b.shelf);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h4 className="text-sm font-medium text-zinc-200">Configure slots</h4>
          <p className="text-xs text-zinc-500 mt-0.5">
            Drag products from the left into slots. Drag a filled slot onto another to move or swap it.
            On touch: tap a product, then tap a slot.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={cancel}
            className="px-3 py-2 rounded text-sm bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || saving}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              dirty ? 'bg-emerald-500 text-zinc-900 hover:bg-emerald-400' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{error}</div>
      )}
      {armed && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs rounded-lg px-4 py-2">
          Tap a slot to place “{targetLabel(armed)}” — tap the product again to cancel.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4 items-start">
        {/* Palette */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3 space-y-3 lg:max-h-[70vh] lg:overflow-y-auto">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          />

          {visibleGroups.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Fresh meal groups</div>
              <div className="space-y-1">
                {visibleGroups.map((g) => {
                  const target = { targetType: 'mealType', mealType: g };
                  const placed = placedCounts.get(`g:${g}`) || 0;
                  return (
                    <PaletteChip
                      key={g}
                      label={g}
                      sub={`${groupQty(g)} units · rotating flavours${placed ? ` · in ${placed} slot${placed > 1 ? 's' : ''}` : ''}`}
                      teal
                      placed={placed > 0}
                      active={sameTarget(armed, target)}
                      onDragStart={(e) => startPaletteDrag(e, target)}
                      onClick={() => setArmed((a) => (sameTarget(a, target) ? null : target))}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {visibleCategories.map((c) => (
            <div key={c.category}>
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">{c.category}</div>
              <div className="space-y-1">
                {c.items.map((p) => {
                  const target = { targetType: 'sku', sku: p.sku };
                  const placed = placedCounts.get(`s:${p.sku}`) || 0;
                  return (
                    <PaletteChip
                      key={p.sku}
                      label={p.name || p.sku}
                      sub={placed ? `in ${placed} slot${placed > 1 ? 's' : ''}` : null}
                      placed={placed > 0}
                      active={sameTarget(armed, target)}
                      onDragStart={(e) => startPaletteDrag(e, target)}
                      onClick={() => setArmed((a) => (sameTarget(a, target) ? null : target))}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {visibleGroups.length === 0 && visibleCategories.length === 0 && (
            <p className="text-zinc-600 text-sm">No matching products.</p>
          )}
        </div>

        {/* Fridge grid */}
        <div className="bg-zinc-900/50 border-2 border-zinc-700 rounded-xl p-3 space-y-2">
          {orderedShelves.map((s) => (
            <div key={s.shelf} className="flex items-stretch gap-2">
              <div className="w-5 flex items-center justify-center text-xs font-mono text-zinc-600">{s.shelf}</div>
              <div
                className="flex-1 grid gap-1.5 border-b-2 border-zinc-700 pb-2"
                style={{ gridTemplateColumns: `repeat(${s.slots}, minmax(0, 1fr))` }}
              >
                {Array.from({ length: s.slots }, (_, position) => {
                  const key = keyOf(s.shelf, position);
                  const target = slots[key];
                  const isOver = dragOver === key;
                  return (
                    <div
                      key={position}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                      onDragLeave={() => setDragOver((d) => (d === key ? null : d))}
                      onDrop={(e) => dropOnSlot(e, s.shelf, position)}
                      onClick={() => handleSlotClick(s.shelf, position)}
                      className={`relative min-h-[56px] rounded border px-1.5 py-1 text-[11px] leading-tight transition-colors select-none ${
                        isOver
                          ? 'border-emerald-400 bg-emerald-500/20'
                          : target
                            ? target.targetType === 'mealType'
                              ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                              : 'border-zinc-700 bg-zinc-800/70 text-zinc-200'
                            : `border-dashed border-zinc-700 text-zinc-600 ${armed ? 'cursor-pointer hover:border-emerald-500' : ''}`
                      }`}
                    >
                      <span className="block font-mono text-[9px] text-zinc-500">{slotCode(s.shelf, position)}</span>
                      {target ? (
                        <div
                          draggable
                          onDragStart={(e) => startSlotDrag(e, key)}
                          className="cursor-grab active:cursor-grabbing"
                          title={`${targetLabel(target)} — drag to move`}
                        >
                          <span className="block truncate pr-4">{targetLabel(target)}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); clear(s.shelf, position); }}
                            className="absolute top-0.5 right-1 text-zinc-500 hover:text-red-400 text-sm leading-none"
                            title="Clear slot"
                            aria-label={`Clear slot ${slotCode(s.shelf, position)}`}
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <span className="block text-center mt-2">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-zinc-600 pt-1">
            Shelf structure (number of shelves / facings) is managed in Admin → Machine Layout.
          </p>
        </div>
      </div>
    </div>
  );
}

function PaletteChip({ label, sub, teal, placed, active, onDragStart, onClick }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      className={`w-full text-left px-2.5 py-1.5 rounded border cursor-grab active:cursor-grabbing transition-colors ${
        active
          ? 'border-emerald-500 bg-emerald-500/15'
          : teal
            ? 'border-teal-500/40 bg-teal-500/10 hover:border-teal-400'
            : 'border-zinc-700 bg-zinc-800/70 hover:border-zinc-500'
      } ${placed ? 'opacity-60' : ''}`}
    >
      <span className={`block text-xs truncate ${teal ? 'text-teal-300' : 'text-zinc-200'}`}>{label}</span>
      {sub && <span className="block text-[10px] text-zinc-500 truncate">{sub}</span>}
    </div>
  );
}
