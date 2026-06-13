import React from 'react';
import InfoTip from '../../ui/InfoTip';
import { formatCurrency } from '../../../utils/helpers';

function MarginTable({ rows, empty }) {
  if (!rows || rows.length === 0) return <p className="px-6 pb-6 text-sm text-zinc-500">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-800">
          <th className="text-left px-6 py-3 text-zinc-500 font-medium">Product</th>
          <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units</th>
          <th className="text-right px-4 py-3 text-zinc-500 font-medium">Price (avg)</th>
          <th className="text-right px-4 py-3 text-zinc-500 font-medium">Cost (avg)</th>
          <th className="text-right px-6 py-3 text-zinc-500 font-medium">Margin %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const avgPrice = p.units > 0 ? p.revenue / p.units : 0;
          const avgCost = p.units > 0 ? p.cost / p.units : 0;
          const low = p.marginPct != null && p.marginPct < 25;
          return (
            <tr key={p.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
              <td className="px-6 py-3 text-zinc-200">{p.name}</td>
              <td className="text-right px-4 py-3 text-zinc-300">{p.units.toLocaleString('en-GB')}</td>
              <td className="text-right px-4 py-3 text-zinc-300">{formatCurrency(avgPrice)}</td>
              <td className="text-right px-4 py-3 text-zinc-500">{formatCurrency(avgCost)}</td>
              <td className={`text-right px-6 py-3 ${low ? 'text-red-400' : 'text-zinc-300'}`}>
                {p.marginPct != null ? `${p.marginPct.toFixed(1)}%` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Margin & pricing analysis: portfolio margin plus per-product margin sorted by
 * lowest margin and by highest volume. Margin needs a cost price; products with
 * no recorded cost show "—" rather than a misleading 0%.
 */
export default function MarginAnalysis({ margin }) {
  const { portfolioMarginPct, byLowestMargin, byHighestVolume } = margin;

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 inline-block">
        <div className="text-2xl font-bold text-zinc-100">
          {portfolioMarginPct != null ? `${portfolioMarginPct.toFixed(1)}%` : '—'}
        </div>
        <div className="text-xs text-zinc-500 mt-1">
          Portfolio Margin
          <InfoTip
            width="w-72"
            text="(Total revenue − total cost) ÷ total revenue across all products in scope. This is the benchmark the 'price increase' suggestions compare each product against. Cost comes from each sale's recorded cost price; sales with no cost contribute £0 cost."
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 pt-6 pb-3">
            <h3 className="text-sm font-medium text-zinc-400">
              Lowest Margin
              <InfoTip
                width="w-72"
                text="Products with the lowest margin % (sold in the period, with a known cost). Margin % = (revenue − cost) ÷ revenue. Values under 25% are highlighted red."
              />
            </h3>
          </div>
          <MarginTable rows={byLowestMargin} empty="Insufficient data — no products with a recorded cost in the period." />
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <div className="px-6 pt-6 pb-3">
            <h3 className="text-sm font-medium text-zinc-400">
              Highest Volume
              <InfoTip text="Best-selling products by units, shown with their margin so high-volume / low-margin lines (price-increase candidates) stand out." />
            </h3>
          </div>
          <MarginTable rows={byHighestVolume} empty="Insufficient data — no sales in the period." />
        </div>
      </div>
    </div>
  );
}
