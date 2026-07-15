import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStock } from '../../context/StockContext';
import { vendliveService } from '../../services/vendlive.service';
import { inventoryService } from '../../services/inventory.service';
import NeedsAttention from './dashboard/NeedsAttention';

function StatCard({ label, value, accent, to }) {
  const colors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    teal: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400'
  };
  const content = (
    <div className={`rounded-lg border p-5 h-full transition-colors ${colors[accent] || colors.emerald} ${to ? 'hover:border-current cursor-pointer' : ''}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </div>
  );
  return to ? <Link to={to} className="block">{content}</Link> : content;
}

// Relative time for sync freshness lines, e.g. "12m ago", "26 h ago", "6 days ago"
function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

// Short absolute-ish time for the healthy line: "12m ago" if recent,
// otherwise "Fri 20:00"
function shortWhen(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'never';
  const hours = (Date.now() - d.getTime()) / 3600000;
  if (hours < 6) return timeAgo(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}

// VendLive sync health panel — surfaces sync problems on the dashboard
// (instead of email alerts). Polls /vendlive/health every 5 minutes.
function VendliveSyncHealth() {
  const [health, setHealth] = useState(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const h = await vendliveService.getHealth();
        if (!cancelled) {
          setHealth(h);
          setUnreachable(false);
        }
      } catch (err) {
        if (!cancelled) setUnreachable(true);
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Nothing yet (first fetch in flight) — render nothing rather than a flash
  if (!health && !unreachable) return null;

  if (unreachable) {
    return (
      <div className="bg-amber-900/20 border border-amber-900/50 rounded-lg p-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-sm text-amber-400">VendLive — can't reach sync status</span>
          <Link to="/support/settings" className="text-xs text-amber-400/70 hover:text-amber-300 ml-auto">
            Settings →
          </Link>
        </div>
      </div>
    );
  }

  const sales = health.salesSync || {};
  const stock = health.stockSync || {};

  // Sync switched off entirely — informational, not an alarm
  if (!sales.enabled && !stock.enabled) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2 h-2 rounded-full bg-zinc-600" />
        <span className="text-zinc-500">VendLive sync is off</span>
        <Link to="/support/settings" className="text-xs text-zinc-600 hover:text-zinc-400">
          Settings →
        </Link>
      </div>
    );
  }

  // Build the list of problems as plain sentences
  const issues = [];
  if (sales.enabled && sales.stale) {
    issues.push({
      text: `Sales sync stale — last success ${timeAgo(sales.lastSuccessAt) || 'never'}`,
      severe: true,
    });
  }
  if (stock.enabled && stock.stale) {
    issues.push({
      text: `Stock levels last synced ${timeAgo(stock.lastSyncAt) || 'never'}`,
      severe: true,
    });
  }
  if ((health.quarantine?.unresolved || 0) > 0) {
    const n = health.quarantine.unresolved;
    issues.push({ text: `${n} sale${n === 1 ? '' : 's'} quarantined (unknown products)` });
  }
  if ((health.unmappedMachines || 0) > 0) {
    const n = health.unmappedMachines;
    issues.push({ text: `${n} machine${n === 1 ? '' : 's'} not mapped to a location` });
  }
  if ((health.errorsLast24h || 0) > 0) {
    const n = health.errorsLast24h;
    issues.push({ text: `${n} sync error${n === 1 ? '' : 's'} in the last 24 h` });
  }

  // Backend says not-ok but nothing above matched — still show something actionable
  if (!health.ok && issues.length === 0) {
    issues.push({ text: 'VendLive reports a sync problem — check settings' });
  }

  if (health.ok && issues.length === 0) {
    const parts = ['VendLive healthy'];
    if (sales.enabled) parts.push(`sales synced ${shortWhen(sales.lastSuccessAt)}`);
    if (stock.enabled) parts.push(`stock synced ${shortWhen(stock.lastSyncAt)}`);
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="w-2 h-2 rounded-full bg-emerald-400" />
        <span className="text-emerald-400">{parts[0]}</span>
        <span className="text-zinc-500">{parts.slice(1).map(p => ` · ${p}`).join('')}</span>
      </div>
    );
  }

  // Problems — red if a sync is stale, amber for everything else
  const severe = issues.some(i => i.severe);
  const palette = severe
    ? { card: 'bg-red-900/20 border-red-900/50', title: 'text-red-400', divider: 'border-red-900/30', link: 'text-red-400/70 hover:text-red-300' }
    : { card: 'bg-amber-900/20 border-amber-900/50', title: 'text-amber-400', divider: 'border-amber-900/30', link: 'text-amber-400/70 hover:text-amber-300' };

  return (
    <div className={`${palette.card} border rounded-lg p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-sm font-medium ${palette.title}`}>VendLive Sync Health</h3>
        <Link to="/support/settings" className={`text-xs ${palette.link}`}>
          VendLive settings →
        </Link>
      </div>
      <div className="space-y-2">
        {issues.map((issue, i) => (
          <Link
            key={i}
            to="/support/settings"
            className={`flex items-center gap-2 py-1.5 border-b ${palette.divider} last:border-0 group`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${issue.severe ? 'bg-red-400' : 'bg-amber-400'}`} />
            <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">{issue.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// Stock already out in the machines that will expire before the next restock
// (7-day window). Hidden entirely when empty or when the fetch fails — this
// panel only earns space when there is something to act on.
function MachineExpiryPanel() {
  const [rows, setRows] = useState(null); // null until loaded

  useEffect(() => {
    let cancelled = false;
    inventoryService.getMachineExpiry(7)
      .then(result => {
        if (!cancelled) setRows(Array.isArray(result?.rows) ? result.rows : []);
      })
      .catch(err => {
        // Hide the panel on failure — the dashboard shouldn't nag about a
        // secondary fetch. Log for diagnosis only.
        console.error('Machine expiry fetch failed:', err);
        if (!cancelled) setRows([]);
      });
    return () => { cancelled = true; };
  }, []);

  if (!rows || rows.length === 0) return null;

  const formatExpiry = (iso) => {
    if (!iso) return 'unknown';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'unknown';
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const anyCritical = rows.some(r => (r.daysUntil ?? 99) <= 2);
  const palette = anyCritical
    ? { card: 'bg-red-900/20 border-red-900/50', title: 'text-red-400', divider: 'border-red-900/30' }
    : { card: 'bg-amber-900/20 border-amber-900/50', title: 'text-amber-400', divider: 'border-amber-900/30' };

  const visible = rows.slice(0, 8);
  const overflow = rows.length - visible.length;

  return (
    <div className={`${palette.card} border rounded-lg p-6`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className={`text-sm font-medium ${palette.title}`}>Expiring in machines</h3>
        <Link to="/locations" className={`text-xs opacity-70 hover:opacity-100 ${palette.title}`}>
          Location stock →
        </Link>
      </div>
      <div className="space-y-1">
        {visible.map((r, i) => {
          const critical = (r.daysUntil ?? 99) <= 2;
          return (
            <div
              key={`${r.locationId}-${r.sku}-${i}`}
              className={`flex items-center justify-between gap-3 py-2 border-b ${palette.divider} last:border-0`}
            >
              <div className="min-w-0">
                <span className="text-zinc-300 text-sm">{r.name || r.sku} × {r.quantity}</span>
                <span className="text-zinc-600 text-xs ml-2">{r.locationName}</span>
              </div>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded whitespace-nowrap ${
                critical ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                expires {formatExpiry(r.earliestExpiry)} ({r.daysUntil}d)
              </span>
            </div>
          );
        })}
        {overflow > 0 && (
          <div className={`text-xs pt-2 ${palette.title}`}>+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

function SectionHeading({ children, to }) {
  if (!to) return <h3 className="text-sm font-medium text-zinc-400 mb-4">{children}</h3>;
  return (
    <Link to={to} className="text-sm font-medium text-zinc-400 mb-4 hover:text-emerald-400 inline-flex items-center gap-1 group">
      <span>{children}</span>
      <span className="text-zinc-600 group-hover:text-emerald-400 transition-colors">→</span>
    </Link>
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
  // Refunded sales are excluded — they contribute no revenue or profit
  // (is_refunded fallback matches the CSV-import shape, as in SalesOverview)
  const recentSales = (data.salesData || []).filter(
    s => !(s.isRefunded ?? s.is_refunded) && new Date(s.timestamp) >= thirtyDaysAgo
  );
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
      <NeedsAttention />

      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Operations</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Pending Orders" value={pendingOrders} accent="teal" to="/orders/purchase" />
          <StatCard label="Warehouse Stock" value={totalWarehouseUnits.toLocaleString()} accent="blue" to="/warehouse" />
          <StatCard label="Location Stock" value={totalLocationUnits.toLocaleString()} accent="emerald" to="/locations" />
          <StatCard label="Expiry Alerts" value={expiryAlertCount} accent={expiryAlertCount > 0 ? 'red' : 'emerald'} to="/warehouse" />
        </div>
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Financial</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Warehouse Value" value={`£${totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} accent="purple" to="/warehouse" />
          <StatCard label="30d Revenue" value={`£${totalSalesRevenue.toFixed(2)}`} accent="emerald" to="/sales" />
          <StatCard label="30d Profit" value={`£${totalSalesProfit.toFixed(2)}`} accent="teal" to="/sales" />
        </div>
      </div>

      <VendliveSyncHealth />

      {/* Stock in machines expiring before the next restock */}
      <MachineExpiryPanel />

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

      {/* Warning expiry (8-30 days) — amber, not green: it needs attention */}
      {warningBatches.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-amber-400 mb-4">Expiring Within 30 Days</h3>
          <div className="space-y-3">
            {warningBatches.slice(0, 5).map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              const daysLeft = Math.ceil((new Date(batch.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-amber-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">{daysLeft}d left</span>
                  </div>
                </div>
              );
            })}
            {warningBatches.length > 5 && (
              <div className="text-xs text-amber-400 pt-2">+{warningBatches.length - 5} more items</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <SectionHeading to="/warehouse">Warehouse Stock</SectionHeading>
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
          <SectionHeading to="/locations">Location Stock Levels</SectionHeading>
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
        <SectionHeading to="/support/history">Recent Stock Movements</SectionHeading>
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
