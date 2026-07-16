import React from 'react';
import { Minus, Plus } from 'lucide-react';

// Quantity input with −/+ steppers sized for warehouse thumbs. Numeric
// keypad on mobile (inputMode), value is always a number ≥ min; clearing
// the field snaps to min. Steppers let the common "count one more box"
// adjustment happen without summoning the keyboard at all.
export default function QtyInput({
  value,
  onChange,
  min = 0,
  max,
  invalid = false,
  className = '',
  'aria-label': ariaLabel = 'Quantity',
}) {
  const clamp = (n) => {
    let next = Math.max(min, n);
    if (max != null) next = Math.min(max, next);
    return next;
  };

  const step = (delta) => onChange(clamp((value || 0) + delta));

  const borderClass = invalid
    ? 'border-red-500 focus-within:border-red-500'
    : 'border-zinc-700 focus-within:border-emerald-500';

  return (
    <div className={`flex items-stretch rounded border bg-zinc-800 overflow-hidden ${borderClass} ${className}`}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={(value || 0) <= min}
        aria-label={`Decrease ${ariaLabel}`}
        className="w-10 min-h-[40px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 disabled:opacity-30 shrink-0"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        {...(max != null ? { max } : {})}
        value={value || ''}
        aria-label={ariaLabel}
        onChange={e => {
          const parsed = parseInt(e.target.value, 10);
          onChange(clamp(Number.isNaN(parsed) ? min : parsed));
        }}
        className="w-full min-w-0 bg-transparent text-center text-sm py-2 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => step(1)}
        disabled={max != null && (value || 0) >= max}
        aria-label={`Increase ${ariaLabel}`}
        className="w-10 min-h-[40px] flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 disabled:opacity-30 shrink-0"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
