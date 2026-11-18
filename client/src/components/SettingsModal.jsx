import React, { useState } from 'react';
import { X, Sliders, Cloud, Smartphone, ShieldCheck } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  seekInterval,
  doubleTapToSkip,
  doubleTapWindow,
  workspaceId,
  dbConnected,
  onSave,
}) {
  const [customInterval, setCustomInterval] = useState(String(seekInterval));
  const [dtEnabled, setDtEnabled] = useState(doubleTapToSkip);
  const [dtWindow, setDtWindow] = useState(doubleTapWindow);
  const [wsId, setWsId] = useState(workspaceId);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const parsedInterval = Math.max(1, Math.min(600, Number(customInterval) || 15));
    onSave({
      seekInterval: parsedInterval,
      doubleTapToSkip: dtEnabled,
      doubleTapWindow: dtWindow,
      workspaceId: wsId.trim() || 'default',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-obsidian-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-bold text-white">Hardware & Sync Settings</h3>
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

          {/* Double-Tap to Skip */}
          <div className="rounded-xl border border-zinc-800 bg-obsidian-950 p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-200">
                  Double-tap hardware button to skip video
                </p>
                <p className="text-xs text-zinc-500">
                  Single tap scrubs ±{customInterval || 15}s; quick double-tap changes lecture
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
              Use the same Profile ID on your phone and desktop to sync queue & resume timestamps.
            </p>
          </div>

          {/* PWA / Background Info */}
          <div className="flex items-start gap-2.5 rounded-xl border border-zinc-800/80 bg-obsidian-950/60 p-3 text-xs text-zinc-400">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Install StudyMedia as a PWA (or via Chrome Extension) for persistent background MediaSession & Screen Wake Lock support.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2">
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
        </form>
      </div>
    </div>
  );
}
