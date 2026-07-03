import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

// Shared action-hub card (extracted from OrdersHub/RestockHub so mobile and
// desktop surfaces can't drift). Width-agnostic — grid wrappers are the
// caller's job.
//
// Badge tones are a LITERAL class map: Tailwind's JIT purge only keeps
// classes it can see verbatim, so interpolated strings would silently render
// unstyled.
const BADGE_TONES = {
  amber: 'bg-amber-500/15 text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  red: 'bg-red-500/15 text-red-400',
};

export default function ActionCard({ to, icon: Icon, title, description, badge, badgeTone = 'amber' }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 min-h-[72px] px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-emerald-500/60 active:bg-zinc-800/50 transition-colors"
    >
      <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          {badge && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded ${BADGE_TONES[badgeTone] || BADGE_TONES.amber}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
      </div>
      <ChevronRight className="w-5 h-5 text-zinc-600 flex-shrink-0" />
    </Link>
  );
}
