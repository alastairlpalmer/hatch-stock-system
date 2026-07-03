import React from 'react';
import { Link } from 'react-router-dom';
import { Warehouse, CalendarClock, PackageCheck, ChevronRight } from 'lucide-react';
import { useStock } from '../../../context/StockContext';

// Mobile entry point for the Orders area (the /orders index on phones —
// desktop keeps redirecting to Purchase Orders). Mirrors RestockHub: big tap
// targets for the three ordering jobs; the pages behind them are unchanged.
export default function OrdersHub() {
  const { data } = useStock();
  const pendingCount = (data.orders || []).filter((o) => o.status === 'pending').length;

  const actions = [
    {
      to: '/orders/warehouse',
      Icon: Warehouse,
      title: 'Warehouse Stock',
      description: 'Stock on hand, expiry batches, transfers and write-offs.',
    },
    {
      // ?generate=1 auto-opens the weekly-buy planner on arrival.
      to: '/orders/purchase?generate=1',
      Icon: CalendarClock,
      title: 'Plan Buy',
      description: 'Suggested quantities for restock day, netted against the warehouse.',
    },
    {
      to: '/orders/receive',
      Icon: PackageCheck,
      title: 'Receive Order',
      description: 'Check deliveries in — quantities, expiry dates, flavour allocation.',
      badge: pendingCount > 0 ? `${pendingCount} pending` : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {actions.map(({ to, Icon, title, description, badge }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-4 min-h-[72px] px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-emerald-500/60 active:bg-zinc-800/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-zinc-100">{title}</p>
                {badge && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{badge}</span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-600 flex-shrink-0" />
          </Link>
        ))}
      </div>

      <Link to="/orders/buying-lists" className="block text-center text-sm text-zinc-500 hover:text-zinc-300 py-1">
        Buying lists →
      </Link>
    </div>
  );
}
