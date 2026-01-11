import React from 'react';

export default function SyncIndicator({ status }) {
  const getStatusInfo = () => {
    switch (status.status) {
      case 'saved':
      case 'loaded':
      case 'connected':
        return { icon: '✓', text: 'Saved', color: 'text-emerald-400' };
      case 'saving':
        return { icon: '↻', text: 'Saving...', color: 'text-yellow-400 animate-spin' };
      case 'error':
        return { icon: '✗', text: 'Error', color: 'text-red-400' };
      case 'offline':
        return { icon: '○', text: 'Offline', color: 'text-zinc-400' };
      default:
        return { icon: '○', text: 'New', color: 'text-zinc-400' };
    }
  };

  const info = getStatusInfo();

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={info.color}>{info.icon}</span>
      <span className="text-zinc-500">{info.text}</span>
    </div>
  );
}
