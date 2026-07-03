import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useStock } from '../../../context/StockContext';
import { formatCurrency } from '../../../utils/helpers';

// Recent-transactions digest for the mobile home page. Renders from the
// in-memory sales slice (zero extra fetch); the full 6-tab SalesOverview
// stays one tap away. Field fallbacks mirror SalesOverview's normalizeSale.
const DIGEST_ROWS = 10;

export default function SalesDigest() {
  const { data } = useStock();

  const recent = (data.salesData || [])
    .filter((s) => !(s.isRefunded ?? s.is_refunded ?? false))
    .slice()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, DIGEST_ROWS);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-hidden">
      {recent.length === 0 ? (
        <p className="text-sm text-zinc-600 px-4 py-6 text-center">No sales yet.</p>
      ) : (
        <div className="divide-y divide-zinc-800/70">
          {recent.map((s) => {
            const when = new Date(s.timestamp);
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">
                    {s.productName || s.product_name || s.sku || 'Unknown'}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {s.locationName || 'Unknown'} ·{' '}
                    {Number.isNaN(when.getTime())
                      ? ''
                      : when.toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <span className="text-sm text-zinc-300 flex-shrink-0">
                  {formatCurrency(s.charged ?? s.price ?? 0)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <Link
        to="/sales"
        className="flex items-center justify-center gap-2 px-4 py-3 border-t border-zinc-800 text-sm text-emerald-400 hover:text-emerald-300 active:bg-zinc-800/50"
      >
        Open full sales
        <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
