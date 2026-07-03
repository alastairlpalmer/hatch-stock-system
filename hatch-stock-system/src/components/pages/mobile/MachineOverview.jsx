import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { inventoryService } from '../../../services/inventory.service';

// "Stock in machines" digest for the mobile home page: one card per active
// location, built from data already in StockContext (no fetch for the core
// numbers). The expiry chip comes from ONE machine-expiry call for the whole
// section, fail-silent like the Dashboard panel — chips just don't render if
// the endpoint is unreachable.
export default function MachineOverview() {
  const { data } = useStock();
  const [expiringByLocation, setExpiringByLocation] = useState({});

  useEffect(() => {
    let cancelled = false;
    inventoryService.getMachineExpiry(7)
      .then((res) => {
        if (cancelled) return;
        const grouped = {};
        (res.rows || []).forEach((row) => {
          grouped[row.locationId] = (grouped[row.locationId] || 0) + 1;
        });
        setExpiringByLocation(grouped);
      })
      .catch((err) => console.error('Machine expiry fetch failed:', err));
    return () => { cancelled = true; };
  }, []);

  const locations = (data.locations || []).filter((l) => !l.archivedAt);

  if (locations.length === 0) {
    return (
      <p className="text-sm text-zinc-600 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-6 text-center">
        No locations configured yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {locations.map((loc) => {
        const stock = data.locationStock?.[loc.id] || {};
        const config = data.locationConfig?.[loc.id] || {};
        const units = Object.values(stock).reduce((a, q) => a + (q || 0), 0);
        const capacity = Object.values(config).reduce((a, c) => a + (c?.maxStock || 0), 0);

        let out = 0;
        let low = 0;
        Object.entries(config).forEach(([sku, c]) => {
          const qty = stock[sku] || 0;
          if (c?.maxStock != null || c?.minStock != null) {
            if (qty === 0) out += 1;
            else if (c?.minStock != null && qty < c.minStock) low += 1;
          }
        });
        const expiring = expiringByLocation[loc.id] || 0;

        return (
          <Link
            key={loc.id}
            to="/locations"
            className="flex items-center gap-3 px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-zinc-700 active:bg-zinc-800/50"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-100 truncate">{loc.name}</p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs text-zinc-500">
                  {units.toLocaleString('en-GB')}{capacity > 0 ? ` / ${capacity.toLocaleString('en-GB')}` : ''} units
                </span>
                {out > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">{out} out</span>
                )}
                {low > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">{low} low</span>
                )}
                {expiring > 0 && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                    {expiring} expiring soon
                  </span>
                )}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
