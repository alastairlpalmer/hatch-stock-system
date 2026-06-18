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
    if (!window.confirm(`Delete the login for ${u.email}? This cannot be undone.`)) return;
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

  const handleReset = async (u) => {
    const password = window.prompt(`New password for ${u.email} (min 8 characters):`);
    if (password == null) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    setError(null);
    setActionId(u.id);
    try {
      await authService.resetPassword(u.id, password);
      window.alert('Password updated.');
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
                <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
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
                    <button
                      onClick={() => handleReset(u)}
                      disabled={actionId === u.id}
                      className="text-zinc-400 hover:text-white mr-3 disabled:opacity-50"
                    >
                      Reset password
                    </button>
                    <button
                      onClick={() => handleDelete(u)}
                      disabled={actionId === u.id || u.id === currentUser?.id}
                      className="text-zinc-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-500"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
