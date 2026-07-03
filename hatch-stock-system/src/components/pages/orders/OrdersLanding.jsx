import React from 'react';
import { Link } from 'react-router-dom';
import { Warehouse, CalendarClock, PackageCheck, ListChecks } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import ActionCard from '../../ui/ActionCard';

function formatDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Desktop landing for /orders (replaces the old redirect to Purchase Orders):
// the mobile hub's action cards in a grid, plus a snapshot of what's waiting
// to be received. The mobile OrdersHub stays its own component so the phone
// experience can't drift; both consume ActionCard.
export default function OrdersLanding() {
  const { data } = useStock();

  const pending = (data.orders || []).filter((o) => o.status === 'pending');
  const supplierName = (id) => data.suppliers.find((s) => s.id === id)?.name || 'No supplier';

  // Soonest expected delivery first; undated orders last (newest first there).
  const snapshot = pending
    .slice()
    .sort((a, b) => {
      if (a.expectedDate && b.expectedDate) return new Date(a.expectedDate) - new Date(b.expectedDate);
      if (a.expectedDate) return -1;
      if (b.expectedDate) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, 5);

  const receiveProgress = (order) => {
    const items = order.items || [];
    const totalQty = items.reduce((a, i) => a + (i.quantity || 0), 0);
    const received = items.reduce((a, i) => a + (i.receivedQty || 0), 0);
    return received > 0 ? { received, totalQty } : null;
  };

  const orderTotal = (order) =>
    order.totalAmount ?? order.total ?? (order.items || []).reduce(
      (a, i) => a + (i.quantity || 0) * (i.unitPrice || 0), 0
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <ActionCard
          to="/orders/purchase?generate=1"
          icon={CalendarClock}
          title="Plan Buy"
          description="Suggested quantities for restock day, netted against the warehouse."
        />
        <ActionCard
          to="/orders/receive"
          icon={PackageCheck}
          title="Receive Order"
          description="Check deliveries in — quantities, expiry dates, flavour allocation."
          badge={pending.length > 0 ? `${pending.length} pending` : null}
        />
        <ActionCard
          to="/orders/warehouse"
          icon={Warehouse}
          title="Warehouse Stock"
          description="Stock on hand, expiry batches, transfers and write-offs."
        />
        <ActionCard
          to="/orders/buying-lists"
          icon={ListChecks}
          title="Buying Lists"
          description="The weekly supplier-grouped list — share, PDF, create POs."
        />
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-medium text-zinc-400">Pending orders</h3>
          <Link to="/orders/purchase" className="text-xs text-zinc-500 hover:text-emerald-400">
            All purchase orders →
          </Link>
        </div>
        {snapshot.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-600 text-center">No pending orders</p>
        ) : (
          <div className="divide-y divide-zinc-800/60">
            {snapshot.map((order) => {
              const progress = receiveProgress(order);
              const expected = formatDay(order.expectedDate);
              return (
                <Link
                  key={order.id}
                  to="/orders/receive"
                  className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 group"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{supplierName(order.supplierId)}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {expected ? `Expected ${expected}` : `Created ${formatDay(order.createdAt) || ''}`}
                      {' · '}{(order.items || []).length} line{(order.items || []).length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {progress && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 flex-shrink-0">
                      {progress.received}/{progress.totalQty} received
                    </span>
                  )}
                  <span className="text-sm text-zinc-300 flex-shrink-0">
                    £{Number(orderTotal(order) || 0).toFixed(2)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
