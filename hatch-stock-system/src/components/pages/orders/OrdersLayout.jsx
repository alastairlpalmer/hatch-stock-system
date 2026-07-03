import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: 'purchase', label: 'Purchase Orders' },
  { to: 'buying-lists', label: 'Buying Lists' },
  { to: 'receive', label: 'Receive' },
  { to: 'warehouse', label: 'Warehouse' },
  // Cross-link, not a nested route: the pick-list pages navigate with
  // absolute /restock/... paths throughout, so they live in the Restock area
  // — this tab is the Orders-side shortcut ("unit list") to them.
  { to: '/restock/picklists', label: 'Pick Lists' },
];

export default function OrdersLayout() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-800 pb-4 overflow-x-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex-shrink-0 px-4 py-2 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-emerald-500 text-zinc-900'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
