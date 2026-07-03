import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, PackagePlus } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { useRestockRun } from '../../../context/RestockRunContext';
import usePickLists from '../../../hooks/usePickLists';
import ActionCard from '../../ui/ActionCard';

// Literal tone map — Tailwind JIT purges interpolated class strings.
const BADGE_TONES = {
  emerald: 'bg-emerald-500/15 text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-400',
  red: 'bg-red-500/15 text-red-400',
};

function StepCard({ number, title, description, ctaLabel, to, status, disabled, onClick, secondaryAction, badge }) {
  const navigate = useNavigate();
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
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${numberStyles[status]}`}
        >
          {status === 'done' ? '✓' : number}
        </div>
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        {badge && (
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${BADGE_TONES[badge.tone] || BADGE_TONES.amber}`}>
            {badge.label}
          </span>
        )}
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
      {secondaryAction && !disabled && (
        <button
          onClick={(e) => {
            // The whole card is a Link — keep this inner action from
            // triggering the card navigation.
            e.preventDefault();
            e.stopPropagation();
            navigate(secondaryAction.to);
          }}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 text-center w-full"
        >
          {secondaryAction.label}
        </button>
      )}
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
  const { selectedRouteId, activePickListId, completedSteps, resetRun } = useRestockRun();
  const navigate = useNavigate();
  // Live pick-list state for the step-2 badge (fail-soft: no badge on error).
  const { lists: pickLists } = usePickLists({ limit: 10 });

  const selectedRoute = (data.restockRoutes || []).find((r) => r.id === selectedRouteId);
  const routeLocations = selectedRoute
    ? (selectedRoute.locationIds || [])
        .map((locId) => data.locations.find((l) => l.id === locId))
        .filter(Boolean)
    : [];

  const step1Status = completedSteps.route ? 'done' : 'active';
  // Step 2 is completed either by marking a pick list as packed or by a
  // manual stock removal — both fire markStepComplete('remove').
  const step2Status = completedSteps.remove ? 'done' : 'active';
  const step3Status = !completedSteps.remove ? 'pending' : completedSteps.machine ? 'done' : 'active';

  // The run's relevant pick list: the one the run is tracking, else the
  // latest non-cancelled list for the selected route (routeId scoping bounds
  // stale matches from a previous, reset run).
  const relevantPickList =
    pickLists.find((l) => l.id === activePickListId) ||
    pickLists
      .filter((l) => l.status !== 'cancelled' && selectedRouteId && l.routeId === selectedRouteId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0] ||
    null;

  const step2Badge = relevantPickList
    ? relevantPickList.status === 'packed'
      ? (relevantPickList.shortfalls?.length > 0
        ? { label: `Packed · ${relevantPickList.shortfalls.length} short`, tone: 'amber' }
        : { label: 'Packed', tone: 'emerald' })
      : relevantPickList.status === 'draft'
        ? { label: 'Draft pick list', tone: 'amber' }
        : null
    : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Restock Workflow</h2>
          <p className="text-zinc-500 text-sm mt-1">
            Complete a full restock run in three steps. Pick up where you left off at any time.
          </p>
        </div>
        {(selectedRouteId || completedSteps.route || completedSteps.remove || completedSteps.machine) && (
          <button
            onClick={() => { resetRun(); navigate('/restock'); }}
            className="text-sm text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 self-start sm:self-auto"
          >
            Reset run
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
          badge={selectedRoute ? { label: selectedRoute.name, tone: 'emerald' } : null}
        />
        <StepCard
          number={2}
          title="Pack (pick list)"
          description="Generate the pick list for your route, pack the bags from the listed batches, and mark it packed."
          ctaLabel="Open pick lists"
          to="/restock/picklists"
          status={step2Status}
          badge={step2Badge}
          secondaryAction={{ label: 'or remove stock manually', to: '/restock/remove' }}
        />
        <StepCard
          number={3}
          title="Run the route"
          description="Run the route — check and restock each machine, then reconcile the van."
          ctaLabel={completedSteps.remove ? 'Open today’s run' : 'Pack first'}
          to="/restock/run"
          status={step3Status}
          disabled={!completedSteps.remove}
          badge={completedSteps.machine ? { label: 'Run complete', tone: 'emerald' } : null}
        />
      </div>

      <div>
        <h3 className="text-sm font-medium text-zinc-400 mb-3">Quick actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ActionCard
            to="/restock/check"
            icon={ClipboardCheck}
            title="Stock Check"
            description="Audit a machine — tick what matches, count what doesn’t."
          />
          <ActionCard
            to="/restock/machine"
            icon={PackagePlus}
            title="Log a Restock"
            description="Record what went into a machine."
          />
        </div>
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
