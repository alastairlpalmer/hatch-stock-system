import React, { useState, useMemo } from 'react';
import { useStock } from '../../../context/StockContext';

/**
 * Orders → Suppliers: supplier setup and ordering config in the place where
 * ordering actually happens (moved out of Admin so whoever runs the weekly
 * buy can maintain it — part of making ordering handover-able).
 *
 * - Supplier CRUD with ordering config (order days, lead time, minimum order)
 *   — drives order-day reminders, min-order warnings and PO delivery dates.
 * - Per-supplier product list with INLINE cost price and units-per-box
 *   editing, missing values highlighted amber.
 * - Gaps panel: products with no supplier / no cost price — the things that
 *   silently break order generation — with quick-assign controls.
 */

export const SUPPLIER_WEEKDAYS = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

export function supplierConfigSummary(s) {
  const parts = [];
  if (Array.isArray(s.orderDays) && s.orderDays.length) {
    parts.push(s.orderDays.map(d => SUPPLIER_WEEKDAYS.find(w => w.key === d)?.label || d).join(' '));
  }
  if (s.leadTimeDays != null) parts.push(`${s.leadTimeDays}d lead`);
  if (s.minOrderValue != null) parts.push(`£${s.minOrderValue} min`);
  return parts.join(' · ');
}

const emptyForm = { name: '', contact: '', email: '', phone: '', orderDays: [], leadTimeDays: '', minOrderValue: '' };

export default function SuppliersConfig() {
  const { data, addSupplier, updateSupplier, deleteSupplier, updateProduct } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const suppliers = [...(data.suppliers || [])].sort((a, b) => a.name.localeCompare(b.name));
  const products = data.products || [];

  // Ordering-config gaps: what silently breaks order generation.
  const gaps = useMemo(() => {
    // Placeholder ordering products (FRIVE-*) are auto-managed — not gaps.
    const real = products.filter(p => p.category !== 'Fresh Meal Order');
    return {
      noSupplier: real.filter(p => !p.preferredSupplierId),
      noCost: real.filter(p => p.preferredSupplierId && (p.unitCost == null || p.unitCost === 0)),
    };
  }, [products]);

  const productsFor = (supplierId) =>
    products
      .filter(p => p.preferredSupplierId === supplierId)
      .sort((a, b) => (a.name || a.sku).localeCompare(b.name || b.sku));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editSupplierItem = (sup) => {
    setForm({
      name: sup.name,
      contact: sup.contact || '',
      email: sup.email || '',
      phone: sup.phone || '',
      orderDays: Array.isArray(sup.orderDays) ? sup.orderDays : [],
      leadTimeDays: sup.leadTimeDays != null ? String(sup.leadTimeDays) : '',
      minOrderValue: sup.minOrderValue != null ? String(sup.minOrderValue) : '',
    });
    setEditingId(sup.id);
    setShowForm(true);
  };

  const toggleOrderDay = (day) => {
    setForm(f => ({
      ...f,
      orderDays: f.orderDays.includes(day) ? f.orderDays.filter(d => d !== day) : [...f.orderDays, day],
    }));
  };

  const submit = async () => {
    if (!form.name) return;
    setLoading(true);
    setError(null);
    try {
      const supplier = {
        name: form.name.trim(),
        contact: form.contact.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        // Empty selection / blank inputs mean "no restriction" → null.
        orderDays: form.orderDays.length ? form.orderDays : null,
        leadTimeDays: form.leadTimeDays !== '' ? parseInt(form.leadTimeDays, 10) : null,
        minOrderValue: form.minOrderValue !== '' ? parseFloat(form.minOrderValue) : null,
      };
      if (editingId) await updateSupplier(editingId, supplier);
      else await addSupplier(supplier);
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save supplier');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setConfirmDeleteId(null);
    setLoading(true);
    try {
      await deleteSupplier(id);
    } catch (err) {
      setError(err.message || 'Failed to delete supplier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Suppliers</h2>
          <p className="text-zinc-500 text-sm mt-1">
            Supplier details, ordering rules, cost prices and box sizes — everything the weekly buy depends on.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(!showForm); }}
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
        >
          {showForm ? 'Cancel' : '+ Add Supplier'}
        </button>
      </div>

      {(gaps.noSupplier.length > 0 || gaps.noCost.length > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 text-sm text-amber-400 flex items-center gap-4 flex-wrap">
          <span className="font-medium">Config gaps:</span>
          {gaps.noSupplier.length > 0 && <span>{gaps.noSupplier.length} product{gaps.noSupplier.length === 1 ? '' : 's'} with no supplier</span>}
          {gaps.noCost.length > 0 && <span>{gaps.noCost.length} with no cost price</span>}
          <span className="text-amber-500/70">— fix below so orders and margins calculate correctly</span>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Company Name *">
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="Contact Name">
              <input type="text" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </Field>
            <Field label="Phone">
              <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </Field>
          </div>
          <div className="border-t border-zinc-800 pt-4 space-y-4">
            <p className="text-xs text-zinc-500">Ordering config — drives order-day reminders, minimum-order warnings and PO delivery dates on buying lists.</p>
            <div>
              <label className="block text-xs text-zinc-500 mb-2">Order days (none selected = any day)</label>
              <div className="flex flex-wrap gap-2">
                {SUPPLIER_WEEKDAYS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleOrderDay(key)}
                    className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      form.orderDays.includes(key) ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Lead time (days from order to delivery)">
                <input type="number" min="0" max="30" value={form.leadTimeDays} onChange={e => setForm({ ...form, leadTimeDays: e.target.value })} placeholder="—" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
              </Field>
              <Field label="Minimum order (£)">
                <input type="number" min="0" step="0.01" value={form.minOrderValue} onChange={e => setForm({ ...form, minOrderValue: e.target.value })} placeholder="—" className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
              </Field>
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Supplier
          </button>
        </div>
      )}

      {/* Supplier cards with expandable product config */}
      <div className="space-y-3">
        {suppliers.length === 0 && (
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center text-zinc-600 text-sm">
            No suppliers yet — add your first above.
          </div>
        )}
        {suppliers.map(s => {
          const supplierProducts = productsFor(s.id);
          const missingCost = supplierProducts.filter(p => p.unitCost == null || p.unitCost === 0).length;
          const expanded = expandedId === s.id;
          return (
            <div key={s.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={() => setExpandedId(expanded ? null : s.id)}
                  className="flex items-center gap-3 text-left min-w-0 flex-1"
                >
                  <span className="text-zinc-500 text-xs w-3">{expanded ? '▾' : '▸'}</span>
                  <span className="min-w-0">
                    <span className="block text-sm text-zinc-100 font-medium truncate">{s.name}</span>
                    <span className="block text-xs text-zinc-500 truncate">
                      {[s.contact, s.email, s.phone].filter(Boolean).join(' · ') || 'No contact details'}
                    </span>
                  </span>
                </button>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-zinc-400">{supplierConfigSummary(s) || <span className="text-amber-400">no ordering config</span>}</span>
                  <span className="text-zinc-500">
                    {supplierProducts.length} product{supplierProducts.length === 1 ? '' : 's'}
                    {missingCost > 0 && <span className="text-amber-400"> · {missingCost} no cost</span>}
                  </span>
                  {confirmDeleteId === s.id ? (
                    <>
                      <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-300 font-medium">Confirm delete?</button>
                      <button onClick={() => setConfirmDeleteId(null)} className="text-zinc-500 hover:text-white">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => editSupplierItem(s)} className="text-zinc-400 hover:text-white">Edit</button>
                      <button onClick={() => setConfirmDeleteId(s.id)} className="text-zinc-500 hover:text-red-400">Delete</button>
                    </>
                  )}
                </div>
              </div>

              {expanded && (
                <SupplierProductTable products={supplierProducts} updateProduct={updateProduct} />
              )}
            </div>
          );
        })}
      </div>

      {/* Products with no supplier — quick assign */}
      {gaps.noSupplier.length > 0 && (
        <div className="bg-zinc-900/50 border border-amber-500/30 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-amber-500/10">
            <h3 className="text-sm font-medium text-amber-400">No preferred supplier ({gaps.noSupplier.length})</h3>
            <p className="text-xs text-zinc-500 mt-0.5">These can't be grouped onto a purchase order — pick a supplier for each.</p>
          </div>
          <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
            {gaps.noSupplier.map(p => (
              <div key={p.sku} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{p.name || p.sku}</p>
                  <p className="text-xs text-zinc-500 font-mono">{p.sku}{p.category ? ` · ${p.category}` : ''}</p>
                </div>
                <select
                  defaultValue=""
                  onChange={e => e.target.value && updateProduct(p.sku, { preferredSupplierId: e.target.value })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500 shrink-0"
                >
                  <option value="">Assign supplier…</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

// Per-supplier product config: inline cost + units-per-box editing. Values
// save on blur (or Enter) so a fast top-to-bottom fill session is one
// keystroke-tab-keystroke flow. VendLive price sync can overwrite unitCost on
// later sales — this is still the right place to fill the blanks it misses.
function SupplierProductTable({ products, updateProduct }) {
  if (products.length === 0) {
    return <p className="px-4 py-4 text-sm text-zinc-600 border-t border-zinc-800">No products assigned to this supplier yet — assign them from the gaps panel below or in Admin → Products.</p>;
  }
  return (
    <div className="border-t border-zinc-800 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800/60">
            <th className="text-left px-4 py-2 text-zinc-500 font-medium text-xs">Product</th>
            <th className="text-left px-4 py-2 text-zinc-500 font-medium text-xs">SKU</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-medium text-xs">Cost price (£)</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-medium text-xs">Units / box</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <ProductConfigRow key={p.sku} product={p} updateProduct={updateProduct} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductConfigRow({ product, updateProduct }) {
  const [cost, setCost] = useState(product.unitCost != null ? String(product.unitCost) : '');
  const [upb, setUpb] = useState(product.unitsPerBox != null ? String(product.unitsPerBox) : '');
  const [saving, setSaving] = useState(false);

  const save = async (field, raw) => {
    const value = raw === '' ? null : field === 'unitCost' ? parseFloat(raw) : parseInt(raw, 10);
    const current = product[field] ?? null;
    if (value === current || (value != null && Number.isNaN(value))) return;
    setSaving(true);
    try {
      await updateProduct(product.sku, { [field]: value });
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e) => { if (e.key === 'Enter') e.target.blur(); };
  const costMissing = cost === '' || parseFloat(cost) === 0;

  return (
    <tr className={`border-b border-zinc-800/40 ${saving ? 'opacity-60' : ''}`}>
      <td className="px-4 py-2 text-zinc-200">{product.name || product.sku}</td>
      <td className="px-4 py-2 text-zinc-500 text-xs font-mono">{product.sku}</td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min="0"
          step="0.01"
          value={cost}
          onChange={e => setCost(e.target.value)}
          onBlur={e => save('unitCost', e.target.value)}
          onKeyDown={onKey}
          placeholder="—"
          className={`w-24 bg-zinc-800 border rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500 ${
            costMissing ? 'border-amber-500/60' : 'border-zinc-700'
          }`}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <input
          type="number"
          min="1"
          step="1"
          value={upb}
          onChange={e => setUpb(e.target.value)}
          onBlur={e => save('unitsPerBox', e.target.value)}
          onKeyDown={onKey}
          placeholder="1"
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500"
        />
      </td>
    </tr>
  );
}
