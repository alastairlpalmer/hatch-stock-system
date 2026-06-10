import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import HatchLogo from '../ui/HatchLogo';

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = mode === 'register'
        ? { name, email, password }
        : { email, password };
      const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
      const response = await api.post(endpoint, payload);
      const { user, token } = response.data;

      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
      navigate('/');
    } catch (err) {
      if (mode === 'login' && err.response?.status === 401) {
        setError('Invalid email or password');
      } else {
        setError(err.response?.data?.error || err.message || 'Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-lg p-6 space-y-6">
        <div className="flex justify-center">
          <HatchLogo />
        </div>

        <div>
          <h1 className="text-lg font-semibold text-zinc-100">
            {mode === 'login' ? 'Sign in' : 'Create admin account'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {mode === 'login'
              ? 'Enter your credentials to continue'
              : 'First-time setup: register the first (admin) user'}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-500 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
              : (mode === 'login' ? 'Sign in' : 'Create admin account')}
          </button>
        </form>

        <button
          type="button"
          onClick={toggleMode}
          className="w-full text-center text-sm text-zinc-500 hover:text-zinc-300"
        >
          {mode === 'login'
            ? 'First-time setup? Create admin account'
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
