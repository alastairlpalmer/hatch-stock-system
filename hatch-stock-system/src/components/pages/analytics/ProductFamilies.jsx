import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import InfoTip from '../../ui/InfoTip';
import { formatCurrency } from '../../../utils/helpers';

/**
 * Product families: parent products ("Barebells", "Estate Dairy") rolled up
 * from their flavour variants, expandable to per-flavour sell rates. The share
 * bar is each flavour's slice of the family's units — the number that will
 * drive the suggested order split in a later phase.
 */
export default function ProductFamilies({ families, stockKnown }) {
  const [openId, setOpenId] = useState(null);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="px-6 pt-6 pb-3">
        <h3 className="text-sm font-medium text-zinc-400">
          Product Families
          <InfoTip
            width="w-72"
            text="Parent products rolled up from their flavour variants for the selected period and scope. Expand a family to compare flavour sell rates. Margin uses the same paid-only basis as the rest of the dashboard."
          />
        </h3>
      </div>

      {(!families || families.length === 0) ? (
        <p className="px-6 pb-6 text-sm text-zinc-500">
          No product groups configured yet — create them in Settings → Product Groups to see
          family-level performance here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-6 py-3 text-zinc-500 font-medium">Family</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Margin</th>
                <th className="text-right px-6 py-3 text-zinc-500 font-medium">Stock on Hand</th>
              </tr>
            </thead>
            <tbody>
              {families.map((f) => (
                <FamilyRows
                  key={f.id}
                  family={f}
                  stockKnown={stockKnown}
                  open={openId === f.id}
                  onToggle={() => setOpenId(openId === f.id ? null : f.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FamilyRows({ family, stockKnown, open, onToggle }) {
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <>
      <tr
        className="border-b border-zinc-800/50 hover:bg-zinc-800/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="px-6 py-3 text-zinc-200">
          <span className="inline-flex items-center gap-2">
            <Chevron className="w-4 h-4 text-zinc-500" />
            {family.name}
            <span className="text-xs text-zinc-500">
              {family.flavourCount} flavour{family.flavourCount === 1 ? '' : 's'}
            </span>
          </span>
        </td>
        <td className="text-right px-4 py-3 text-zinc-300">{family.units.toLocaleString('en-GB')}</td>
        <td className="text-right px-4 py-3 text-zinc-300">{formatCurrency(family.revenue)}</td>
        <td className="text-right px-4 py-3 text-zinc-300">
          {family.marginPct == null ? '—' : `${family.marginPct.toFixed(0)}%`}
        </td>
        <td className="text-right px-6 py-3 text-zinc-300">
          {stockKnown && family.stockOnHand != null ? family.stockOnHand : '—'}
        </td>
      </tr>
      {open && family.members.map((m) => (
        <tr key={m.sku} className="border-b border-zinc-800/30 bg-zinc-900/40">
          <td className="pl-14 pr-6 py-2">
            <div className="flex items-center gap-3">
              <span className="text-zinc-400 text-sm truncate w-48 shrink-0" title={m.sku}>{m.name}</span>
              <div className="flex-1 min-w-[6rem] bg-zinc-800/40 rounded h-1.5 overflow-hidden">
                <div
                  className="h-full bg-emerald-500/60 rounded"
                  style={{ width: `${m.unitsSharePct ?? 0}%` }}
                />
              </div>
              <span className="text-xs text-zinc-500 shrink-0 w-10 text-right">
                {m.unitsSharePct == null ? '—' : `${m.unitsSharePct.toFixed(0)}%`}
              </span>
            </div>
          </td>
          <td className="text-right px-4 py-2 text-zinc-400">{m.units.toLocaleString('en-GB')}</td>
          <td className="text-right px-4 py-2 text-zinc-400">{formatCurrency(m.revenue)}</td>
          <td className="text-right px-4 py-2 text-zinc-400">
            {m.marginPct == null ? '—' : `${m.marginPct.toFixed(0)}%`}
          </td>
          <td className="text-right px-6 py-2 text-zinc-400">
            {stockKnown && m.stockOnHand != null ? m.stockOnHand : '—'}
          </td>
        </tr>
      ))}
    </>
  );
}
