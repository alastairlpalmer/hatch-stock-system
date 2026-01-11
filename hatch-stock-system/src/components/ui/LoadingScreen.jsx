import React from 'react';

export default function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl animate-pulse"></div>
        <div className="text-zinc-400">Loading...</div>
      </div>
    </div>
  );
}
