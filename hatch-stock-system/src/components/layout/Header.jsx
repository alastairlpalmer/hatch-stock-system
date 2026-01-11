import React from 'react';
import SyncIndicator from '../ui/SyncIndicator';

const tabLabels = {
  dashboard: 'Dashboard',
  sales: 'Sales Overview',
  locations: 'Location Stock',
  orders: 'Orders',
  receive: 'Receive Stock',
  inventory: 'Warehouse Inventory',
  remove: 'Remove Stock',
  restock: 'Restock Machine',
  history: 'History',
  admin: 'Admin',
};

export default function Header({ activeTab, syncStatus, isMobile, onMenuClick }) {
  return (
    <header className="h-14 md:h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm flex items-center justify-between px-4 md:px-6 flex-shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger */}
        {isMobile && (
          <button
            onClick={onMenuClick}
            className="p-2 -ml-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 active:bg-zinc-700"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div>
          <h2 className="text-base md:text-lg font-semibold text-zinc-100">
            {tabLabels[activeTab] || 'Dashboard'}
          </h2>
        </div>
      </div>
      
      {/* Desktop header items */}
      {!isMobile && (
        <div className="flex items-center gap-6">
          <SyncIndicator status={syncStatus} />
          <div className="text-sm text-zinc-500">
            {new Date().toLocaleDateString('en-GB', { 
              weekday: 'short', 
              day: 'numeric', 
              month: 'short' 
            })}
          </div>
        </div>
      )}
      
      {/* Mobile sync indicator - compact */}
      {isMobile && (
        <div className="flex items-center">
          <span
            className={`w-2 h-2 rounded-full ${
              syncStatus.status === 'saved' || syncStatus.status === 'loaded' || syncStatus.status === 'connected'
                ? 'bg-emerald-500'
                : syncStatus.status === 'saving'
                ? 'bg-yellow-500 animate-pulse'
                : syncStatus.status === 'error'
                ? 'bg-red-500'
                : 'bg-zinc-500'
            }`}
          />
        </div>
      )}
    </header>
  );
}
