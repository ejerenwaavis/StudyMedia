import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Sliders,
  Cloud,
  Smartphone,
  ShieldCheck,
  HardDrive,
  Trash2,
  Server,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ExternalLink,
  LogOut,
  User,
} from 'lucide-react';
import { getStorageEstimate } from '../storage/mediaDB';
import {
  checkSidecarHealth,
  DEFAULT_FALLBACK_CONVERTER_URL,
} from '../utils/sidecarClient';

export default function SettingsModal({
  isOpen,
  onClose,
  seekInterval,
  doubleTapToSkip,
  doubleTapWindow,
  autoPlayNext = true,
  workspaceId,
  dbConnected,
  r2Configured = false,
  currentUser = null,
  sidecarUrl = '',
  sidecarApiKey = '',
  fallbackConverterUrl = DEFAULT_FALLBACK_CONVERTER_URL,
  onSave,
  onClearOfflineMedia,
  onSignOut,
}) {
  const [customInterval, setCustomInterval] = useState(String(seekInterval));
  const [dtEnabled, setDtEnabled] = useState(doubleTapToSkip);
  const [dtWindow, setDtWindow] = useState(doubleTapWindow);
  const [autoNext, setAutoNext] = useState(autoPlayNext);
  const [wsId, setWsId] = useState(workspaceId);
  const [scUrl, setScUrl] = useState(sidecarUrl);
  const [scKey, setScKey] = useState(sidecarApiKey);
  const [showKey, setShowKey] = useState(false);
  const [converterUrl, setConverterUrl] = useState(
    fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL
  );

  const [storageInfo, setStorageInfo] = useState(null);
  const [clearingStorage, setClearingStorage] = useState(false);
  const [sidecarPing, setSidecarPing] = useState(null); // null | { loading } | { ok, status, message }

  const refreshStorage = useCallback(async () => {
    const info = await getStorageEstimate();
    setStorageInfo(info);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setCustomInterval(String(seekInterval));
    setDtEnabled(doubleTapToSkip);
    setDtWindow(doubleTapWindow);
    setAutoNext(autoPlayNext);
    setWsId(workspaceId);
    setScUrl(sidecarUrl);
    setScKey(sidecarApiKey);
    setShowKey(false);
    setConverterUrl(fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL);
    setSidecarPing(null);
    refreshStorage();
  }, [
    isOpen,
    seekInterval,
    doubleTapToSkip,
    doubleTapWindow,
    autoPlayNext,
    workspaceId,
    sidecarUrl,
    sidecarApiKey,
    fallbackConverterUrl,
    refreshStorage,
  ]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const parsedInterval = Math.max(1, Math.min(600, Number(customInterval) || 15));
    onSave({
      seekInterval: parsedInterval,
      doubleTapToSkip: dtEnabled,
      doubleTapWindow: dtWindow,
      autoPlayNext: autoNext,
      workspaceId: wsId.trim() || 'default',
      sidecarUrl: scUrl.trim(),
      sidecarApiKey: scKey.trim(),
      fallbackConverterUrl: converterUrl.trim() || DEFAULT_FALLBACK_CONVERTER_URL,
    });
    onClose();
  };

  const handleClearOffline = async () => {
    if (!onClearOfflineMedia) return;
    setClearingStorage(true);
    try {
      await onClearOfflineMedia();
      await refreshStorage();
    } finally {
      setClearingStorage(false);
    }
  };

  const handleTestSidecar = async () => {
    setSidecarPing({ loading: true });
    const res = await checkSidecarHealth(scUrl, scKey, 1500);
    setSidecarPing({
      loading: false,
      ok: res.ok,
      status: res.status,
      message: res.ok
        ? 'Online — Authenticated'
        : res.status === 'unauthorized'
        ? 'Invalid Key (401)'
        : res.error || 'Offline',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-obsidian-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Hardware, Offline & Sync Settings</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-obsidian-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Account & Cloud Vault Status */}
          {currentUser && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
                  <User className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold text-white">
                      {currentUser.displayName}
                    </p>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                      {currentUser.role || 'member'}
                    </span>
                  </div>
                  <p className="truncate font-mono text-[11px] text-zinc-400">
                    {currentUser.email}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    r2Configured
                      ? 'bg-sky-500/15 text-sky-300'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {r2Configured ? 'R2 Vault Ready' : 'R2 Off'}
                </span>
                {onSignOut && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSignOut();
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 transition hover:bg-red-500/20"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Custom Seek Interval */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Custom Scrub Interval (seconds)
            </label>
            <input
              type="number"
              min={1}
              max={600}
              value={customInterval}
              onChange={(e) => setCustomInterval(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-obsidian-950 px-3.5 py-2.5 font-mono text-sm text-white focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Auto-Play Next Lecture */}
          <div className="rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Auto-play next lecture in playlist
                </p>
                <p className="text-xs text-zinc-500">
                  Automatically advances when a lecture finishes (skips online items when offline)
                </p>
              </div>
              <input
                type="checkbox"
                checked={autoNext}
                onChange={(e) => setAutoNext(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
            </div>
          </div>

          {/* Double-Tap to Skip */}
          <div className="rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Double-tap hardware button to skip track
                </p>
                <p className="text-xs text-zinc-500">
                  Off (default): every tap immediately seeks ±{customInterval || 15}s so rapid taps stack cleanly
                </p>
              </div>
              <input
                type="checkbox"
                checked={dtEnabled}
                onChange={(e) => setDtEnabled(e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
            </div>

            {dtEnabled && (
              <div className="mt-3 border-t border-zinc-800 pt-3">
                <div className="mb-1 flex justify-between text-xs text-zinc-400">
                  <span>Double-tap threshold</span>
                  <span className="font-mono text-amber-400">{dtWindow}ms</span>
                </div>
                <input
                  type="range"
                  min={250}
                  max={800}
                  step={25}
                  value={dtWindow}
                  onChange={(e) => setDtWindow(Number(e.target.value))}
                  className="w-full accent-amber-500"
                />
              </div>
            )}
          </div>

          {/* Offline Storage Quota & Cleanup (IndexedDB) */}
          <div className="rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                Offline Media Storage (IndexedDB)
              </span>
              {storageInfo && (
                <span className="font-mono text-[11px] text-emerald-400">
                  {storageInfo.localFilesCount} file{storageInfo.localFilesCount === 1 ? '' : 's'} (
                  {storageInfo.formattedLocalBytes})
                </span>
              )}
            </div>

            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-obsidian-800">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all"
                style={{
                  width: `${Math.max(
                    storageInfo?.pct || 0,
                    storageInfo?.localFilesBytes > 0 ? 2 : 0
                  )}%`,
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-zinc-400">
                {storageInfo ? storageInfo.summaryText : 'Calculating storage quota...'}
              </p>
              <button
                type="button"
                disabled={clearingStorage || !storageInfo?.localFilesCount}
                onClick={handleClearOffline}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-red-400 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {clearingStorage ? 'Clearing...' : 'Clear Offline Media'}
              </button>
            </div>
          </div>

          {/* 3-Tier Download Pipeline: Home Sidecar + Fallback Public Converter */}
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Server className="h-3.5 w-3.5 text-amber-400" />
                Home Sidecar & Download Pipeline
              </span>
              <div className="flex items-center gap-2">
                {sidecarPing && !sidecarPing.loading && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      sidecarPing.ok
                        ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                        : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                    }`}
                  >
                    {sidecarPing.ok ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <AlertCircle className="h-3 w-3" />
                    )}
                    {sidecarPing.ok
                      ? 'Online'
                      : sidecarPing.status === 'unauthorized'
                      ? 'Invalid Key'
                      : 'Offline'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleTestSidecar}
                  disabled={!scUrl.trim() || !scKey.trim() || sidecarPing?.loading}
                  className="rounded-md border border-zinc-700 bg-obsidian-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition hover:border-amber-500/50 hover:text-white disabled:opacity-40"
                >
                  {sidecarPing?.loading ? 'Testing...' : 'Test Connection'}
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                  Tier 1 — Private Home Sidecar URL
                </label>
                <input
                  type="url"
                  value={scUrl}
                  onChange={(e) => setScUrl(e.target.value)}
                  placeholder="https://sidecar.aceddivision.com or https://xxx.trycloudflare.com"
                  className="w-full rounded-lg border border-zinc-700 bg-obsidian-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-400">
                  Sidecar Secret API Key (`x-api-key`)
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={scKey}
                    onChange={(e) => setScKey(e.target.value)}
                    placeholder="Enter 16-digit or custom secret key"
                    autoComplete="off"
                    className="w-full rounded-lg border border-zinc-700 bg-obsidian-900 py-2 pl-3 pr-9 font-mono text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    title={showKey ? 'Hide API Key' : 'Show API Key'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {sidecarPing && !sidecarPing.loading && !sidecarPing.ok && (
                <p className="text-[11px] text-red-400">{sidecarPing.message}</p>
              )}

              <div className="border-t border-zinc-800/80 pt-2.5">
                <label className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-400">
                  <ExternalLink className="h-3 w-3 text-amber-400" />
                  Tier 2 — Fallback External Downloader URL
                </label>
                <input
                  type="url"
                  value={converterUrl}
                  onChange={(e) => setConverterUrl(e.target.value)}
                  placeholder={DEFAULT_FALLBACK_CONVERTER_URL}
                  className="w-full rounded-lg border border-zinc-700 bg-obsidian-900 px-3 py-2 font-mono text-xs text-white placeholder-zinc-600 focus:border-amber-500 focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-zinc-500">
                  Used when Home Sidecar is offline. Auto-copies YouTube URL and supports optional{' '}
                  <code className="text-zinc-300">{'{url}'}</code> or{' '}
                  <code className="text-zinc-300">{'{id}'}</code> tokens.
                </p>
              </div>
            </div>
          </div>

          {/* Cloud Sync Profile */}
          <div className="rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Cloud className="h-3.5 w-3.5 text-amber-400" />
                Cloud Sync Profile ID
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  dbConnected
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {dbConnected ? 'MongoDB Connected' : 'Local Mode'}
              </span>
            </div>
            <input
              type="text"
              value={wsId}
              onChange={(e) => setWsId(e.target.value)}
              placeholder="default"
              className="w-full rounded-lg border border-zinc-700 bg-obsidian-900 px-3 py-2 font-mono text-xs text-white focus:border-amber-500 focus:outline-none"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Use the same Profile ID on your phone and desktop to sync queue, resume timestamps & sidecar config.
            </p>
          </div>

          {/* PWA / Background Info */}
          <div className="flex items-start gap-2.5 rounded-xl border border-zinc-800/80 bg-obsidian-950/60 p-3 text-xs text-zinc-400">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Install StudyMedia as a PWA for Airplane Mode support, auto-updating builds, offline IndexedDB playback, and native lock-screen controls.
            </span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="font-mono text-[10px] text-zinc-500">
              StudyMedia v3.2 • Nov 23
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-obsidian-800 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400"
              >
                <ShieldCheck className="h-4 w-4" />
                Save Settings
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
