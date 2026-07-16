import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

// Shared search box: leading icon, clear button, and a short debounce so
// keystrokes repaint instantly while the (client-side) filtering work runs
// at most every `delay` ms. Every list search in the app previously rolled
// its own un-debounced input with inconsistent types and icons.
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  delay = 200,
  className = '',
  autoFocus = false,
}) {
  const [text, setText] = useState(value || '');
  const timer = useRef(null);

  // External resets (parent clearing the query) win over local typing.
  useEffect(() => {
    setText(value || '');
  }, [value]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const emit = (next) => {
    setText(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(next), delay);
  };

  const clear = () => {
    clearTimeout(timer.current);
    setText('');
    onChange('');
  };

  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
      <input
        type="search"
        value={text}
        onChange={e => emit(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-zinc-800 border border-zinc-700 rounded pl-8 pr-8 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-zinc-300"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
