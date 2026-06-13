import React from 'react';
import InfoTip from '../../ui/InfoTip';
import { formatCurrency } from '../../../utils/helpers';

function ChangeBadge({ pct }) {
  if (pct == null) {
    return <span className="text-xs text-zinc-600">vs previous: insufficient data</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`text-xs ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs previous period
    </span>
  );
}

/**
 * Headline stats row: units, revenue, transactions, avg transaction value, each
 * with its % change vs the equal-length preceding period. Every tile carries an
 * (i) tooltip stating how the number is computed.
 */
export default function HeadlineStats({ headline, period }) {
  const days = period?.days ? Math.round(period.days) : null;
  const sameLen = days ? `the preceding ${days}-day period` : 'the preceding equal-length period';

  const tiles = [
    {
      label: 'Units Sold',
      value: headline.units.toLocaleString('en-GB'),
      pct: headline.change?.unitsPct,
      tip: `Sum of quantity across every non-refunded sale in the period. A multi-unit sale counts each unit. Compared with ${sameLen}.`,
    },
    {
      label: 'Revenue',
      value: formatCurrency(headline.revenue),
      pct: headline.change?.revenuePct,
      tip: `Sum of amount charged on non-refunded sales — what customers actually paid after discounts. Refunds excluded. Compared with ${sameLen}.`,
    },
    {
      label: 'Transactions',
      value: headline.transactions.toLocaleString('en-GB'),
      pct: headline.change?.transactionsPct,
      tip: `Count of non-refunded sale lines in the period. Compared with ${sameLen}.`,
    },
    {
      label: 'Avg Transaction',
      value: formatCurrency(headline.avgTransactionValue),
      pct: headline.change?.avgTransactionPct,
      tip: `Revenue ÷ transactions for the period. % change is computed from the average values, not the totals.`,
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
          <div className="text-2xl font-bold text-zinc-100">{t.value}</div>
          <div className="text-xs text-zinc-500 mt-1">
            {t.label}
            <InfoTip text={t.tip} />
          </div>
          <div className="mt-2">
            <ChangeBadge pct={t.pct} />
          </div>
        </div>
      ))}
    </div>
  );
}
