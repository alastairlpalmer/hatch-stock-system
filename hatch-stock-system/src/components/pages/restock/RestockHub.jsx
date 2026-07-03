import React from 'react';
import { Link } from 'react-router-dom';
import { Truck, ClipboardCheck, ListChecks, PackagePlus, Route as RouteIcon } from 'lucide-react';
import { useRestockRun } from '../../../context/RestockRunContext';
import { useStock } from '../../../context/StockContext';
import ActionCard from '../../ui/ActionCard';

// Mobile entry point for the Restock area (the /restock index on phones —
// desktop keeps the 3-step RestockWorkflow). Big tap targets for the jobs a
// restocker actually does standing up; the pages behind them are unchanged.
const ACTIONS = [
  {
    to: '/restock/run',
    icon: Truck,
    title: "Today's Run",
    description: 'Check and restock each machine on the route, then reconcile the van.',
  },
  {
    to: '/restock/check',
    icon: ClipboardCheck,
    title: 'Stock Check',
    description: 'Audit a machine — tick what matches, count what doesn’t.',
  },
  {
    to: '/restock/picklists',
    icon: ListChecks,
    title: 'Pick Lists',
    description: 'Generate what to pack, with the batch (soonest expiry) to pull.',
  },
  {
    to: '/restock/machine',
    icon: PackagePlus,
    title: 'Log a Restock',
    description: 'Record what went into a machine.',
  },
];

export default function RestockHub() {
  const { selectedRouteId } = useRestockRun();
  const { data } = useStock();
  const currentRoute = selectedRouteId
    ? (data.restockRoutes || []).find(r => r.id === selectedRouteId)
    : null;

  return (
    <div className="space-y-4">
      {currentRoute && (
        <Link
          to="/restock/route"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300"
        >
          <RouteIcon className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1 truncate">Current run: {currentRoute.name}</span>
          <span className="text-xs text-emerald-400/70">change</span>
        </Link>
      )}

      <div className="space-y-3">
        {ACTIONS.map((action) => (
          <ActionCard key={action.to} {...action} />
        ))}
      </div>

      {!currentRoute && (
        <Link to="/restock/route" className="block text-center text-sm text-zinc-500 hover:text-zinc-300 py-1">
          Select a route to start a run →
        </Link>
      )}
    </div>
  );
}
