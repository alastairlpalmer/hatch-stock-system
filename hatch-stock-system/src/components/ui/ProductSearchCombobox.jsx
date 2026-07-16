import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Shared product picker: a search-as-you-type combobox that replaces the
// full-catalogue native <select> in the order / buying-list / restock forms.
// Client-side tokenized match (every typed word must appear in name, SKU or
// category), capped result list, 44px touch rows, optional per-form recents
// stored in localStorage so the weekly buy starts from familiar products.

const MAX_RESULTS = 40;
const MAX_RECENTS = 8;

function readRecents(key) {
  if (!key) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function pushRecent(key, sku) {
  if (!key || !sku) return;
  const next = [sku, ...readRecents(key).filter(s => s !== sku)].slice(0, MAX_RECENTS);
  try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* quota/private mode */ }
}

export default function ProductSearchCombobox({
  products = [],
  value = '',
  onSelect,
  placeholder = 'Search products…',
  recentsKey,
  className = '',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const bySku = useMemo(() => new Map(products.map(p => [p.sku, p])), [products]);
  const selected = value ? bySku.get(value) : null;

  // Keep the input text in sync when the selected value changes from outside
  // (edit forms seeding a SKU, parent clearing after add).
  useEffect(() => {
    if (!open) setQuery(selected ? selected.name : '');
  }, [value, selected, open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const recents = readRecents(recentsKey)
        .map(sku => bySku.get(sku))
        .filter(Boolean);
      const rest = products.filter(p => !recents.includes(p));
      return { recents, items: rest.slice(0, MAX_RESULTS) };
    }
    const tokens = q.split(/\s+/).filter(Boolean);
    const items = products.filter(p => {
      const hay = `${p.name || ''} ${p.sku || ''} ${p.category || ''}`.toLowerCase();
      return tokens.every(t => hay.includes(t));
    });
    return { recents: [], items: items.slice(0, MAX_RESULTS) };
  }, [query, products, bySku, recentsKey]);

  const flat = [...results.recents, ...results.items];

  useEffect(() => { setHighlight(0); }, [query, open]);

  // Keep the highlighted row visible while arrowing through the list.
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pick = (product) => {
    pushRecent(recentsKey, product.sku);
    setQuery(product.name);
    setOpen(false);
    onSelect?.(product.sku, product);
  };

  const clear = () => {
    setQuery('');
    onSelect?.('', null);
    setOpen(true);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[highlight]) pick(flat[highlight]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(selected ? selected.name : '');
    }
  };

  const renderRow = (p, idx, badge) => (
    <button
      key={p.sku}
      type="button"
      data-idx={idx}
      // preventDefault keeps focus on the input so onBlur doesn't fire
      // before the click lands.
      onMouseDown={e => e.preventDefault()}
      onClick={() => pick(p)}
      className={`w-full flex items-center justify-between gap-3 px-3 min-h-[44px] text-left text-sm ${
        idx === highlight ? 'bg-zinc-700/70' : 'hover:bg-zinc-700/40'
      }`}
    >
      <span className="text-zinc-200 truncate">{p.name}</span>
      <span className="shrink-0 text-xs text-zinc-500">
        {badge && <span className="mr-2 text-[10px] uppercase tracking-wide text-emerald-500">{badge}</span>}
        {p.sku}
      </span>
    </button>
  );

  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setOpen(false); setQuery(selected ? selected.name : ''); }}
        onKeyDown={onKeyDown}
        className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-8 py-2 text-sm focus:outline-none focus:border-emerald-500"
      />
      {(query || value) && (
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={clear}
          aria-label="Clear product"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-300"
        >
          <X size={14} />
        </button>
      )}
      {open && flat.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-40 mt-1 left-0 right-0 max-h-72 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl divide-y divide-zinc-700/50"
        >
          {results.recents.map((p, i) => renderRow(p, i, 'recent'))}
          {results.items.map((p, i) => renderRow(p, results.recents.length + i))}
        </div>
      )}
      {open && flat.length === 0 && query.trim() && (
        <div className="absolute z-40 mt-1 left-0 right-0 rounded-lg border border-zinc-700 bg-zinc-800 shadow-xl px-3 py-3 text-sm text-zinc-500">
          No products match “{query.trim()}”
        </div>
      )}
    </div>
  );
}
