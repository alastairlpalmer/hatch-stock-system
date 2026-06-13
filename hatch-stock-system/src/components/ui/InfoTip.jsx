import React from 'react';

/**
 * Small hoverable (i) marker with an explanatory tooltip. Used across the Sales
 * analytics dashboard so every metric and every suggestion can show exactly how
 * it is calculated. Extracted from SalesOverview's inline copy.
 */
export default function InfoTip({ text, width = 'w-64' }) {
  return (
    <span className="relative inline-block group align-middle ml-1.5">
      <span className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-zinc-600 text-zinc-500 text-[9px] leading-none cursor-help select-none group-hover:text-zinc-300 group-hover:border-zinc-400 transition-colors">
        i
      </span>
      <span className={`invisible group-hover:visible absolute top-full left-1/2 -translate-x-1/2 mt-2 ${width} bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-300 text-left font-normal normal-case shadow-xl z-30 whitespace-normal`}>
        {text}
      </span>
    </span>
  );
}
