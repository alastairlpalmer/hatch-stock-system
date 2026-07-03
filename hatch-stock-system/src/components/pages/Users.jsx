import React, { useEffect, useState } from 'react';
import { authService } from '../../services/auth.service';
import { useAuth } from '../../context/AuthContext';

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState(null); // id mid-delete/reset
  // Inline flows replacing window.prompt/confirm: which row has the reset
  // form open (+ its masked input), and which row has an armed delete.
  const [resetId, setResetId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetDone, setResetDone] = useState(null); // email of last reset
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await authService.listUsers());
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await authService.createUser(form);
      setForm({ name: '', email: '', password: '' });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (u) => {
    setConfirmDeleteId(null);
    setError(null);
    setActionId(u.id);
    try {
      await authService.deleteUser(u.id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete user');
    } finally {
      setActionId(null);
    }
  };

  const submitReset = async (u) => {
    if (resetPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setActionId(u.id);
    try {
      await authService.resetPassword(u.id, resetPassword);
      setResetId(null);
      setResetPassword('');
      setResetDone(u.email);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">User logins</h2>
        <p className="text-sm text-zinc-500 mt-1">
          Create and manage the accounts that can sign in to Hatch.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {resetDone && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm">
          <span>Password updated for {resetDone}.</span>
          <button onClick={() => setResetDone(null)} className="text-emerald-300 hover:text-emerald-100 ml-3">Dismiss</button>
        </div>
      )}

      {/* Create user */}
      <form
        onSubmit={handleCreate}
        className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4"
      >
        <h3 className="text-sm font-medium text-zinc-300">Add a user</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1.5">Password (min 8)</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? 'Adding...' : 'Add user'}
        </button>
      </form>

      {/* User list */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-zinc-500 font-medium">Role</th>
              <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-600">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-600">No users yet</td></tr>
            ) : (
              users.map(u => (
                <React.Fragment key={u.id}>
                  <tr className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-200">
                      {u.name || '-'}
                      {u.id === currentUser?.id && (
                        <span className="ml-2 text-xs text-zinc-500">(you)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={u.role === 'admin' ? 'text-emerald-400' : 'text-zinc-400'}>
                        {u.role === 'admin' ? 'Administrator' : 'Member'}
                      </span>
                    </td>
                    <td className="text-right px-4 py-3 whitespace-nowrap">
                      {confirmDeleteId === u.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(u)}
                            disabled={actionId === u.id}
                            className="text-red-400 hover:text-red-300 font-medium mr-3 disabled:opacity-50"
                          >
                            Confirm delete?
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} className="text-zinc-500 hover:text-white">
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setResetId(resetId === u.id ? null : u.id);
                              setResetPassword('');
                              setConfirmDeleteId(null);
                            }}
                            disabled={actionId === u.id}
                            className="text-zinc-400 hover:text-white mr-3 disabled:opacity-50"
                          >
                            {resetId === u.id ? 'Cancel reset' : 'Reset password'}
                          </button>
                          <button
                            onClick={() => { setConfirmDeleteId(u.id); setResetId(null); }}
                            disabled={actionId === u.id || u.id === currentUser?.id}
                            className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-500"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                  {resetId === u.id && (
                    <tr className="border-b border-zinc-800/50 bg-zinc-800/20">
                      <td colSpan={4} className="px-4 py-3">
                        <form
                          onSubmit={(e) => { e.preventDefault(); submitReset(u); }}
                          className="flex flex-col sm:flex-row sm:items-center gap-2"
                        >
                          <label className="text-xs text-zinc-500 sm:w-56">
                            New password for {u.email} (min 8):
                          </label>
                          <input
                            type="password"
                            value={resetPassword}
                            onChange={e => setResetPassword(e.target.value)}
                            minLength={8}
                            required
                            autoComplete="new-password"
                            autoFocus
                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="submit"
                            disabled={actionId === u.id || resetPassword.length < 8}
                            className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
                          >
                            {actionId === u.id ? 'Saving…' : 'Set password'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
