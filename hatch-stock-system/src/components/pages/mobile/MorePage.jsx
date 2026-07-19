import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, BarChart3, MapPin, BookOpen, History as HistoryIcon,
  TrendingDown, PackageMinus, UserCircle, Settings as SettingsIcon,
  Users as UsersIcon, ChevronRight, LogOut,
} from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useStock } from '../../../context/StockContext';
import SyncIndicator from '../../ui/SyncIndicator';

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

// The mobile "Other" tab: everything that isn't Locations / Orders / Restock.
// Gating mirrors SupportLayout — the route guards (AdminOnly) and the server
// role policy are the real enforcement; hiding rows just avoids dead ends.
export default function MorePage() {
  const { user, isAdmin, logout } = useAuth();
  const { syncStatus } = useStock();
  const navigate = useNavigate();

  const items = [
    { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
    { to: '/sales', label: 'Full Sales', Icon: BarChart3 },
    { to: '/locations', label: 'Location Stock', Icon: MapPin },
    { to: '/support/docs', label: 'Restocking Docs', Icon: BookOpen },
    { to: '/support/history', label: 'History', Icon: HistoryIcon },
    { to: '/restock/shrinkage', label: 'Shrinkage', Icon: TrendingDown },
    { to: '/warehouse/remove', label: 'Remove Stock', Icon: PackageMinus },
    ...(AUTH_ENABLED ? [{ to: '/support/account', label: 'Account', Icon: UserCircle }] : []),
    ...(!AUTH_ENABLED || isAdmin ? [{ to: '/support/settings', label: 'Settings', Icon: SettingsIcon }] : []),
    ...(AUTH_ENABLED && isAdmin ? [{ to: '/support/users', label: 'Users', Icon: UsersIcon }] : []),
  ];

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70">
        {items.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 px-4 py-3.5 text-sm text-zinc-200 hover:bg-zinc-800/40 active:bg-zinc-800/70"
          >
            <Icon className="w-5 h-5 text-zinc-500 flex-shrink-0" />
            <span className="flex-1">{label}</span>
            <ChevronRight className="w-4 h-4 text-zinc-600" />
          </Link>
        ))}
      </div>

      {/* Footer — carries what the (removed) mobile drawer used to provide:
          identity + sign out, sync state and today's date. */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        {AUTH_ENABLED && user && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-zinc-200 truncate">{user.name || user.email}</p>
              <p className="text-xs text-zinc-500">{isAdmin ? 'Admin' : 'Restocker'}</p>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-zinc-400 bg-zinc-800/60 hover:text-zinc-200 hover:bg-zinc-800"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <SyncIndicator status={syncStatus} />
          <span>
            {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>
      </div>
    </div>
  );
}
