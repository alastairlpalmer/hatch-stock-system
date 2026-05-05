import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStock } from '../../../context/StockContext';
import { useRestockRun } from '../../../context/RestockRunContext';

function StepCard({ number, title, description, ctaLabel, to, status, disabled, onClick }) {
  const statusStyles = {
    active: 'border-emerald-500/40 bg-emerald-500/5',
    done: 'border-emerald-700/40 bg-emerald-700/5',
    pending: 'border-zinc-800 bg-zinc-900/50',
  };
  const numberStyles = {
    active: 'bg-emerald-500 text-zinc-900',
    done: 'bg-emerald-700 text-white',
    pending: 'bg-zinc-800 text-zinc-400',
  };

  const content = (
    <div
      className={`rounded-lg border p-6 h-full flex flex-col ${statusStyles[status]} ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-emerald-500/60 transition-colors'
      }`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${numberStyles[status]}`}
        >
          {status === 'done' ? '✓' : number}
        </div>
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      </div>
      <p className="text-zinc-400 text-sm mb-4 flex-1">{description}</p>
      <div
        className={`mt-auto px-4 py-2 rounded text-sm font-medium text-center ${
          status === 'active'
            ? 'bg-emerald-500 text-zinc-900'
            : 'bg-zinc-800 text-zinc-300'
        }`}
      >
        {status === 'done' ? 'Open again' : ctaLabel}
      </div>
    </div>
  );

  if (disabled) {
    return <div>{content}</div>;
  }
  if (onClick) {
    return (
      <button onClick={onClick} className="text-left">
        {content}
      </button>
    );
  }
  return <Link to={to}>{content}</Link>;
}

export default function RestockWorkflow() {
  const { data } = useStock();
  const { selectedRouteId, completedSteps, resetRun } = useRestockRun();
  const navigate = useNavigate();

  const selectedRoute = (data.restockRoutes || []).find((r) => r.id === selectedRouteId);
  const routeLocations = selectedRoute
    ? (selectedRoute.locationIds || [])
        .map((locId) => data.locations.find((l) => l.id === locId))
        .filter(Boolean)
    : [];

  const step1Status = completedSteps.route ? 'done' : 'active';
  const step2Status = !selectedRouteId ? 'pending' : completedSteps.remove ? 'done' : 'active';
  const step3Status = !completedSteps.remove ? 'pending' : completedSteps.machine ? 'done' : 'active';

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Restock Workflow</h2>
          <p className="text-zinc-500 text-sm mt-1">
            Complete a full restock run in three steps. Pick up where you left off at any time.
          </p>
        </div>
        {(selectedRouteId || completedSteps.remove || completedSteps.machine) && (
          <button
            onClick={() => { resetRun(); navigate('/restock'); }}
            className="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 self-start sm:self-auto"
          >
            Start a new run
          </button>
        )}
      </div>

      {selectedRoute && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4">
          <div className="text-xs text-emerald-400 mb-1">Current run</div>
          <div className="text-zinc-200 font-medium">{selectedRoute.name}</div>
          {routeLocations.length > 0 && (
            <div className="text-zinc-500 text-xs mt-1">
              {routeLocations.map((l) => l.name).join(' → ')}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StepCard
          number={1}
          title="Select Route"
          description="Pick the restock route you'll be running today. Sets context for the next two steps."
          ctaLabel="Choose route"
          to="/restock/route"
          status={step1Status}
        />
        <StepCard
          number={2}
          title="Remove Stock"
          description="Take stock from the warehouse onto your van for the selected route."
          ctaLabel={selectedRouteId ? 'Remove stock' : 'Select a route first'}
          to="/restock/remove"
          status={step2Status}
          disabled={!selectedRouteId}
        />
        <StepCard
          number={3}
          title="Restock Machine"
          description="On-site: count current stock at the location and load the new units."
          ctaLabel={completedSteps.remove ? 'Restock machine' : 'Remove stock first'}
          to="/restock/machine"
          status={step3Status}
          disabled={!completedSteps.remove}
        />
      </div>

      <div className="border-t border-zinc-800 pt-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Reporting</h3>
        <Link
          to="/restock/shrinkage"
          className="block bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-zinc-200 font-medium">Shrinkage analytics</div>
              <p className="text-zinc-500 text-sm mt-1">
                Investigate stock variance and losses across locations.
              </p>
            </div>
            <span className="text-zinc-400">→</span>
          </div>
        </Link>
      </div>
    </div>
  );
}
