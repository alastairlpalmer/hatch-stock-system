import React from 'react';
import { Link } from 'react-router-dom';
import { Truck, ClipboardCheck, ListChecks, PackagePlus, ChevronRight, Route as RouteIcon } from 'lucide-react';
import { useRestockRun } from '../../../context/RestockRunContext';
import { useStock } from '../../../context/StockContext';

// Mobile entry point for the Restock area (the /restock index on phones —
// desktop keeps the 3-step RestockWorkflow). Big tap targets for the jobs a
// restocker actually does standing up; the pages behind them are unchanged.
const ACTIONS = [
  {
    to: '/restock/run',
    Icon: Truck,
    title: "Today's Run",
    description: 'Check and restock each machine on the route, then reconcile the van.',
  },
  {
    to: '/restock/check',
    Icon: ClipboardCheck,
    title: 'Stock Check',
    description: 'Audit a machine — tick what matches, count what doesn’t.',
  },
  {
    to: '/restock/picklists',
    Icon: ListChecks,
    title: 'Pick Lists',
    description: 'Generate what to pack, with the batch (soonest expiry) to pull.',
  },
  {
    to: '/restock/machine',
    Icon: PackagePlus,
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
        {ACTIONS.map(({ to, Icon, title, description }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-4 min-h-[72px] px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-emerald-500/60 active:bg-zinc-800/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-100">{title}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-zinc-600 flex-shrink-0" />
          </Link>
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
