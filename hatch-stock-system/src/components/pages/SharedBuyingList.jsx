import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import HatchLogo from '../ui/HatchLogo';
import buyingListsService from '../../services/buyingLists.service';

// Public, read-only view of a shared buying list — rendered outside the authed
// layout at /share/buying-list/:token. Mobile-first, minimal chrome.

function formatDate(iso, fmt = 'EEEE d MMMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

function groupBySupplier(items) {
  const groups = new Map();
  (items || []).forEach(item => {
    const key = item.supplierId || item.supplierName || '__none__';
    if (!groups.has(key)) {
      groups.set(key, {
        supplierName: item.supplierName || 'No preferred supplier',
        items: [],
      });
    }
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}

function boxesFor(item) {
  const upb = item.unitsPerBox || 1;
  return upb > 1 ? Math.ceil((item.quantity || 0) / upb) : null;
}

const PRINT_STYLES = `
  .share-print-title { display: none; }
  @media print {
    body { background: #fff !important; }
    .share-page { background: #fff !important; color: #111 !important; min-height: 0 !important; }
    .share-page * {
      background: transparent !important;
      color: #111 !important;
      border-color: #ddd !important;
      box-shadow: none !important;
    }
    .share-page .share-supplier-head { border-bottom: 2px solid #059669 !important; }
    .share-no-print { display: none !important; }
    .share-print-title { display: block; font-weight: 700; font-size: 20px; }
  }
`;

export default function SharedBuyingList() {
  const { token } = useParams();
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    (async () => {
      try {
        const res = await buyingListsService.getShared(token);
        if (!cancelled) setList(res);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) setNotFound(true);
        else setError('Could not load this list — check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const groups = list ? groupBySupplier(list.items) : [];
  const totalUnits = (list?.items || []).reduce((a, i) => a + (i.quantity || 0), 0);
  const totalBoxes = (list?.items || []).reduce((a, i) => a + (boxesFor(i) || 0), 0);
  const totalLines = (list?.items || []).length;

  return (
    <div className="share-page min-h-screen bg-zinc-950 text-zinc-100">
      <style>{PRINT_STYLES}</style>

      {/* Minimal header — small Hatch wordmark, no sidebar/nav */}
      <header className="border-b border-zinc-800 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="share-no-print h-6 flex items-center">
            <div className="scale-75 origin-left">
              <HatchLogo />
            </div>
          </div>
          <span className="share-print-title">Hatch</span>
          <span className="text-xs text-zinc-500">Buying list</span>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {loading ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
            <p className="text-zinc-400 text-sm">Loading…</p>
          </div>
        ) : notFound ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center space-y-2">
            <p className="text-2xl">🤔</p>
            <p className="text-zinc-200 font-medium">This list isn't available</p>
            <p className="text-zinc-500 text-sm">
              The link may have expired or the list may have been deleted.
              Ask whoever shared it for a fresh link.
            </p>
          </div>
        ) : error ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold text-zinc-100">{list.name || 'Buying list'}</h1>
              {list.targetDate && (
                <p className="text-sm text-zinc-400 mt-1">
                  For restock on <span className="text-zinc-200">{formatDate(list.targetDate)}</span>
                </p>
              )}
              <p className="text-xs text-zinc-500 mt-1">
                {totalLines} line{totalLines === 1 ? '' : 's'} · {totalUnits} units
                {totalBoxes > 0 && ` · ${totalBoxes} boxes`}
              </p>
            </div>

            {groups.length === 0 ? (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
                <p className="text-zinc-400 text-sm">This list has no items.</p>
              </div>
            ) : (
              groups.map(group => {
                const groupUnits = group.items.reduce((a, i) => a + (i.quantity || 0), 0);
                const groupBoxes = group.items.reduce((a, i) => a + (boxesFor(i) || 0), 0);
                return (
                  <section key={group.supplierName} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                    <div className="share-supplier-head flex items-center justify-between px-4 py-3 bg-zinc-800/60">
                      <h2 className="text-sm font-medium text-teal-400">{group.supplierName}</h2>
                      <span className="text-xs text-zinc-500">
                        {groupUnits} units{groupBoxes > 0 && ` · ${groupBoxes} boxes`}
                      </span>
                    </div>
                    <ul className="divide-y divide-zinc-800/60">
                      {group.items.map((item, i) => {
                        const boxes = boxesFor(item);
                        return (
                          <li key={`${item.sku || item.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <span className="text-sm text-zinc-200 min-w-0">
                              {item.name || item.sku}
                            </span>
                            <span className="text-sm text-zinc-300 whitespace-nowrap">
                              × {item.quantity}
                              {boxes != null && (
                                <span className="text-zinc-500 text-xs ml-1.5">
                                  ({boxes} box{boxes === 1 ? '' : 'es'} of {item.unitsPerBox})
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}

            {list.notes && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500 mb-1">Notes</p>
                <p className="text-sm text-zinc-300 whitespace-pre-wrap">{list.notes}</p>
              </div>
            )}

            <footer className="text-center text-xs text-zinc-600 pt-2 pb-6">
              Shared from the Hatch stock system
              {list.createdAt && ` · created ${formatDate(list.createdAt, 'd MMM yyyy')}`}
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
