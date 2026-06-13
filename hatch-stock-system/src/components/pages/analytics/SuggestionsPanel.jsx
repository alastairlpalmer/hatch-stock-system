import React from 'react';
import InfoTip from '../../ui/InfoTip';

const SEVERITY = {
  opportunity: { dot: 'bg-emerald-400', label: 'Opportunity', chip: 'bg-emerald-500/15 text-emerald-400' },
  warning: { dot: 'bg-amber-400', label: 'Action', chip: 'bg-amber-500/15 text-amber-400' },
};

/**
 * Rule-based suggestions. Each card shows the recommendation and an (i) tooltip
 * carrying the exact `calc` string from the backend — the numbers that fired the
 * rule — so nothing is a black box.
 */
export default function SuggestionsPanel({ suggestions, insufficientData }) {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
      <h3 className="text-sm font-medium text-zinc-400 mb-1">
        Suggestions
        <InfoTip
          width="w-80"
          text="Rule-based prompts computed from this period's figures — not predictions. Rules: (A) high velocity (≥2 units/day) with below-average margin → price increase; (B) zero sales with stock on hand → delist/relocate; (C) top-quartile seller with zero stock → possible lost sales. Each card's (i) shows the exact numbers that triggered it."
        />
      </h3>
      <p className="text-xs text-zinc-600 mb-4">Every suggestion cites the figures behind it — hover the (i) on each card.</p>

      {insufficientData?.comparison ? (
        <p className="text-sm text-zinc-500">Select a date range to generate suggestions (velocity needs a period length).</p>
      ) : suggestions.length === 0 ? (
        <p className="text-sm text-zinc-500">No suggestions for this period — nothing tripped a rule threshold.</p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((s, i) => {
            const sev = SEVERITY[s.severity] || SEVERITY.warning;
            return (
              <div
                key={`${s.rule}-${s.sku}-${i}`}
                className="flex items-start gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40"
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sev.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-zinc-200 font-medium">{s.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${sev.chip}`}>{s.title}</span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {s.message}
                    <InfoTip width="w-80" text={s.calc} />
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
