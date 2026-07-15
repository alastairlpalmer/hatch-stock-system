import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MapPin, ClipboardList, Warehouse, PackagePlus, MoreHorizontal } from 'lucide-react';

// Mobile-only bottom navigation. Rendered IN FLOW (flex-shrink-0 sibling
// after <main>) rather than position:fixed — the scroll container ends above
// the bar automatically, and page-level `sticky bottom-0` action bars (pick
// list "Mark packed", stock-check save) stack on top of it with no z-index
// or offset work.
//
// Active matching is a priority matrix, not per-link prefixes: Restock and
// Orders own their areas, Locations owns the composite home plus the two
// pages it summarises, and Other is the fallback bucket for everything else
// (Dashboard, Support, /more).
const TABS = [
  { key: 'locations', label: 'Locations', to: '/home', Icon: MapPin },
  { key: 'orders', label: 'Orders', to: '/orders', Icon: ClipboardList },
  { key: 'warehouse', label: 'Warehouse', to: '/warehouse', Icon: Warehouse },
  { key: 'restock', label: 'Restock', to: '/restock', Icon: PackagePlus },
  { key: 'other', label: 'Other', to: '/more', Icon: MoreHorizontal },
];

function activeTab(pathname) {
  if (pathname === '/restock' || pathname.startsWith('/restock/')) return 'restock';
  if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return 'warehouse';
  if (pathname === '/orders' || pathname.startsWith('/orders/')) return 'orders';
  if (
    pathname === '/home' ||
    pathname === '/locations' || pathname.startsWith('/locations/') ||
    pathname === '/sales' || pathname.startsWith('/sales/')
  ) {
    return 'locations';
  }
  return 'other';
}

export default function BottomNav() {
  const { pathname } = useLocation();
  const active = activeTab(pathname);

  return (
    <nav
      className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/95 backdrop-blur-sm"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="grid grid-cols-5 h-16">
        {TABS.map(({ key, label, to, Icon }) => {
          const isActive = active === key;
          return (
            <Link
              key={key}
              to={to}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-1 transition-colors ${
                isActive ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-6 h-6" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className={`text-[11px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
