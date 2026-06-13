import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';

/**
 * Admin → Fresh Meals.
 *
 * (A) Manage the configurable meal-type buckets (e.g. Meat, Veg/Vegan).
 * (B) Review queue: confirm/override the auto-guessed classification of Frive
 *     fresh-meal flavours (this is where VendLive-auto-created products surface).
 *
 * Classification lives on the product (isFreshMeal / mealType / mealTypeConfirmed);
 * the review queue is derived from data.products so it stays in sync as products
 * are confirmed.
 */
export default function AdminFreshMeals() {
  const { data, addMealType, updateMealType, deleteMealType, updateProductMeal } = useStock();
  const mealTypes = [...(data.mealTypes || [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const mealTypeNames = mealTypes.map(m => m.name);

  const freshMeals = data.products.filter(p => p.isFreshMeal);
  const unconfirmed = freshMeals.filter(p => !p.mealTypeConfirmed);
  const confirmed = freshMeals.filter(p => p.mealTypeConfirmed);

  return (
    <div className="space-y-8">
      <BucketManager
        mealTypes={mealTypes}
        addMealType={addMealType}
        updateMealType={updateMealType}
        deleteMealType={deleteMealType}
      />
      <PromoteMissed
        products={data.products}
        updateProductMeal={updateProductMeal}
      />
      <ReviewQueue
        title={`Needs Review (${unconfirmed.length})`}
        products={unconfirmed}
        mealTypeNames={mealTypeNames}
        updateProductMeal={updateProductMeal}
        emptyMessage="No fresh meals awaiting review. New Frive flavours appear here automatically when synced from VendLive or imported."
        reviewing
      />
      <ReviewQueue
        title={`Confirmed Fresh Meals (${confirmed.length})`}
        products={confirmed}
        mealTypeNames={mealTypeNames}
        updateProductMeal={updateProductMeal}
        emptyMessage="No confirmed fresh meals yet."
      />
    </div>
  );
}

function BucketManager({ mealTypes, addMealType, updateMealType, deleteMealType }) {
  const [newName, setNewName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      await addMealType({ name: newName.trim(), sortOrder: mealTypes.length });
      setNewName('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to add meal type');
    } finally {
      setBusy(false);
    }
  };

  const rename = async (mt) => {
    const name = window.prompt('Rename meal type', mt.name);
    if (!name || name.trim() === mt.name) return;
    setError(null);
    try {
      await updateMealType(mt.id, { name: name.trim() });
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to rename');
    }
  };

  const remove = async (mt) => {
    if (!window.confirm(`Delete meal type "${mt.name}"?`)) return;
    setError(null);
    try {
      await deleteMealType(mt.id);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-zinc-300">Meal Type Buckets</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Frive fresh meals are grouped by these buckets on the Location Stock page and in reporting.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex flex-wrap gap-2">
        {mealTypes.length === 0 ? (
          <span className="text-zinc-600 text-sm">No meal types yet.</span>
        ) : (
          mealTypes.map(mt => (
            <span key={mt.id} className="inline-flex items-center gap-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200">
              {mt.name}
              <button onClick={() => rename(mt)} className="text-zinc-500 hover:text-white text-xs">edit</button>
              <button onClick={() => remove(mt)} className="text-zinc-500 hover:text-red-400 text-xs">×</button>
            </span>
          ))
        )}
      </div>

      <div className="flex gap-2 max-w-md">
        <input
          type="text"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New meal type (e.g. Veg/Vegan)"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        />
        <button onClick={add} disabled={busy || !newName.trim()} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
          Add
        </button>
      </div>
    </div>
  );
}

function PromoteMissed({ products, updateProductMeal }) {
  const [query, setQuery] = useState('');
  const [busySku, setBusySku] = useState(null);

  const q = query.trim().toLowerCase();
  // Only products NOT already flagged as fresh meals — flagging one moves it into
  // the Needs Review queue below (unconfirmed) so it still passes through review.
  const matches = q
    ? products
        .filter(p => !p.isFreshMeal)
        .filter(p => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  const flag = async (sku) => {
    setBusySku(sku);
    try {
      await updateProductMeal(sku, { isFreshMeal: true, mealTypeConfirmed: false });
      setQuery('');
    } finally {
      setBusySku(null);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-zinc-300">Flag a Missed Meal</h3>
        <p className="text-xs text-zinc-500 mt-1">
          If the system didn't recognise a Frive meal, find it here and flag it — it then drops into Needs Review below to pick a bucket.
        </p>
      </div>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search products by name or SKU…"
        className="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
      />
      {q && (
        matches.length === 0 ? (
          <p className="text-zinc-600 text-sm">No unflagged products match “{query}”.</p>
        ) : (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg divide-y divide-zinc-800/60 max-w-2xl">
            {matches.map(p => (
              <div key={p.sku} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{p.name}</p>
                  <p className="text-xs text-zinc-500 font-mono">{p.sku}{p.category ? ` · ${p.category}` : ''}</p>
                </div>
                <button
                  onClick={() => flag(p.sku)}
                  disabled={busySku === p.sku}
                  className="px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-500 disabled:opacity-50 whitespace-nowrap"
                >
                  Flag as meal
                </button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ReviewQueue({ title, products, mealTypeNames, updateProductMeal, emptyMessage, reviewing = false }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
      {products.length === 0 ? (
        <p className="text-zinc-600 text-sm">{emptyMessage}</p>
      ) : (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Meal Type</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <FreshMealRow
                  key={p.sku}
                  product={p}
                  mealTypeNames={mealTypeNames}
                  updateProductMeal={updateProductMeal}
                  reviewing={reviewing}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FreshMealRow({ product, mealTypeNames, updateProductMeal, reviewing }) {
  const [mealType, setMealType] = useState(product.mealType || '');
  const [busy, setBusy] = useState(false);

  const run = async (body) => {
    setBusy(true);
    try {
      await updateProductMeal(product.sku, body);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => run({ mealType: mealType || null, mealTypeConfirmed: true });
  const save = () => run({ mealType: mealType || null });
  const removeFlag = () => run({ isFreshMeal: false, mealTypeConfirmed: true });

  return (
    <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
      <td className="px-4 py-3 text-zinc-200">{product.name}</td>
      <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{product.sku}</td>
      <td className="px-4 py-3">
        <select
          value={mealType}
          onChange={e => setMealType(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm focus:outline-none focus:border-emerald-500"
        >
          <option value="">Unclassified</option>
          {mealTypeNames.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
          {/* Preserve a legacy value that is no longer in the bucket list */}
          {product.mealType && !mealTypeNames.includes(product.mealType) && (
            <option value={product.mealType}>{product.mealType} (removed)</option>
          )}
        </select>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {reviewing ? (
          <button onClick={confirm} disabled={busy} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 mr-2">
            Confirm
          </button>
        ) : (
          <button onClick={save} disabled={busy || mealType === (product.mealType || '')} className="px-3 py-1.5 bg-zinc-700 text-white rounded text-xs hover:bg-zinc-600 disabled:opacity-50 mr-2">
            Save
          </button>
        )}
        <button onClick={removeFlag} disabled={busy} className="text-zinc-500 hover:text-red-400 text-xs" title="Not a fresh meal">
          Not a meal
        </button>
      </td>
    </tr>
  );
}
