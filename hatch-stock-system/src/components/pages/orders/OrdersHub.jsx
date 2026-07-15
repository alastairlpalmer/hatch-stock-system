import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, PackageCheck } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import ActionCard from '../../ui/ActionCard';

// Mobile entry point for the Orders area (the /orders index on phones —
// desktop gets OrdersLanding). Big tap targets for the three ordering jobs;
// the pages behind them are unchanged.
export default function OrdersHub() {
  const { data } = useStock();
  const pendingCount = (data.orders || []).filter((o) => o.status === 'pending').length;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <ActionCard
          // ?generate=1 auto-opens the weekly-buy planner on arrival.
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
          badge={pendingCount > 0 ? `${pendingCount} pending` : null}
        />
      </div>

      <Link to="/orders/buying-lists" className="block text-center text-sm text-zinc-500 hover:text-zinc-300 py-1">
        Buying lists →
      </Link>
    </div>
  );
}
