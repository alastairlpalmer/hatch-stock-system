import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import HatchLogo from '../ui/HatchLogo';
import planogramService from '../../services/planogram.service';

/**
 * Public, read-only 3PL restock sheet — rendered outside the authed layout at
 * /share/restock-sheet/:token (same pattern as SharedBuyingList: the
 * unguessable token is the credential). Mobile-first for a restocker working
 * off a phone in front of the machine, print-friendly for paper handoff.
 *
 * One row per slot in walking order (shelf 1 = top, A = leftmost). "Add"
 * quantities are target-level: a product spanning several slots carries its
 * add on the first slot and the other slots reference it. Rows tap to tick
 * off — purely local state, a working aid, nothing is written back.
 */

const PRINT_STYLES = `
  .sheet-print-title { display: none; }
  @media print {
    body { background: #fff !important; }
    .sheet-page { background: #fff !important; color: #111 !important; min-height: 0 !important; }
    .sheet-page * {
      background: transparent !important;
      color: #111 !important;
      border-color: #ddd !important;
      box-shadow: none !important;
    }
    .sheet-page .sheet-shelf-head { border-bottom: 2px solid #059669 !important; }
    .sheet-no-print { display: none !important; }
    .sheet-print-title { display: block; font-weight: 700; font-size: 20px; }
  }
`;

function formatDate(iso, fmt = "EEEE d MMMM yyyy 'at' HH:mm") {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

export default function RestockSheet() {
  const { token } = useParams();
  const [sheet, setSheet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);
  const [ticked, setTicked] = useState({}); // slotCode -> bool, local working aid

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);
    (async () => {
      try {
        const res = await planogramService.getRestockSheet(token);
        if (!cancelled) setSheet(res);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 404) setNotFound(true);
        else setError('Could not load this sheet — check your connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const byShelf = React.useMemo(() => {
    const groups = new Map();
    for (const row of sheet?.rows || []) {
      if (!groups.has(row.shelf)) groups.set(row.shelf, []);
      groups.get(row.shelf).push(row);
    }
    return [...groups.entries()].sort(([a], [b]) => a - b);
  }, [sheet]);

  if (loading) {
    return <Shell><p className="text-zinc-500 text-sm py-16 text-center">Loading restock sheet…</p></Shell>;
  }
  if (notFound) {
    return <Shell><p className="text-zinc-400 text-sm py-16 text-center">This restock sheet link is not valid.</p></Shell>;
  }
  if (error) {
    return <Shell><p className="text-red-400 text-sm py-16 text-center">{error}</p></Shell>;
  }

  const doneCount = (sheet.rows || []).filter((r) => ticked[r.slotCode]).length;

  return (
    <Shell>
      <style>{PRINT_STYLES}</style>
      <div className="sheet-print-title">Hatch — Restock Sheet</div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">{sheet.locationName}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Restock sheet · slot codes read shelf then position — 1A is top-left.
          </p>
          {sheet.stockUpdatedAt && (
            <p className="text-xs text-zinc-500">Stock levels as of {formatDate(sheet.stockUpdatedAt)}.</p>
          )}
        </div>
        <div className="flex items-center gap-2 sheet-no-print">
          <span className="text-xs text-zinc-500">{doneCount}/{sheet.rows.length} done</span>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 rounded text-sm bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700"
          >
            Print
          </button>
        </div>
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 text-sm text-emerald-300">
        Total to add: <strong>{sheet.totalAdd}</strong> units
        <span className="text-emerald-500/70"> · tap a row to tick it off as you go</span>
      </div>

      {byShelf.map(([shelf, rows]) => (
        <div key={shelf} className="rounded-lg overflow-hidden border border-zinc-800">
          <div className="sheet-shelf-head bg-zinc-800/80 px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-300">
            Shelf {shelf}{shelf === 1 ? ' (top)' : ''}
          </div>
          <div>
            {rows.map((row) => {
              const done = !!ticked[row.slotCode];
              return (
                <button
                  key={row.slotCode}
                  onClick={() => setTicked((t) => ({ ...t, [row.slotCode]: !t[row.slotCode] }))}
                  className={`w-full flex items-center gap-3 px-4 py-3 border-b border-zinc-800/60 last:border-b-0 text-left transition-colors ${
                    done ? 'bg-emerald-500/5 opacity-50' : 'bg-zinc-900/40 hover:bg-zinc-800/40'
                  }`}
                >
                  <span className={`sheet-no-print shrink-0 w-5 h-5 rounded border flex items-center justify-center text-xs ${
                    done ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-zinc-600 text-transparent'
                  }`}>✓</span>
                  <span className="shrink-0 w-9 font-mono text-sm text-zinc-400">{row.slotCode}</span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm truncate ${row.isGroup ? 'text-teal-300' : 'text-zinc-200'} ${done ? 'line-through' : ''}`}>
                      {row.label}
                    </span>
                    {row.isGroup && <span className="block text-[11px] text-zinc-500">fresh meals — any flavour</span>}
                    {!row.primary && (
                      <span className="block text-[11px] text-zinc-500">counted with {row.primarySlotCode}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    {row.primary ? (
                      row.add != null ? (
                        <>
                          <span className={`block text-base font-semibold ${row.add > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                            {row.add > 0 ? `+${row.add}` : 'full'}
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            {row.current} → {row.target}{row.slotCount > 1 ? ` · ${row.slotCount} slots` : ''}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="block text-sm text-amber-400">fill</span>
                          <span className="block text-[11px] text-zinc-500">{row.current} in machine · no target set</span>
                        </>
                      )
                    ) : (
                      <span className="block text-sm text-zinc-600">↑</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p className="text-xs text-zinc-600 pb-8">
        Generated {formatDate(sheet.generatedAt)} · Hatch stock system
      </p>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="sheet-page min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <div className="sheet-no-print"><HatchLogo /></div>
        {children}
      </div>
    </div>
  );
}
