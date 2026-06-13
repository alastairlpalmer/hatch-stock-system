import React from 'react';
import InfoTip from '../../ui/InfoTip';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

// Emerald wash whose opacity scales with intensity (0..1).
function cellStyle(value, max) {
  if (!value) return { backgroundColor: 'rgba(63,63,70,0.25)' }; // zinc-700/25 for empty
  const intensity = value / max;
  return { backgroundColor: `rgba(16,185,129,${(0.15 + 0.85 * intensity).toFixed(3)})` };
}

function hourLabel(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * Sales timing: a day-of-week × hour-of-day heatmap (transaction counts) plus a
 * day-of-week bar row. All buckets are in Europe/London local time, converted
 * from the stored UTC timestamps so peak hours read as real local times.
 */
export default function SalesTiming({ timing }) {
  const { byDayOfWeek, byHour, byDowHour, busiestDay, busiestHour, timezone } = timing;
  const maxCell = Math.max(1, ...byDowHour.flat());
  const maxDay = Math.max(1, ...byDayOfWeek.map((d) => d.transactions));
  const hasData = byDayOfWeek.some((d) => d.transactions > 0);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-medium text-zinc-400">
          Sales Timing
          <InfoTip
            width="w-72"
            text={`When sales happen, bucketed by day of week and hour of day. Each timestamp is converted from UTC to ${timezone} (handling BST) before bucketing, so peak times reflect real local clock time. Heatmap and bars count transactions.`}
          />
        </h3>
        {hasData && busiestDay && busiestHour && (
          <span className="text-xs text-zinc-400">
            Peak: <span className="text-emerald-400">{busiestDay.label}</span> around{' '}
            <span className="text-emerald-400">{hourLabel(busiestHour.hour)}</span>
            <span className="text-zinc-600"> ({timezone})</span>
          </span>
        )}
      </div>

      {!hasData ? (
        <p className="text-sm text-zinc-500">Insufficient data — no sales in the selected period.</p>
      ) : (
        <>
          {/* Heatmap */}
          <div>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                {/* hour axis */}
                <div className="flex items-center mb-1">
                  <div className="w-10 shrink-0" />
                  <div className="grid flex-1" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div key={h} className="text-[9px] text-zinc-600 text-center">
                        {HOUR_LABELS.includes(h) ? h : ''}
                      </div>
                    ))}
                  </div>
                </div>
                {/* rows */}
                {byDowHour.map((row, dow) => (
                  <div key={dow} className="flex items-center mb-0.5">
                    <div className="w-10 shrink-0 text-[10px] text-zinc-500">{DOW_SHORT[dow]}</div>
                    <div className="grid flex-1 gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                      {row.map((v, h) => (
                        <div
                          key={h}
                          className="h-4 rounded-[2px]"
                          style={cellStyle(v, maxCell)}
                          title={`${DOW_SHORT[dow]} ${hourLabel(h)} — ${v} transaction${v === 1 ? '' : 's'}`}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[10px] text-zinc-600">
              <span>Fewer</span>
              <div className="flex gap-0.5">
                {[0.15, 0.35, 0.55, 0.75, 1].map((a) => (
                  <div key={a} className="w-4 h-3 rounded-[2px]" style={{ backgroundColor: `rgba(16,185,129,${a})` }} />
                ))}
              </div>
              <span>More transactions</span>
            </div>
          </div>

          {/* Day-of-week bars */}
          <div>
            <div className="text-xs text-zinc-500 mb-2">
              By day of week
              <InfoTip text="Total transactions on each weekday across the whole selected period (not an average)." />
            </div>
            <div className="space-y-1.5">
              {byDayOfWeek.map((d) => (
                <div key={d.dow} className="flex items-center gap-3">
                  <div className="w-10 shrink-0 text-[11px] text-zinc-500">{DOW_SHORT[d.dow]}</div>
                  <div className="flex-1 bg-zinc-800/40 rounded h-4 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/70 rounded"
                      style={{ width: `${(d.transactions / maxDay) * 100}%` }}
                    />
                  </div>
                  <div className="w-24 shrink-0 text-right text-[11px] text-zinc-400">
                    {d.transactions.toLocaleString('en-GB')} txns
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
