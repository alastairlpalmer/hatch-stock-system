import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth.service';

const inputClass =
  'w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500';

// Signed-in user's own account: identity, change password, sign out. Only
// routed when VITE_AUTH_ENABLED is on (see SupportLayout).
export default function Account() {
  const navigate = useNavigate();
  const { user, isAdmin, logout } = useAuth();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState(null); // { type: 'success'|'error', message }

  const changePassword = async (e) => {
    e.preventDefault();
    setBanner(null);
    if (newPassword.length < 8) {
      setBanner({ type: 'error', message: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setBanner({ type: 'error', message: 'New passwords do not match.' });
      return;
    }
    setSaving(true);
    try {
      await authService.changeOwnPassword(currentPassword, newPassword);
      setBanner({ type: 'success', message: 'Password changed. Use the new one next time you sign in.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setBanner({
        type: 'error',
        message: err.response?.data?.error || 'Could not change the password.',
      });
    } finally {
      setSaving(false);
    }
  };

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Signed in as</h2>
        <div className="space-y-1 text-sm">
          <p className="text-zinc-200">{user?.name || '—'}</p>
          <p className="text-zinc-400">{user?.email}</p>
          <span className={`inline-block text-[11px] px-2 py-0.5 rounded ${isAdmin ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
            {isAdmin ? 'Admin' : 'Restocker'}
          </span>
        </div>
        <button
          onClick={signOut}
          className="mt-4 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 hover:text-white"
        >
          Sign out
        </button>
      </div>

      <form onSubmit={changePassword} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-medium text-zinc-200">Change password</h2>

        {banner && (
          <div className={`rounded-lg px-3 py-2 text-sm ${
            banner.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {banner.message}
          </div>
        )}

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Current password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">New password (min 8 characters)</label>
          <input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Confirm new password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
