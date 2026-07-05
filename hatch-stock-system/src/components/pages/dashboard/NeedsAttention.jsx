import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2, X, RotateCcw } from 'lucide-react';
import useNeedsAttention from '../../../hooks/useNeedsAttention';
import { useAuth } from '../../../context/AuthContext';

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';
const VISIBLE_ROWS = 6;

const DOT = {
  red: 'bg-red-400',
  amber: 'bg-amber-400',
};

// The Dashboard's action rail: a prioritised "what needs doing" list built
// from data mostly already in memory. Compact link rows (not big action
// cards — the rail can hold 10+ items). Free items show instantly; fetched
// items merge in without a spinner or layout flash.
//
// Admins can dismiss a row (server-shared — hidden for everyone). The
// dismissal is tied to the row's exact text and expires after 7 days, so a
// changed signal (e.g. a 4th pending order) resurfaces it automatically.
export default function NeedsAttention() {
  const { items, dismissedItems, allClear, dismiss, restore } = useNeedsAttention();
  const { isAdmin } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);

  // Mirror the Settings-page gate: with auth off the sole operator is the
  // admin in practice. The server enforces the same rule either way.
  const canDismiss = !AUTH_ENABLED || isAdmin;

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
            <div key={item.id} className="flex items-center gap-1 group">
              <Link
                to={item.to}
                className="flex items-center gap-3 px-2 py-2.5 hover:bg-zinc-800/40 rounded-lg flex-1 min-w-0"
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
              {canDismiss && (
                <button
                  onClick={() => dismiss(item)}
                  title="Dismiss — hides this until the numbers change (or 7 days)"
                  aria-label={`Dismiss: ${item.title}`}
                  className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 mt-2 px-2">
        {hidden > 0 && (
          <button onClick={() => setExpanded(true)} className="text-xs text-zinc-500 hover:text-zinc-300">
            +{hidden} more
          </button>
        )}
        {expanded && items.length > VISIBLE_ROWS && (
          <button onClick={() => setExpanded(false)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Show less
          </button>
        )}
        {dismissedItems.length > 0 && (
          <button
            onClick={() => setShowDismissed((s) => !s)}
            className="text-xs text-zinc-600 hover:text-zinc-400"
          >
            {showDismissed ? 'Hide dismissed' : `${dismissedItems.length} dismissed`}
          </button>
        )}
      </div>

      {showDismissed && dismissedItems.length > 0 && (
        <div className="mt-2 border-t border-zinc-800/60 pt-2 divide-y divide-zinc-800/40">
          {dismissedItems.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-2 py-2 opacity-60">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[item.severity] || DOT.amber}`} />
              <span className="flex-1 min-w-0 text-sm text-zinc-400 truncate">{item.title}</span>
              {canDismiss && (
                <button
                  onClick={() => restore(item.id)}
                  title="Restore this item"
                  className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 flex-shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
