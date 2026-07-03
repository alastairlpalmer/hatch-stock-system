import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import useNeedsAttention from '../../../hooks/useNeedsAttention';

const VISIBLE_ROWS = 6;

const DOT = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
};

// The Dashboard's action rail: a prioritised "what needs doing" list built
// from data mostly already in memory. Compact link rows (not big action
// cards — the rail can hold 10+ items). Free items show instantly; fetched
// items merge in without a spinner or layout flash.
export default function NeedsAttention() {
  const { items, allClear } = useNeedsAttention();
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? items : items.slice(0, VISIBLE_ROWS);
  const hidden = items.length - visible.length;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
      <h3 className="text-sm font-medium text-zinc-400 mb-3">Needs attention</h3>

      {allClear ? (
        <div className="flex items-center gap-3 px-2 py-2 text-sm text-emerald-400">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          All clear — nothing needs attention
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60">
          {visible.map((item) => (
            <Link
              key={item.id}
              to={item.to}
              className="flex items-center gap-3 px-2 py-2.5 hover:bg-zinc-800/40 rounded-lg group"
            >
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[item.severity] || DOT.amber}`} />
              <span className="flex-1 min-w-0">
                <span className="text-sm text-zinc-200">{item.title}</span>
                {item.detail && (
                  <span className="text-xs text-zinc-500 ml-2">{item.detail}</span>
                )}
              </span>
              <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="mt-2 px-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          +{hidden} more
        </button>
      )}
      {expanded && items.length > VISIBLE_ROWS && (
        <button
          onClick={() => setExpanded(false)}
          className="mt-2 px-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Show less
        </button>
      )}
    </div>
  );
}
