import React, { useState, useEffect } from 'react';
import { useStock } from '../../context/StockContext';

export default function History() {
  const { data, loadRemovalHistory } = useStock();
  const [tab, setTab] = useState('removals');

  // Load removal history on mount
  useEffect(() => {
    loadRemovalHistory();
  }, [loadRemovalHistory]);

  const getWarehouseName = (id) => data.warehouses.find(w => w.id === id)?.name || id;
  const getLocationName = (id) => data.locations.find(l => l.id === id)?.name || id;
  const getRouteName = (id) => {
    const route = (data.restockRoutes || []).find(r => r.id === id);
    return route?.name || getLocationName(id);
  };
  const getProductName = (sku) => data.products.find(p => p.sku === sku)?.name || sku;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">History</h2>

      <div className="flex gap-2">
        <button
          onClick={() => setTab('removals')}
          className={`px-4 py-2 rounded text-sm ${tab === 'removals' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          Stock Removals
        </button>
        <button
          onClick={() => setTab('restocks')}
          className={`px-4 py-2 rounded text-sm ${tab === 'restocks' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}
        >
          Restocks
        </button>
      </div>

      {tab === 'removals' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">From → Route</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">By</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {data.removals.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No removals yet</td></tr>
              ) : (
                data.removals.slice().reverse().flatMap((r, i) => {
                  // Handle new format with items array
                  const items = r.items || [{ sku: r.sku, quantity: r.quantity }];
                  const timestamp = r.createdAt || r.timestamp;
                  const fromWarehouse = r.warehouseId || r.fromLocation;

                  return items.map((item, j) => (
                    <tr key={`${i}-${j}`} className="border-b border-zinc-800/50">
                      <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(timestamp).toLocaleDateString('en-GB')}</td>
                      <td className="px-4 py-3 text-zinc-200">{getProductName(item.sku)}</td>
                      <td className="text-right px-4 py-3 text-red-400">-{item.quantity}</td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">
                        {getWarehouseName(fromWarehouse)} → {r.routeName || getRouteName(r.routeId || r.toLocation)}
                        {r.notes && j === 0 && <div className="text-zinc-600 mt-0.5">{r.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">{r.takenBy}</td>
                      <td className="px-4 py-3">
                        {r.isAdhoc ? (
                          <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Ad-hoc</span>
                        ) : (
                          <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Restock</span>
                        )}
                      </td>
                    </tr>
                  ));
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'restocks' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Route / Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {(data.restocks || data.restockHistory || []).length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No restocks yet</td></tr>
              ) : (
                (data.restocks || data.restockHistory || []).slice().reverse().map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(r.timestamp).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-zinc-200">{getProductName(r.sku)}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">+{r.quantity}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {r.routeName && <span className="text-emerald-400">{r.routeName}</span>}
                      {r.routeName && ' → '}
                      {getLocationName(r.location || r.locationId)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{r.takenBy || r.performedBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
