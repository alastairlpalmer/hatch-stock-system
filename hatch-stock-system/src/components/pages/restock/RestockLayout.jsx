import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

const tabs = [
  { to: '/restock', label: 'Workflow', end: true },
  { to: '/restock/planner', label: 'Planner' },
  { to: '/restock/route', label: 'Select Route' },
  { to: '/restock/picklists', label: 'Pick Lists' },
  { to: '/restock/run', label: "Today's Run" },
  { to: '/restock/remove', label: 'Remove Stock' },
  { to: '/restock/check', label: 'Stock Check' },
  { to: '/restock/machine', label: 'Restock Machine' },
  { to: '/restock/shrinkage', label: 'Shrinkage' },
];

export default function RestockLayout() {
  const { pathname } = useLocation();
  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-zinc-800 pb-4 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.end ? pathname === tab.to : pathname === tab.to || pathname.startsWith(tab.to + '/');
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={`flex-shrink-0 px-4 py-2 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-emerald-500 text-zinc-900'
                  : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>
      <Outlet />
    </div>
  );
}
