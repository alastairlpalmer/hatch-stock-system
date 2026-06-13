import React from 'react';
import InfoTip from '../../ui/InfoTip';
import { formatCurrency } from '../../../utils/helpers';

function RankList({ rows, valueOf, render, empty }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  const max = Math.max(1, ...rows.map(valueOf));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.sku} className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-zinc-300 truncate">{r.name}</span>
              <span className="text-sm text-zinc-400 shrink-0">{render(r)}</span>
            </div>
            <div className="mt-1 bg-zinc-800/40 rounded h-1.5 overflow-hidden">
              <div className="h-full bg-emerald-500/60 rounded" style={{ width: `${(valueOf(r) / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Product performance: top sellers by units and by revenue, category mix, and
 * slow movers (lowest sales that still have stock on hand).
 */
export default function ProductPerformance({ products, stockKnown }) {
  const { topByUnits, topByRevenue, slowMovers, categories } = products;
  const totalUnits = categories.reduce((a, c) => a + c.units, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">
            Top Sellers — by Units
            <InfoTip text="Products ranked by total units sold (non-refunded) in the period. Bar length is relative to the top product." />
          </h3>
          <RankList
            rows={topByUnits}
            valueOf={(r) => r.units}
            render={(r) => `${r.units.toLocaleString('en-GB')} units`}
            empty="Insufficient data — no sales in the period."
          />
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">
            Top Sellers — by Revenue
            <InfoTip text="Products ranked by revenue (amount charged, refunds excluded) in the period." />
          </h3>
          <RankList
            rows={topByRevenue}
            valueOf={(r) => r.revenue}
            render={(r) => formatCurrency(r.revenue)}
            empty="Insufficient data — no sales in the period."
          />
        </div>
      </div>

      {/* Category mix */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">
          Category Mix
          <InfoTip text="Share of units sold by product category. Products with no category set are grouped as 'Other'." />
        </h3>
        {categories.length === 0 || totalUnits === 0 ? (
          <p className="text-sm text-zinc-500">Insufficient data — no sales in the period.</p>
        ) : (
          <div className="space-y-2">
            {categories.map((c) => {
              const share = (c.units / totalUnits) * 100;
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <div className="w-32 shrink-0 text-sm text-zinc-300 truncate">{c.category}</div>
                  <div className="flex-1 bg-zinc-800/40 rounded h-3 overflow-hidden">
                    <div className="h-full bg-emerald-500/60 rounded" style={{ width: `${share}%` }} />
                  </div>
                  <div className="w-28 shrink-0 text-right text-xs text-zinc-400">
                    {c.units.toLocaleString('en-GB')} units · {share.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Slow movers */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <div className="px-6 pt-6 pb-3">
          <h3 className="text-sm font-medium text-zinc-400">
            Slow Movers
            <InfoTip
              width="w-72"
              text="Products that still have stock on hand but sold the fewest units in the period — candidates to relocate or delist. Stock on hand is summed from location_stock for the selected scope."
            />
          </h3>
        </div>
        {!stockKnown ? (
          <p className="px-6 pb-6 text-sm text-zinc-500">
            Stock on hand could not be resolved for this location selection, so slow movers are unavailable. (The selected
            name(s) don't match a known location record.)
          </p>
        ) : slowMovers.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-zinc-500">No products with stock on hand in this scope.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Sold</th>
                <th className="text-right px-6 py-3 text-zinc-500 font-medium">Stock on Hand</th>
              </tr>
            </thead>
            <tbody>
              {slowMovers.map((p) => (
                <tr key={p.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-6 py-3 text-zinc-200">{p.name}</td>
                  <td className="px-4 py-3 text-zinc-500">{p.category}</td>
                  <td className="text-right px-4 py-3 text-zinc-300">{p.units.toLocaleString('en-GB')}</td>
                  <td className="text-right px-6 py-3 text-amber-400">{p.stockOnHand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
