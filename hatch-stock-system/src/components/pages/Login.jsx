import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services/auth.service';

export default function Login() {
  const navigate = useNavigate();
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // First-time setup is only offered while the server has NO users at all —
  // afterwards the toggle disappears (new logins are created by the admin in
  // Support → Users). Defaults to false so the dead-end never shows while the
  // status is loading or unreachable.
  const [needsBootstrap, setNeedsBootstrap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authService.getSetupStatus()
      .then(s => { if (!cancelled) setNeedsBootstrap(!!s.needsBootstrap); })
      .catch(() => { /* unreachable server: keep the plain login form */ });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'register') {
        await register({ name, email, password });
      } else {
        await login(email, password);
      }
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
    <div className="min-h-screen flex bg-zinc-950 text-zinc-100">
      {/* Brand hero — hidden on small screens */}
      <div
        className="hidden lg:flex lg:w-1/2 relative flex-col justify-between p-12 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #004638 0%, #166C53 100%)' }}
      >
        {/* subtle decorative glow */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ background: '#F6F0DC' }}
        />
        <div className="absolute -bottom-32 -left-16 w-96 h-96 rounded-full opacity-10 blur-3xl bg-emerald-300" />

        <div className="relative animate-fade-in">
          <img src="/brand/hatch-horizontal-cream.svg" alt="Hatch" className="h-9 w-auto" />
        </div>

        <div className="relative max-w-md animate-slide-in">
          <h2 className="text-4xl font-semibold leading-tight" style={{ color: '#F6F0DC' }}>
            Stock, sales &amp; restocking — in one place.
          </h2>
          <p className="mt-4 text-base text-emerald-50/80">
            Track warehouse and machine inventory, plan restock routes, and stay on top of
            sales across every location.
          </p>
        </div>

        <div className="relative text-sm text-emerald-50/60">
          © {new Date().getFullYear()} Hatch
        </div>
      </div>

      {/* Sign-in panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8 animate-fade-in">
          {/* logo for mobile / narrow screens */}
          <div className="lg:hidden flex justify-center">
            <img src="/brand/hatch-icon-cream.svg" alt="Hatch" className="h-12 w-auto" />
          </div>

          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">
              {mode === 'login' ? 'Welcome back' : 'Create admin account'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              {mode === 'login'
                ? 'Sign in to your Hatch account to continue'
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
                <label className="block text-xs text-zinc-500 mb-1.5">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? (mode === 'login' ? 'Signing in...' : 'Creating account...')
                : (mode === 'login' ? 'Sign in' : 'Create admin account')}
            </button>
          </form>

          {(needsBootstrap || mode === 'register') && (
            <button
              type="button"
              onClick={toggleMode}
              className="w-full text-center text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {mode === 'login'
                ? 'First-time setup? Create admin account'
                : 'Already have an account? Sign in'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
