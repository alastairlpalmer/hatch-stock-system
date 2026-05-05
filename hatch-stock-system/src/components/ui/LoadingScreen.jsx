import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/brand/hatch-icon-cream.svg"
          alt="Hatch"
          className="h-14 w-auto animate-pulse"
        />
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    </div>
  );
}
