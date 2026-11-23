import React, { useState } from 'react';
import { Play, Lock, KeyRound, Mail, User, Loader2, AlertCircle, WifiOff } from 'lucide-react';
import { loginRequest, registerRequest } from '../utils/authClient';

export default function AuthGate({ isOnline = true, onAuthenticated }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!isOnline) {
      setError('Internet connection required to sign in for the first time.');
      return;
    }

    setLoading(true);
    try {
      const data =
        mode === 'login'
          ? await loginRequest({ email, password })
          : await registerRequest({ email, password, displayName, inviteCode });
      onAuthenticated?.(data);
    } catch (err) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-obsidian-950 p-4 text-zinc-100">
      <div className="w-full max-w-md rounded-3xl border border-zinc-800/90 bg-obsidian-900 p-6 shadow-2xl sm:p-8">
        {/* Brand Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/40">
            <Play className="ml-0.5 h-5 w-5 fill-amber-400 text-amber-400" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight text-white">StudyMedia</h1>
          <p className="mt-1 text-xs text-zinc-400">
            Private Invite-Only Lecture Player &amp; Cloud Vault
          </p>
        </div>

        {!isOnline && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-300">
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>You are currently offline. Sign in online once to enable Airplane Mode.</span>
          </div>
        )}

        {/* Mode Switcher */}
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-obsidian-950 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setError('');
            }}
            className={`rounded-lg py-2 text-xs font-bold transition ${
              mode === 'login'
                ? 'bg-obsidian-800 text-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setError('');
            }}
            className={`rounded-lg py-2 text-xs font-bold transition ${
              mode === 'register'
                ? 'bg-obsidian-800 text-amber-400 shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            Invite Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Display Name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex"
                  className="w-full rounded-xl border border-zinc-800 bg-obsidian-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-zinc-600 focus:border-amber-500/70 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-800 bg-obsidian-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-zinc-600 focus:border-amber-500/70 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full rounded-xl border border-zinc-800 bg-obsidian-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-zinc-600 focus:border-amber-500/70 focus:outline-none"
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Invite Code
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-amber-400/80" />
                <input
                  type="password"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Enter private invite code"
                  className="w-full rounded-xl border border-zinc-800 bg-obsidian-950 py-2.5 pl-9 pr-3 font-mono text-sm text-white placeholder-zinc-600 focus:border-amber-500/70 focus:outline-none"
                />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3 text-sm font-bold text-black shadow-lg transition hover:bg-amber-400 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === 'login' ? 'Sign In' : 'Create Private Account'}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] text-zinc-600">
          StudyMedia v3.0 • Private Access Only
        </p>
      </div>
    </div>
  );
}
