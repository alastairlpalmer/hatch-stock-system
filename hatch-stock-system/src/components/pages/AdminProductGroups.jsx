import React, { useEffect, useMemo, useState } from 'react';
import { useStock } from '../../context/StockContext';
import ProductSearchCombobox from '../ui/ProductSearchCombobox';
import { productParentsService } from '../../services/productParents.service';

/**
 * Admin → Product Groups.
 *
 * Manage stable flavour families ("Barebells", "Estate Dairy"): create a
 * group, then assign its flavour products. The group is a pure grouping row —
 * flavours stay ordinary products with their own SKU, barcode, stock and
 * sales. Fresh meals keep their own grouping (Admin → Fresh Meals) and are
 * rejected here server-side.
 *
 * Groups are held in local state (not StockContext) — this page is their only
 * consumer until reporting/ordering phases land.
 */
export default function AdminProductGroups() {
  const { data } = useStock();
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      setParents(await productParentsService.getAll());
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load product groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  // A flavour belongs to at most one group: products already assigned anywhere
  // are hidden from the picker (remove first to move one).
  const assignedSkus = useMemo(
    () => new Set(parents.flatMap((p) => (p.products || []).map((m) => m.sku))),
    [parents],
  );
  const pickerProducts = useMemo(
    () => (data.products || []).filter((p) => !p.isFreshMeal && !assignedSkus.has(p.sku)),
    [data.products, assignedSkus],
  );

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    run(async () => {
      await productParentsService.create({ name });
      setNewName('');
    });
  };

  const rename = (parent) => {
    const name = window.prompt('Rename product group', parent.name);
    if (!name || name.trim() === parent.name) return;
    run(() => productParentsService.update(parent.id, { name: name.trim() }));
  };

  const remove = (parent) => {
    if (!window.confirm(`Delete product group "${parent.name}"?`)) return;
    run(() => productParentsService.remove(parent.id));
  };

  const addMember = (parent, sku) => {
    if (!sku) return;
    run(() => productParentsService.addMembers(parent.id, [sku]));
  };

  const removeMember = (parent, sku) => {
    run(() => productParentsService.removeMember(parent.id, sku));
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-zinc-300">Product Groups</h3>
        <p className="text-xs text-zinc-500 mt-1">
          Group flavour variants under one product family (e.g. Barebells, Estate Dairy) for
          family-level reporting and ordering. Fresh meals are managed separately under Fresh Meals.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>
      )}

      <div className="flex gap-2 max-w-md">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="New group (e.g. Barebells)"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        />
        <button
          onClick={create}
          disabled={busy || !newName.trim()}
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {loading ? (
        <p className="text-zinc-600 text-sm">Loading product groups…</p>
      ) : parents.length === 0 ? (
        <p className="text-zinc-600 text-sm">
          No product groups yet. Create one above, then add its flavours.
        </p>
      ) : (
        <div className="space-y-4">
          {parents.map((parent) => (
            <GroupCard
              key={parent.id}
              parent={parent}
              pickerProducts={pickerProducts}
              busy={busy}
              onRename={() => rename(parent)}
              onDelete={() => remove(parent)}
              onAddMember={(sku) => addMember(parent, sku)}
              onRemoveMember={(sku) => removeMember(parent, sku)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({ parent, pickerProducts, busy, onRename, onDelete, onAddMember, onRemoveMember }) {
  const members = parent.products || [];

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate">{parent.name}</p>
          <p className="text-xs text-zinc-500">
            {members.length} flavour{members.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-3 flex-shrink-0">
          <button onClick={onRename} disabled={busy} className="text-zinc-500 hover:text-white text-xs">
            Rename
          </button>
          <button
            onClick={onDelete}
            disabled={busy}
            className="text-zinc-500 hover:text-red-400 text-xs"
            title={members.length > 0 ? 'Remove all flavours first' : 'Delete this group'}
          >
            Delete
          </button>
        </div>
      </div>

      {members.length > 0 && (
        <div className="divide-y divide-zinc-800/60 border border-zinc-800/60 rounded-lg">
          {members.map((m) => (
            <div key={m.sku} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{m.name}</p>
                <p className="text-xs text-zinc-500 font-mono">
                  {m.sku}
                  {m.category ? ` · ${m.category}` : ''}
                </p>
              </div>
              <button
                onClick={() => onRemoveMember(m.sku)}
                disabled={busy}
                className="text-zinc-500 hover:text-red-400 text-xs flex-shrink-0"
                title="Remove from group"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="max-w-md">
        <ProductSearchCombobox
          products={pickerProducts}
          value=""
          onSelect={(sku) => onAddMember(sku)}
          placeholder={`Add a flavour to ${parent.name}…`}
        />
      </div>
    </div>
  );
}
