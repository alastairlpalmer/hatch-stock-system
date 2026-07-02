import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ClipboardList, Plus, ChevronRight } from 'lucide-react';
import buyingListsService from '../../../services/buyingLists.service';

const STATUS_STYLES = {
  draft: 'bg-amber-500/20 text-amber-400',
  ordered: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-zinc-700 text-zinc-400',
};

function StatusChip({ status }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[status] || STATUS_STYLES.archived}`}>
      {status}
    </span>
  );
}

function formatDate(iso, fmt = 'EEE d MMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

function estimatedTotal(list) {
  return (list.items || []).reduce((a, i) => a + (i.quantity || 0) * (i.unitCost || 0), 0);
}

export default function BuyingLists() {
  const navigate = useNavigate();
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await buyingListsService.getAll();
        if (!cancelled) setLists(res || []);
      } catch (err) {
        console.error('Failed to load buying lists:', err);
        if (!cancelled) setError('Failed to load buying lists — check the connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Newest first, defensively — the API already returns newest-first.
  const sorted = [...lists].sort(
    (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Buying Lists</h2>
        <button
          onClick={() => navigate('/orders/purchase?generate=1')}
          className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
        >
          <Plus size={16} />
          New buying list
        </button>
      </div>

      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400 text-sm">Loading buying lists…</p>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <ClipboardList size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-300 font-medium">No buying lists yet</p>
          <p className="text-zinc-500 text-sm mt-1">
            Plan a weekly buy from Purchase Orders and save it as a buying list.
          </p>
          <button
            onClick={() => navigate('/orders/purchase?generate=1')}
            className="mt-4 px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            Plan weekly buy
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map(list => {
            const lines = (list.items || []).length;
            const total = estimatedTotal(list);
            return (
              <button
                key={list.id}
                onClick={() => navigate(`/orders/buying-lists/${list.id}`)}
                className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors group"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-zinc-200 truncate">{list.name || 'Untitled list'}</span>
                      <StatusChip status={list.status} />
                    </div>
                    <div className="text-sm text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                      {list.targetDate && (
                        <span>Target: <span className="text-zinc-400">{formatDate(list.targetDate)}</span></span>
                      )}
                      <span>{lines} line{lines === 1 ? '' : 's'}</span>
                      {total > 0 && <span className="text-emerald-400">£{total.toFixed(2)} est.</span>}
                      {list.createdAt && (
                        <span className="text-zinc-600">Created {formatDate(list.createdAt, 'd MMM yyyy')}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
