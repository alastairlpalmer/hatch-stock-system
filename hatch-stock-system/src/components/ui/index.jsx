import React from 'react';

// ============ HATCH LOGO ============
export function HatchLogo({ collapsed }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center flex-shrink-0">
        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
      {!collapsed && (
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            Hatch
          </h1>
          <p className="text-zinc-500 text-xs -mt-0.5">Stock Management</p>
        </div>
      )}
    </div>
  );
}

// ============ SYNC INDICATOR ============
export function SyncIndicator({ status }) {
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

// ============ LOADING SCREEN ============
export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl animate-pulse"></div>
        <div className="text-zinc-400">Loading...</div>
      </div>
    </div>
  );
}

// ============ STAT CARD ============
export function StatCard({ label, value, accent = 'emerald', icon }) {
  const accentColors = {
    emerald: 'border-emerald-500/30 bg-emerald-500/5',
    teal: 'border-teal-500/30 bg-teal-500/5',
    blue: 'border-blue-500/30 bg-blue-500/5',
    purple: 'border-purple-500/30 bg-purple-500/5',
    yellow: 'border-yellow-500/30 bg-yellow-500/5',
    red: 'border-red-500/30 bg-red-500/5',
  };
  
  const valueColors = {
    emerald: 'text-emerald-400',
    teal: 'text-teal-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  };

  return (
    <div className={`rounded-xl border p-4 ${accentColors[accent]}`}>
      <div className={`text-2xl font-bold ${valueColors[accent]}`}>{value}</div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

// ============ BUTTON ============
export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md',
  disabled = false,
  onClick,
  className = '',
  ...props 
}) {
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-zinc-900';
  
  const variants = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-500 focus:ring-emerald-500',
    secondary: 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600 focus:ring-zinc-500',
    ghost: 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50',
    danger: 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-500',
  };
  
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
}

// ============ INPUT ============
export function Input({ 
  label, 
  error, 
  className = '', 
  ...props 
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      )}
      <input
        className={`w-full bg-zinc-800 border rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${
          error ? 'border-red-500' : 'border-zinc-700'
        }`}
        {...props}
      />
      {error && (
        <p className="text-red-400 text-xs mt-1">{error}</p>
      )}
    </div>
  );
}

// ============ SELECT ============
export function Select({ 
  label, 
  options = [], 
  className = '', 
  ...props 
}) {
  return (
    <div className={className}>
      {label && (
        <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      )}
      <select
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default {
  HatchLogo,
  SyncIndicator,
  LoadingScreen,
  StatCard,
  Button,
  Input,
  Select,
};
