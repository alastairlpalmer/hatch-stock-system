import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';

const baseTabs = [
  { to: 'docs', label: 'Restocking Docs' },
  { to: 'settings', label: 'Settings' },
  { to: 'history', label: 'History' },
];

export default function SupportLayout() {
  const { isAdmin } = useAuth();
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

  // The Users tab is admin-only; with auth disabled it stays hidden since
  // user management is only meaningful once auth is on.
  const tabs = authEnabled && isAdmin
    ? [...baseTabs, { to: 'users', label: 'Users' }]
    : baseTabs;

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
