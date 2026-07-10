import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStock } from '../../context/StockContext';
import planogramService from '../../services/planogram.service';
import { positionLetter, slotCode } from '../../utils/planogramGeometry';

/**
 * Admin → Machine Layout.
 *
 * Defines each location's fridge layout (shelves × facings) and assigns
 * products (or fresh-meal groups) into slots. Slot assignments are the source
 * of truth for what is IN the machine this week — the location's mirrored
 * product list is only the picker vocabulary, since the in-machine range
 * rotates weekly. All edits are a local draft until Save; the server writes
 * position history automatically on save.
 */

const DEFAULT_SHELVES = 8;
const DEFAULT_FACINGS = 6;

const emptyDraft = () => ({ shelves: [], slots: {} });

// Draft slot map key
const slotKey = (shelf, position) => `${shelf}-${position}`;

export default function AdminMachineLayout() {
  const { data } = useStock();
  const [selectedLocation, setSelectedLocation] = useState('');
  const [payload, setPayload] = useState(null); // last server payload
  const [draft, setDraft] = useState(emptyDraft());
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [picker, setPicker] = useState(null); // { shelf, position } of open picker
  const [armed, setArmed] = useState(null); // target armed from the not-placed panel

  const locations = [...(data.locations || [])].sort((a, b) => a.name.localeCompare(b.name));
  const location = locations.find((l) => l.id === selectedLocation);

  useEffect(() => {
    if (!selectedLocation && locations.length > 0) setSelectedLocation(locations[0].id);
  }, [locations, selectedLocation]);

  // Load the saved layout when the location changes
  useEffect(() => {
    if (!selectedLocation) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPicker(null);
    setArmed(null);
    planogramService
      .getLocationPlanogram(selectedLocation)
      .then((p) => {
        if (cancelled) return;
        setPayload(p);
        setDraft(draftFromPayload(p));
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || err.message || 'Failed to load layout');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [selectedLocation]);

  const changeLocation = (id) => {
    if (dirty && !window.confirm('Discard unsaved layout changes?')) return;
    setSelectedLocation(id);
  };

  // ---- draft mutations ----

  const mutate = (fn) => {
    setDraft((d) => fn(structuredClone(d)));
    setDirty(true);
    setSavedAt(null);
  };

  const useDefaultTemplate = () => mutate((d) => {
    d.shelves = Array.from({ length: DEFAULT_SHELVES }, (_, i) => ({ shelf: i + 1, slots: DEFAULT_FACINGS }));
    d.slots = {};
    return d;
  });

  const addShelf = () => mutate((d) => {
    const next = d.shelves.length > 0 ? Math.max(...d.shelves.map((s) => s.shelf)) + 1 : 1;
    d.shelves.push({ shelf: next, slots: DEFAULT_FACINGS });
    return d;
  });

  const removeShelf = (shelf) => {
    const affected = Object.keys(draft.slots).filter((k) => k.startsWith(`${shelf}-`)).length;
    if (affected > 0 && !window.confirm(`Removing shelf ${shelf} clears ${affected} assigned slot(s). Continue?`)) return;
    mutate((d) => {
      d.shelves = d.shelves.filter((s) => s.shelf !== shelf);
      for (const k of Object.keys(d.slots)) if (k.startsWith(`${shelf}-`)) delete d.slots[k];
      return d;
    });
  };

  const clearShelf = (shelf) => mutate((d) => {
    for (const k of Object.keys(d.slots)) if (k.startsWith(`${shelf}-`)) delete d.slots[k];
    return d;
  });

  const setFacings = (shelf, slots) => {
    const n = Math.max(1, Math.min(26, parseInt(slots) || 1));
    const clipped = Object.keys(draft.slots).filter((k) => {
      const [s, p] = k.split('-').map(Number);
      return s === shelf && p >= n;
    }).length;
    if (clipped > 0 && !window.confirm(`Shrinking shelf ${shelf} to ${n} facings clears ${clipped} assigned slot(s). Continue?`)) return;
    mutate((d) => {
      d.shelves = d.shelves.map((s) => (s.shelf === shelf ? { ...s, slots: n } : s));
      for (const k of Object.keys(d.slots)) {
        const [s, p] = k.split('-').map(Number);
        if (s === shelf && p >= n) delete d.slots[k];
      }
      return d;
    });
  };

  const setSlot = (shelf, position, target) => mutate((d) => {
    if (target) d.slots[slotKey(shelf, position)] = target;
    else delete d.slots[slotKey(shelf, position)];
    return d;
  });

  const handleSlotClick = (shelf, position) => {
    if (armed) {
      setSlot(shelf, position, armed);
      setArmed(null);
      return;
    }
    setPicker((p) => (p && p.shelf === shelf && p.position === position ? null : { shelf, position }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        shelves: draft.shelves,
        assignments: Object.entries(draft.slots).map(([key, target]) => {
          const [shelf, position] = key.split('-').map(Number);
          return { shelf, position, ...target };
        }),
      };
      const fresh = await planogramService.saveLocationPlanogram(selectedLocation, body);
      setPayload(fresh);
      setDraft(draftFromPayload(fresh));
      setDirty(false);
      setSavedAt(new Date());
    } catch (err) {
      const details = err.response?.data?.details;
      setError(details ? details.join('; ') : err.response?.data?.error || err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ---- derived render data ----

  const productBySku = useMemo(() => new Map((data.products || []).map((p) => [p.sku, p])), [data.products]);

  // Picker vocabulary: this location's mirrored products. Fresh meals collapse
  // into meal-type groups; regular products grouped by category.
  const pickerData = useMemo(() => {
    const assigned = new Set(location?.assignedItems || []);
    const products = (data.products || []).filter((p) => assigned.has(p.sku));
    const groups = new Set();
    const byCategory = {};
    for (const p of products) {
      if (p.isFreshMeal) {
        groups.add(p.mealType || 'Unclassified');
      } else {
        const cat = p.category || 'Uncategorised';
        (byCategory[cat] = byCategory[cat] || []).push(p);
      }
    }
    const order = (data.mealTypes || []).map((m) => m.name);
    const mealGroups = [...groups].sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    });
    const categories = Object.entries(byCategory)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({ category, items: items.sort((x, y) => (x.name || x.sku).localeCompare(y.name || y.sku)) }));
    return { mealGroups, categories, assignedSet: assigned };
  }, [location, data.products, data.mealTypes]);

  // Stale in the DRAFT: sku target no longer in the location's mirrored list
  const isStaleTarget = (target) => {
    if (!target) return false;
    if (target.targetType === 'sku') return !pickerData.assignedSet.has(target.sku);
    return !pickerData.mealGroups.includes(target.mealType);
  };

  const targetLabel = (target) => {
    if (!target) return null;
    if (target.targetType === 'mealType') return target.mealType;
    return productBySku.get(target.sku)?.name || target.sku;
  };

  // Not-placed: location products/groups without a draft slot
  const notPlaced = useMemo(() => {
    const placedSkus = new Set();
    const placedGroups = new Set();
    for (const t of Object.values(draft.slots)) {
      if (t.targetType === 'sku') placedSkus.add(t.sku);
      else placedGroups.add(t.mealType);
    }
    return {
      mealGroups: pickerData.mealGroups.filter((g) => !placedGroups.has(g)),
      products: pickerData.categories.flatMap((c) => c.items).filter((p) => !placedSkus.has(p.sku)),
    };
  }, [draft.slots, pickerData]);

  const shelves = [...draft.shelves].sort((a, b) => a.shelf - b.shelf);
  const staleCount = Object.values(draft.slots).filter(isStaleTarget).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-medium">Machine Layout</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Define the fridge's shelves and assign products to slots — slot assignments declare what is in the machine this week.
            Each location's layout is saved independently.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedLocation}
            onChange={(e) => changeLocation(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <button
            onClick={save}
            disabled={!dirty || saving || shelves.length === 0}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              dirty && shelves.length > 0
                ? 'bg-emerald-500 text-zinc-900 hover:bg-emerald-400'
                : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving…' : dirty ? 'Save layout' : savedAt ? 'Saved ✓' : 'Saved'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{error}</div>
      )}
      {staleCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm rounded-lg px-4 py-3">
          {staleCount} slot(s) reference products no longer stocked at this location — reassign or clear them.
        </div>
      )}

      {loading ? (
        <div className="text-zinc-500 text-sm py-12 text-center">Loading layout…</div>
      ) : shelves.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center space-y-4">
          <p className="text-zinc-400 text-sm">No fridge layout configured for {location?.name || 'this location'} yet.</p>
          <button
            onClick={useDefaultTemplate}
            className="px-4 py-2 rounded text-sm font-medium bg-emerald-500 text-zinc-900 hover:bg-emerald-400"
          >
            Use default template ({DEFAULT_SHELVES} shelves × {DEFAULT_FACINGS} facings)
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
          <div className="space-y-3">
            {shelves.map((s) => (
              <ShelfRow
                key={s.shelf}
                shelf={s}
                slots={draft.slots}
                picker={picker}
                armed={armed}
                onSlotClick={handleSlotClick}
                onPick={(shelf, position, target) => { setSlot(shelf, position, target); setPicker(null); }}
                onClosePicker={() => setPicker(null)}
                onFacings={setFacings}
                onClearShelf={clearShelf}
                onRemoveShelf={removeShelf}
                pickerData={pickerData}
                targetLabel={targetLabel}
                isStaleTarget={isStaleTarget}
              />
            ))}
            <button
              onClick={addShelf}
              className="w-full border border-dashed border-zinc-700 rounded-lg py-2 text-sm text-zinc-500 hover:text-zinc-300 hover:border-zinc-500"
            >
              + Add shelf
            </button>
          </div>

          <NotPlacedPanel
            notPlaced={notPlaced}
            armed={armed}
            onArm={(target) => { setArmed((a) => (sameTarget(a, target) ? null : target)); setPicker(null); }}
          />
        </div>
      )}
    </div>
  );
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  return a.targetType === b.targetType && a.sku === b.sku && a.mealType === b.mealType;
}

function draftFromPayload(p) {
  if (!p?.layout) return emptyDraft();
  const slots = {};
  for (const a of p.assignments || []) {
    slots[slotKey(a.shelf, a.position)] = {
      targetType: a.targetType,
      sku: a.sku || undefined,
      mealType: a.mealType || undefined,
    };
  }
  return { shelves: p.layout.shelves || [], slots };
}

function ShelfRow({
  shelf, slots, picker, armed, onSlotClick, onPick, onClosePicker,
  onFacings, onClearShelf, onRemoveShelf, pickerData, targetLabel, isStaleTarget,
}) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-zinc-300 font-medium">
          Shelf {shelf.shelf}{shelf.shelf === 1 ? ' (top)' : ''}
        </span>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-zinc-500">Facings</label>
          <input
            type="number"
            min={1}
            max={26}
            value={shelf.slots}
            onChange={(e) => onFacings(shelf.shelf, e.target.value)}
            className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-center focus:outline-none focus:border-emerald-500"
          />
          <button onClick={() => onClearShelf(shelf.shelf)} className="text-zinc-500 hover:text-zinc-300 px-1">clear</button>
          <button onClick={() => onRemoveShelf(shelf.shelf)} className="text-red-400/70 hover:text-red-400 px-1">remove</button>
        </div>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${shelf.slots}, minmax(0, 1fr))` }}>
        {Array.from({ length: shelf.slots }, (_, position) => {
          const target = slots[slotKey(shelf.shelf, position)];
          const isOpen = picker && picker.shelf === shelf.shelf && picker.position === position;
          const stale = isStaleTarget(target);
          return (
            <div key={position} className="relative">
              <button
                onClick={() => onSlotClick(shelf.shelf, position)}
                title={target ? targetLabel(target) : 'Empty slot'}
                className={`w-full min-h-[52px] rounded border px-1 py-1 text-[11px] leading-tight transition-colors ${
                  isOpen
                    ? 'border-emerald-500 bg-emerald-500/10'
                    : stale
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : target
                        ? target.targetType === 'mealType'
                          ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                          : 'border-zinc-700 bg-zinc-800/70 text-zinc-200'
                        : `border-dashed border-zinc-700 text-zinc-600 ${armed ? 'hover:border-emerald-500 hover:text-emerald-400' : 'hover:border-zinc-500'}`
                }`}
              >
                <span className="block font-mono text-[9px] text-zinc-500">{slotCode(shelf.shelf, position)}</span>
                <span className="block truncate">{target ? targetLabel(target) : '—'}</span>
              </button>
              {isOpen && (
                <SlotPicker
                  pickerData={pickerData}
                  onPick={(target) => onPick(shelf.shelf, position, target)}
                  onClear={() => onPick(shelf.shelf, position, null)}
                  onClose={onClosePicker}
                  hasTarget={!!target}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotPicker({ pickerData, onPick, onClear, onClose, hasTarget }) {
  const [search, setSearch] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);

  const q = search.trim().toLowerCase();
  const matches = (name) => !q || name.toLowerCase().includes(q);
  const groups = pickerData.mealGroups.filter(matches);
  const categories = pickerData.categories
    .map((c) => ({ ...c, items: c.items.filter((p) => matches(p.name || p.sku)) }))
    .filter((c) => c.items.length > 0);

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute z-20 top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 space-y-2">
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="Search products…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
        />
        {groups.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 px-1 mb-1">Fresh meal groups</div>
            {groups.map((g) => (
              <button
                key={g}
                onClick={() => onPick({ targetType: 'mealType', mealType: g })}
                className="w-full text-left px-2 py-1.5 rounded text-sm text-teal-300 hover:bg-zinc-800"
              >
                {g} <span className="text-zinc-600 text-xs">(rotating flavours)</span>
              </button>
            ))}
          </div>
        )}
        {categories.map((c) => (
          <div key={c.category}>
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 px-1 mb-1">{c.category}</div>
            {c.items.map((p) => (
              <button
                key={p.sku}
                onClick={() => onPick({ targetType: 'sku', sku: p.sku })}
                className="w-full text-left px-2 py-1.5 rounded text-sm text-zinc-200 hover:bg-zinc-800 truncate"
              >
                {p.name || p.sku}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && categories.length === 0 && (
          <div className="text-zinc-600 text-sm px-1 py-2">No matches.</div>
        )}
        {hasTarget && (
          <button
            onClick={onClear}
            className="w-full text-left px-2 py-1.5 rounded text-sm text-red-400 hover:bg-zinc-800 border-t border-zinc-800"
          >
            Clear slot
          </button>
        )}
      </div>
    </>
  );
}

function NotPlacedPanel({ notPlaced, armed, onArm }) {
  const empty = notPlaced.mealGroups.length === 0 && notPlaced.products.length === 0;
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
      <div>
        <h4 className="text-sm font-medium text-zinc-300">Not placed</h4>
        <p className="text-xs text-zinc-500 mt-1">
          Products stocked at this location without a slot. Click one, then click a slot to place it.
        </p>
      </div>
      {empty ? (
        <p className="text-xs text-emerald-400">Everything has a slot ✓</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {notPlaced.mealGroups.map((g) => {
            const target = { targetType: 'mealType', mealType: g };
            return (
              <Chip key={`g-${g}`} active={sameTarget(armed, target)} teal onClick={() => onArm(target)}>{g}</Chip>
            );
          })}
          {notPlaced.products.map((p) => {
            const target = { targetType: 'sku', sku: p.sku };
            return (
              <Chip key={p.sku} active={sameTarget(armed, target)} onClick={() => onArm(target)}>{p.name || p.sku}</Chip>
            );
          })}
        </div>
      )}
      {armed && <p className="text-xs text-emerald-400">Now click a slot to place “{armed.mealType || armed.sku}”. Click the chip again to cancel.</p>}
    </div>
  );
}

function Chip({ children, active, teal, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded text-xs border transition-colors max-w-full truncate ${
        active
          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
          : teal
            ? 'border-teal-500/40 bg-teal-500/10 text-teal-300 hover:border-teal-400'
            : 'border-zinc-700 bg-zinc-800/70 text-zinc-300 hover:border-zinc-500'
      }`}
    >
      {children}
    </button>
  );
}
