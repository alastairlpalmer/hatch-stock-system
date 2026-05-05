import React, { useEffect } from 'react';

/**
 * Brief flash toast surfaced inside the scanner overlay after a scan.
 * `kind` controls colour: 'success' (green), 'warn' (yellow), 'error' (red).
 * Auto-dismisses after `durationMs`.
 */
export default function ScanResultToast({
  open,
  kind = 'success',
  message,
  detail,
  durationMs = 1400,
  onDone,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => {
      onDone?.();
    }, durationMs);
    return () => clearTimeout(id);
  }, [open, durationMs, onDone]);

  if (!open) return null;

  const palette = {
    success: 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300',
    warn: 'bg-amber-500/20 border-amber-500/60 text-amber-300',
    error: 'bg-red-500/20 border-red-500/60 text-red-300',
  }[kind] || 'bg-zinc-700 border-zinc-600 text-zinc-200';

  return (
    <div
      className={`pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 px-4 py-2 rounded-lg border text-sm font-medium shadow-lg backdrop-blur-sm ${palette}`}
      role="status"
      aria-live="polite"
    >
      <div>{message}</div>
      {detail && <div className="text-xs opacity-80 mt-0.5">{detail}</div>}
    </div>
  );
}
