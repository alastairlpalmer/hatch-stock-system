import React, { useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';

export default function Admin() {
  const [adminTab, setAdminTab] = useState('products');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Admin</h2>

      <div className="flex gap-2 border-b border-zinc-800 pb-4 flex-wrap">
        {[
          { id: 'products', label: 'Products' },
          { id: 'warehouses', label: 'Warehouses' },
          { id: 'locations', label: 'Locations' },
          { id: 'routes', label: 'Restock Routes' },
          { id: 'suppliers', label: 'Suppliers' },
          { id: 'data', label: 'Data Management' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setAdminTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              adminTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {adminTab === 'products' && <AdminProducts />}
      {adminTab === 'warehouses' && <AdminWarehouses />}
      {adminTab === 'locations' && <AdminLocations />}
      {adminTab === 'routes' && <AdminRoutes />}
      {adminTab === 'suppliers' && <AdminSuppliers />}
      {adminTab === 'data' && <AdminData />}
    </div>
  );
}

function AdminProducts() {
  const { data, addProduct, updateProduct, deleteProduct } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ sku: '', name: '', description: '', unitCost: '', unitsPerBox: '', preferredSupplierId: '', category: '', barcode: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setForm({ sku: '', name: '', description: '', unitCost: '', unitsPerBox: '', preferredSupplierId: '', category: '', barcode: '' });
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editProduct = (p) => {
    setForm({
      sku: p.sku,
      name: p.name,
      description: p.description || '',
      unitCost: p.unitCost?.toString() || '',
      unitsPerBox: p.unitsPerBox?.toString() || '',
      preferredSupplierId: p.preferredSupplierId || '',
      category: p.category || '',
      barcode: p.barcode || ''
    });
    setEditingId(p.sku);
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.sku || !form.name) return;

    setLoading(true);
    setError(null);

    try {
      const product = {
        sku: form.sku.toUpperCase().trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        unitCost: parseFloat(form.unitCost) || 0,
        unitsPerBox: parseInt(form.unitsPerBox) || 1,
        preferredSupplierId: form.preferredSupplierId,
        category: form.category.trim(),
        barcode: form.barcode.trim()
      };

      if (editingId) {
        await updateProduct(editingId, product);
      } else {
        if (data.products.some(p => p.sku === product.sku)) {
          setError('SKU already exists');
          setLoading(false);
          return;
        }
        await addProduct(product);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save product');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (sku) => {
    setLoading(true);
    try {
      await deleteProduct(sku);
    } catch (err) {
      setError(err.message || 'Failed to delete product');
    } finally {
      setLoading(false);
    }
  };

  const getSupplierName = (id) => data.suppliers.find(s => s.id === id)?.name || '-';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Manage product catalog</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Product'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">SKU *</label>
              <input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} disabled={!!editingId} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm disabled:opacity-50" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-zinc-500 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Description</label>
            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Unit Cost</label>
              <input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Units per Box</label>
              <input type="number" value={form.unitsPerBox} onChange={e => setForm({ ...form, unitsPerBox: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Preferred Supplier</label>
              <select value={form.preferredSupplierId} onChange={e => setForm({ ...form, preferredSupplierId: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm">
                <option value="">None</option>
                {data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Category</label>
              <input type="text" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Product
          </button>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Cost</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Per Box</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Supplier</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.products.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">No products yet</td></tr>
            ) : (
              data.products.map(p => (
                <tr key={p.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-emerald-400 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-zinc-200">{p.name}</td>
                  <td className="px-4 py-3 text-zinc-500">{p.category || '-'}</td>
                  <td className="text-right px-4 py-3 text-zinc-300">{p.unitCost?.toFixed(2) || '0.00'}</td>
                  <td className="text-right px-4 py-3 text-zinc-400">{p.unitsPerBox || 1}</td>
                  <td className="px-4 py-3 text-zinc-500">{getSupplierName(p.preferredSupplierId)}</td>
                  <td className="text-right px-4 py-3">
                    <button onClick={() => editProduct(p)} className="text-zinc-400 hover:text-white mr-3">Edit</button>
                    <button onClick={() => handleDelete(p.sku)} className="text-zinc-500 hover:text-red-400">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminWarehouses() {
  const { data, addWarehouse, updateWarehouse, deleteWarehouse } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setForm({ name: '', address: '', notes: '' });
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editWarehouse = (wh) => {
    setForm({ name: wh.name, address: wh.address || '', notes: wh.notes || '' });
    setEditingId(wh.id);
    setShowForm(true);
  };

  const submit = async () => {
    if (!form.name) return;

    setLoading(true);
    setError(null);

    try {
      const warehouse = {
        name: form.name.trim(),
        address: form.address.trim(),
        notes: form.notes.trim()
      };

      if (editingId) {
        await updateWarehouse(editingId, warehouse);
      } else {
        await addWarehouse(warehouse);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save warehouse');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await deleteWarehouse(id);
    } catch (err) {
      setError(err.message || 'Failed to delete warehouse');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Configure warehouses</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Warehouse'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Address</label>
              <input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
          </div>
          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Warehouse
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.warehouses.length === 0 ? (
          <p className="text-zinc-600 text-sm col-span-2">No warehouses</p>
        ) : (
          data.warehouses.map(wh => {
            const units = Object.values(data.stock[wh.id] || {}).reduce((a, b) => a + b, 0);
            const skus = Object.keys(data.stock[wh.id] || {}).length;
            return (
              <div key={wh.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-medium text-zinc-200">{wh.name}</h4>
                    {wh.address && <p className="text-zinc-500 text-sm mt-1">{wh.address}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => editWarehouse(wh)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                    <button onClick={() => handleDelete(wh.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-4 text-sm">
                  <span className="text-zinc-500">{skus} SKUs</span>
                  <span className="text-emerald-400">{units.toLocaleString()} units</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AdminLocations() {
  const { data, addLocation, updateLocation, deleteLocation } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'retail', assignedItems: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setForm({ name: '', type: 'retail', assignedItems: [] });
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editLocation = (loc) => {
    setForm({ name: loc.name, type: loc.type || 'retail', assignedItems: loc.assignedItems || [] });
    setEditingId(loc.id);
    setShowForm(true);
  };

  const toggleItem = (sku) => {
    if (form.assignedItems.includes(sku)) {
      setForm({ ...form, assignedItems: form.assignedItems.filter(s => s !== sku) });
    } else {
      setForm({ ...form, assignedItems: [...form.assignedItems, sku] });
    }
  };

  const submit = async () => {
    if (!form.name) return;

    setLoading(true);
    setError(null);

    try {
      const location = {
        name: form.name.trim(),
        type: form.type,
        assignedItems: form.assignedItems
      };

      if (editingId) {
        await updateLocation(editingId, location);
      } else {
        await addLocation(location);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save location');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await deleteLocation(id);
    } catch (err) {
      setError(err.message || 'Failed to delete location');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Configure restock locations and assign products</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Location'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Type</label>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm">
                <option value="retail">Retail</option>
                <option value="display">Display</option>
                <option value="vending">Vending</option>
                <option value="storage">Storage</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Assigned Products (leave empty for all)</label>
            <div className="max-h-48 overflow-y-auto bg-zinc-800/50 rounded p-2 space-y-1">
              {data.products.length === 0 ? (
                <p className="text-zinc-600 text-sm p-2">No products created yet</p>
              ) : (
                data.products.map(p => (
                  <label key={p.sku} className="flex items-center gap-2 p-2 hover:bg-zinc-700/50 rounded cursor-pointer">
                    <input type="checkbox" checked={form.assignedItems.includes(p.sku)} onChange={() => toggleItem(p.sku)} className="rounded border-zinc-600" />
                    <span className="text-zinc-300 text-sm">{p.name}</span>
                    <span className="text-zinc-600 text-xs">{p.sku}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Location
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.locations.length === 0 ? (
          <p className="text-zinc-600 text-sm col-span-2">No locations</p>
        ) : (
          data.locations.map(loc => (
            <div key={loc.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-zinc-200">{loc.name}</h4>
                  <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">{loc.type}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => editLocation(loc)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                  <button onClick={() => handleDelete(loc.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800">
                {(!loc.assignedItems || loc.assignedItems.length === 0) ? (
                  <span className="text-zinc-500 text-sm">All products allowed</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {loc.assignedItems.slice(0, 5).map(sku => {
                      const product = data.products.find(p => p.sku === sku);
                      return (
                        <span key={sku} className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400">{product?.name || sku}</span>
                      );
                    })}
                    {loc.assignedItems.length > 5 && (
                      <span className="text-xs text-zinc-500">+{loc.assignedItems.length - 5} more</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AdminRoutes() {
  const { data, addRoute, updateRoute, deleteRoute } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'route', locations: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const routes = data.restockRoutes || [];

  const resetForm = () => {
    setForm({ name: '', type: 'route', locations: [] });
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editRouteItem = (route) => {
    setForm({
      name: route.name,
      type: route.type || 'route',
      locations: route.locationIds || route.locations || []
    });
    setEditingId(route.id);
    setShowForm(true);
  };

  const toggleLocation = (locId) => {
    if (form.locations.includes(locId)) {
      setForm({ ...form, locations: form.locations.filter(l => l !== locId) });
    } else {
      setForm({ ...form, locations: [...form.locations, locId] });
    }
  };

  const moveLocation = (locId, direction) => {
    const idx = form.locations.indexOf(locId);
    if (idx === -1) return;
    const newLocations = [...form.locations];
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= newLocations.length) return;
    [newLocations[idx], newLocations[newIdx]] = [newLocations[newIdx], newLocations[idx]];
    setForm({ ...form, locations: newLocations });
  };

  const submit = async () => {
    if (!form.name) return;

    setLoading(true);
    setError(null);

    try {
      const route = {
        name: form.name.trim(),
        type: form.type,
        locationIds: form.type === 'adhoc' ? [] : form.locations
      };

      if (editingId) {
        await updateRoute(editingId, route);
      } else {
        await addRoute(route);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save route');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    const route = routes.find(r => r.id === id);
    if (route?.type === 'adhoc' && ['tasting', 'other'].includes(route.id)) {
      return;
    }
    setLoading(true);
    try {
      await deleteRoute(id);
    } catch (err) {
      setError(err.message || 'Failed to delete route');
    } finally {
      setLoading(false);
    }
  };

  const getLocationName = (id) => data.locations.find(l => l.id === id)?.name || id;

  const getRouteCapacity = (route) => {
    if (route.type === 'adhoc') return null;
    let total = 0;
    const locationIds = route.locationIds || route.locations || [];
    locationIds.forEach(locId => {
      const locConfig = data.locationConfig?.[locId] || {};
      Object.values(locConfig).forEach(config => {
        if (config.maxStock) total += config.maxStock;
      });
    });
    return total;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Create restock routes by combining locations in order</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Route'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Route Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g., Morning Route A"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm({ ...form, type: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                <option value="route">Restock Route</option>
                <option value="adhoc">Ad-hoc (Tasting/Other)</option>
              </select>
            </div>
          </div>

          {form.type === 'route' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-2">Select Locations (in restock order)</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-2">Available Locations</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {data.locations.length === 0 ? (
                      <p className="text-zinc-600 text-sm p-2">No locations created yet</p>
                    ) : (
                      data.locations
                        .filter(loc => !form.locations.includes(loc.id))
                        .map(loc => (
                          <button
                            key={loc.id}
                            onClick={() => toggleLocation(loc.id)}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-700 rounded text-sm text-zinc-300 flex items-center justify-between"
                          >
                            <span>{loc.name}</span>
                            <span className="text-emerald-400">+ Add</span>
                          </button>
                        ))
                    )}
                  </div>
                </div>

                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-2">Route Order</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {form.locations.length === 0 ? (
                      <p className="text-zinc-600 text-sm p-2">No locations selected</p>
                    ) : (
                      form.locations.map((locId, idx) => (
                        <div
                          key={locId}
                          className="px-3 py-2 bg-zinc-700 rounded text-sm text-zinc-200 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-mono text-xs">{idx + 1}.</span>
                            <span>{getLocationName(locId)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button onClick={() => moveLocation(locId, 'up')} disabled={idx === 0} className="text-zinc-400 hover:text-white disabled:opacity-30 px-1">Up</button>
                            <button onClick={() => moveLocation(locId, 'down')} disabled={idx === form.locations.length - 1} className="text-zinc-400 hover:text-white disabled:opacity-30 px-1">Dn</button>
                            <button onClick={() => toggleLocation(locId)} className="text-red-400 hover:text-red-300 px-1 ml-2">x</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.type === 'adhoc' && (
            <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
              Ad-hoc routes are for removing stock without restocking locations (e.g., tastings, samples, write-offs)
            </div>
          )}

          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Route
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Restock Routes</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.filter(r => r.type !== 'adhoc').length === 0 ? (
              <p className="text-zinc-600 text-sm">No restock routes created yet</p>
            ) : (
              routes.filter(r => r.type !== 'adhoc').map(route => {
                const capacity = getRouteCapacity(route);
                const routeLocationIds = route.locationIds || route.locations || [];
                return (
                  <div key={route.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-zinc-200">{route.name}</h4>
                        <div className="text-xs text-zinc-500 mt-1">
                          {routeLocationIds.length} locations
                          {capacity > 0 && <span className="ml-2 text-emerald-400">Max capacity: {capacity} units</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => editRouteItem(route)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                        <button onClick={() => handleDelete(route.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                      </div>
                    </div>
                    <div className="border-t border-zinc-800 pt-3">
                      {routeLocationIds.length === 0 ? (
                        <span className="text-zinc-500 text-sm">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {routeLocationIds.map((locId, idx) => (
                            <span key={locId} className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400 flex items-center gap-1">
                              <span className="text-emerald-400">{idx + 1}.</span>
                              {getLocationName(locId)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Ad-hoc Options</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.filter(r => r.type === 'adhoc').map(route => (
              <div key={route.id} className="bg-zinc-900/50 border border-purple-900/50 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-zinc-200">{route.name}</h4>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Ad-hoc</span>
                  </div>
                  {!['tasting', 'other'].includes(route.id) && (
                    <div className="flex gap-2">
                      <button onClick={() => editRouteItem(route)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                      <button onClick={() => handleDelete(route.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                    </div>
                  )}
                </div>
                <p className="text-zinc-500 text-xs mt-2">Stock removed but not restocked to any location</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminSuppliers() {
  const { data, addSupplier, updateSupplier, deleteSupplier } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', email: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setForm({ name: '', contact: '', email: '', phone: '' });
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  const editSupplierItem = (sup) => {
    setForm({ name: sup.name, contact: sup.contact || '', email: sup.email || '', phone: sup.phone || '' });
    setEditingId(sup.id);
    setShowForm(true);
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
        phone: form.phone.trim()
      };

      if (editingId) {
        await updateSupplier(editingId, supplier);
      } else {
        await addSupplier(supplier);
      }
      resetForm();
    } catch (err) {
      setError(err.message || 'Failed to save supplier');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
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
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Manage supplier information</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Supplier'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Company Name *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Contact Name</label>
              <input type="text" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50">
            {loading ? 'Saving...' : editingId ? 'Update' : 'Add'} Supplier
          </button>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Company</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Contact</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Phone</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.suppliers.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No suppliers yet</td></tr>
            ) : (
              data.suppliers.map(s => (
                <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-zinc-200">{s.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.contact || '-'}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.email || '-'}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.phone || '-'}</td>
                  <td className="text-right px-4 py-3">
                    <button onClick={() => editSupplierItem(s)} className="text-zinc-400 hover:text-white mr-3">Edit</button>
                    <button onClick={() => handleDelete(s.id)} className="text-zinc-500 hover:text-red-400">Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminData() {
  const { data, refreshData } = useStock();
  const [storageInfo, setStorageInfo] = useState({ size: 0, status: 'checking' });

  useEffect(() => {
    checkStorage();
  }, [data]);

  const checkStorage = async () => {
    try {
      // Estimate data size
      const dataString = JSON.stringify(data);
      const size = new Blob([dataString]).size;
      setStorageInfo({ size, status: 'connected' });
    } catch (e) {
      setStorageInfo({ size: 0, status: 'unavailable' });
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const forceSync = () => {
    if (refreshData) {
      refreshData();
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-6">
        <h3 className="text-sm font-medium text-emerald-400 mb-4">API Storage Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-xs text-zinc-500">Status</div>
            <div className={`text-sm font-medium ${storageInfo.status === 'connected' ? 'text-emerald-400' : 'text-red-400'}`}>
              {storageInfo.status === 'connected' ? 'Connected' : 'Unavailable'}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Data Size</div>
            <div className="text-sm font-medium text-zinc-300">{formatBytes(storageInfo.size)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Products</div>
            <div className="text-sm font-medium text-zinc-300">{data.products.length}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Orders</div>
            <div className="text-sm font-medium text-zinc-300">{data.orders.length}</div>
          </div>
        </div>
        <p className="text-zinc-500 text-xs mb-3">Data automatically persists via the backend API.</p>
        <button onClick={forceSync} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-500">Refresh Data</button>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Export Data</h3>
        <p className="text-zinc-500 text-sm mb-4">Download all stock data as JSON backup</p>
        <button onClick={exportData} className="px-4 py-2 bg-zinc-700 text-white rounded text-sm hover:bg-zinc-600">Export JSON</button>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Data Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-emerald-400">{data.products.length}</div>
            <div className="text-xs text-zinc-500">Products</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-teal-400">{data.warehouses.length}</div>
            <div className="text-xs text-zinc-500">Warehouses</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-blue-400">{data.locations.length}</div>
            <div className="text-xs text-zinc-500">Locations</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
            <div className="text-xl font-bold text-purple-400">{data.suppliers.length}</div>
            <div className="text-xs text-zinc-500">Suppliers</div>
          </div>
        </div>
      </div>
    </div>
  );
}
