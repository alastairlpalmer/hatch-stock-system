import React from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../utils/helpers';
import HatchLogo from '../ui/HatchLogo';
import SyncIndicator from '../ui/SyncIndicator';

const navItems = [
  { path: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
  { path: '/sales', label: 'Sales', icon: SalesIcon },
  { path: '/locations', label: 'Location Stock', icon: LocationIcon },
  { path: '/orders', label: 'Orders', icon: OrdersIcon },
  { path: '/restock', label: 'Restock', icon: RestockIcon },
  { path: '/support', label: 'Support', icon: SupportIcon },
];

export default function Sidebar({
  collapsed,
  onToggleCollapse,
  isMobile,
  mobileMenuOpen,
  onCloseMobile,
  onNavigate,
  syncStatus,
}) {
  return (
    <aside
      className={cn(
        'bg-zinc-900 border-r border-zinc-800 flex flex-col flex-shrink-0',
        isMobile
          ? cn(
              'fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out',
              mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
            )
          : cn(
              'relative transition-all duration-300',
              collapsed ? 'w-20' : 'w-64'
            )
      )}
    >
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <HatchLogo collapsed={!isMobile && collapsed} />
        {isMobile && (
          <button
            onClick={onCloseMobile}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg text-sm transition-all',
                  isActive
                    ? 'bg-hatch-green/15 text-hatch-cream border border-hatch-green/40'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 active:bg-zinc-800'
                )
              }
              title={!isMobile && collapsed ? item.label : undefined}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {(isMobile || !collapsed) && (
                <span className="truncate">{item.label}</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {!isMobile && (
        <div className="p-3 border-t border-zinc-800">
          <button
            onClick={onToggleCollapse}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            <CollapseIcon
              className={cn('w-5 h-5 transition-transform', collapsed && 'rotate-180')}
            />
            {!collapsed && <span className="text-sm">Collapse</span>}
          </button>
        </div>
      )}

      {isMobile && (
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center justify-between text-sm">
            <SyncIndicator status={syncStatus} />
            <span className="text-zinc-500 text-xs">
              {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
      )}
    </aside>
  );
}

function DashboardIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function SalesIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function LocationIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function OrdersIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function RestockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function SupportIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function CloseIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function CollapseIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
    </svg>
  );
}
