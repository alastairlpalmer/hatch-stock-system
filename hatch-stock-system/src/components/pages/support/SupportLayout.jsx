import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../../context/AuthContext';

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

export default function SupportLayout() {
  const { isAdmin } = useAuth();

  // Settings (the Admin page) is admin-only once auth is on — the server
  // enforces the same rule; hiding the tab just avoids a dead end. The Users
  // and Account tabs only appear with auth enabled (they're meaningless
  // without logins).
  const tabs = [
    { to: 'docs', label: 'Restocking Docs' },
    ...(!AUTH_ENABLED || isAdmin ? [{ to: 'settings', label: 'Settings' }] : []),
    { to: 'history', label: 'History' },
    ...(AUTH_ENABLED ? [{ to: 'account', label: 'Account' }] : []),
    ...(AUTH_ENABLED && isAdmin ? [{ to: 'users', label: 'Users' }] : []),
  ];

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
