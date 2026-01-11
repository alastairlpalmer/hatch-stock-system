import React from 'react';
import { useStock } from '../../context/StockContext';

function StatCard({ label, value, accent }) {
  const colors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    teal: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400'
  };
  return (
    <div className={`rounded-lg border p-5 ${colors[accent] || colors.emerald}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { data } = useStock();

  const pendingOrders = data.orders.filter(o => o.status === 'pending').length;
  const totalWarehouseUnits = Object.values(data.stock).reduce((acc, loc) => {
    return acc + Object.values(loc || {}).reduce((a, b) => a + b, 0);
  }, 0);
  const totalLocationUnits = Object.values(data.locationStock).reduce((acc, loc) => {
    return acc + Object.values(loc || {}).reduce((a, b) => a + b, 0);
  }, 0);
  const totalValue = Object.entries(data.stock).reduce((acc, [loc, items]) => {
    return acc + Object.entries(items || {}).reduce((a, [sku, qty]) => {
      const product = data.products.find(p => p.sku === sku);
      return a + (product?.unitCost || 0) * qty;
    }, 0);
  }, 0);
  const recentRemovals = data.removals.slice(-5).reverse();

  // Sales summary (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentSales = (data.salesData || []).filter(s => new Date(s.timestamp) >= thirtyDaysAgo);
  const totalSalesRevenue = recentSales.reduce((acc, s) => acc + s.charged, 0);
  const totalSalesProfit = recentSales.reduce((acc, s) => acc + (s.charged - s.costPrice), 0);

  // Expiry tracking
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return 'expired';
    if (daysUntil <= 7) return 'critical';
    if (daysUntil <= 30) return 'warning';
    return 'ok';
  };

  const batches = (data.stockBatches || []).filter(b => b.remainingQty > 0);
  const expiredBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'expired');
  const criticalBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'critical');
  const warningBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'warning');
  const expiryAlertCount = expiredBatches.length + criticalBatches.length;

  // Find low stock at locations
  const lowStockLocations = data.locations.map(loc => {
    const locStock = data.locationStock[loc.id] || {};
    const locConfig = data.locationConfig[loc.id] || {};
    const lowItems = data.products.filter(p => {
      const config = locConfig[p.sku] || {};
      const qty = locStock[p.sku] || 0;
      return config.minStock && qty <= config.minStock;
    });
    return { location: loc, lowItems };
  }).filter(l => l.lowItems.length > 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <StatCard label="Pending Orders" value={pendingOrders} accent="teal" />
        <StatCard label="Warehouse Stock" value={totalWarehouseUnits.toLocaleString()} accent="blue" />
        <StatCard label="Location Stock" value={totalLocationUnits.toLocaleString()} accent="emerald" />
        <StatCard label="Warehouse Value" value={`£${totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} accent="purple" />
        <StatCard label="30d Revenue" value={`£${totalSalesRevenue.toFixed(2)}`} accent="emerald" />
        <StatCard label="30d Profit" value={`£${totalSalesProfit.toFixed(2)}`} accent="teal" />
        <StatCard label="Expiry Alerts" value={expiryAlertCount} accent={expiryAlertCount > 0 ? 'red' : 'emerald'} />
      </div>

      {/* Expiry Alerts */}
      {(expiredBatches.length > 0 || criticalBatches.length > 0) && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-red-400 mb-4">Expiry Alerts</h3>
          <div className="space-y-3">
            {expiredBatches.map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-red-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">EXPIRED</span>
                  </div>
                </div>
              );
            })}
            {criticalBatches.map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              const daysLeft = Math.ceil((new Date(batch.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-red-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">{daysLeft}d left</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warning expiry (30 days) */}
      {warningBatches.length > 0 && (
        <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-emerald-400 mb-4">Expiring Within 30 Days</h3>
          <div className="space-y-3">
            {warningBatches.slice(0, 5).map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              const daysLeft = Math.ceil((new Date(batch.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-emerald-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">{daysLeft}d left</span>
                  </div>
                </div>
              );
            })}
            {warningBatches.length > 5 && (
              <div className="text-xs text-emerald-400 pt-2">+{warningBatches.length - 5} more items</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">Warehouse Stock</h3>
          {data.warehouses.length === 0 ? (
            <p className="text-zinc-500 text-sm">No warehouses configured</p>
          ) : (
            <div className="space-y-3">
              {data.warehouses.map(wh => {
                const units = Object.values(data.stock[wh.id] || {}).reduce((a, b) => a + b, 0);
                const skus = Object.keys(data.stock[wh.id] || {}).length;
                return (
                  <div key={wh.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{wh.name}</span>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-500">{skus} SKUs</span>
                      <span className="text-emerald-400 font-medium">{units.toLocaleString()} units</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">Location Stock Levels</h3>
          {data.locations.length === 0 ? (
            <p className="text-zinc-500 text-sm">No locations configured</p>
          ) : (
            <div className="space-y-3">
              {data.locations.map(loc => {
                const units = Object.values(data.locationStock[loc.id] || {}).reduce((a, b) => a + b, 0);
                const skus = Object.keys(data.locationStock[loc.id] || {}).length;
                return (
                  <div key={loc.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{loc.name}</span>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-500">{skus} SKUs</span>
                      <span className="text-emerald-400 font-medium">{units.toLocaleString()} units</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {lowStockLocations.length > 0 && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-red-400 mb-4">Low Stock Alerts - Locations</h3>
          <div className="space-y-3">
            {lowStockLocations.map(({ location, lowItems }) => (
              <div key={location.id} className="flex items-start justify-between py-2 border-b border-red-900/30 last:border-0">
                <span className="text-zinc-300">{location.name}</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {lowItems.slice(0, 3).map(p => (
                    <span key={p.sku} className="text-xs bg-red-900/50 px-2 py-1 rounded text-red-300">
                      {p.name}
                    </span>
                  ))}
                  {lowItems.length > 3 && (
                    <span className="text-xs text-red-400">+{lowItems.length - 3} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Recent Stock Movements</h3>
        {recentRemovals.length === 0 ? (
          <p className="text-zinc-500 text-sm">No recent movements</p>
        ) : (
          <div className="space-y-3">
            {recentRemovals.map((r, i) => {
              const product = data.products.find(p => p.sku === r.sku);
              const fromWh = data.warehouses.find(w => w.id === r.fromLocation);
              const toLoc = data.locations.find(l => l.id === r.toLocation);
              return (
                <div key={i} className="flex items-start justify-between py-2 border-b border-zinc-800 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || r.sku}</span>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {fromWh?.name || r.fromLocation} → {toLoc?.name || r.toLocation}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-red-400 text-sm">-{r.quantity}</span>
                    <div className="text-xs text-zinc-600">{r.takenBy}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
