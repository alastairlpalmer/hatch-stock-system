import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useStock } from '../../../context/StockContext';
import { useRestockRun } from '../../../context/RestockRunContext';

export default function SelectRoute() {
  const { data } = useStock();
  const { selectedRouteId, setSelectedRouteId, markStepComplete } = useRestockRun();
  const navigate = useNavigate();

  const routes = data.restockRoutes || [];
  const restockRoutes = routes.filter((r) => r.type !== 'adhoc');
  const adhocRoutes = routes.filter((r) => r.type === 'adhoc');

  const choose = (routeId) => {
    setSelectedRouteId(routeId);
    markStepComplete('route');
    navigate('/restock/remove');
  };

  const renderRouteCard = (route) => {
    const locationCount = (route.locationIds || []).length;
    const isSelected = route.id === selectedRouteId;
    return (
      <button
        key={route.id}
        onClick={() => choose(route.id)}
        className={`text-left bg-zinc-900/50 border rounded-lg p-4 transition-colors ${
          isSelected
            ? 'border-emerald-500/60 bg-emerald-500/5'
            : 'border-zinc-800 hover:border-zinc-600'
        }`}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="font-medium text-zinc-200">{route.name}</div>
          {isSelected && (
            <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Selected</span>
          )}
        </div>
        <div className="text-xs text-zinc-500">
          {route.type === 'adhoc' ? 'Ad-hoc — no destination location' : `${locationCount} locations`}
        </div>
        {route.type !== 'adhoc' && locationCount > 0 && (
          <div className="text-xs text-zinc-600 mt-2 truncate">
            {(route.locationIds || [])
              .map((locId) => data.locations.find((l) => l.id === locId)?.name)
              .filter(Boolean)
              .join(' → ')}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-zinc-100">Step 1 — Select Route</h2>
        <p className="text-zinc-500 text-sm mt-1">
          Pick the route you'll be running. The selection carries through to Remove Stock and Restock Machine.
        </p>
      </div>

      {routes.length === 0 ? (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 text-center">
          <p className="text-zinc-400 text-sm mb-3">No restock routes configured yet.</p>
          <p className="text-zinc-500 text-xs">
            Add routes in Support → Settings → Restock Routes.
          </p>
        </div>
      ) : (
        <>
          <div>
            <h3 className="text-sm font-medium text-zinc-400 mb-3">Restock Routes</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {restockRoutes.length === 0 ? (
                <p className="text-zinc-600 text-sm">No restock routes</p>
              ) : (
                restockRoutes.map(renderRouteCard)
              )}
            </div>
          </div>

          {adhocRoutes.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Ad-hoc</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {adhocRoutes.map(renderRouteCard)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
