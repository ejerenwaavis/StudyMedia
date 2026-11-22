import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Radio,
} from 'lucide-react';
import { formatTime } from '../utils/youtube';
import SpeedPopover from './SpeedPopover';

const INTERVAL_PRESETS = [5, 10, 15, 30, 60];

export default function CarControlDeck({
  title,
  isPlaying,
  currentTime,
  duration,
  seekInterval,
  playbackSpeed,
  hasPrev,
  hasNext,
  lastSignal,
  onTogglePlay,
  onSeekRelative,
  onPrevVideo,
  onNextVideo,
  onChangeInterval,
  onChangeSpeed,
  onTestSignal,
}) {
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="flex flex-col gap-5 rounded-3xl border border-zinc-800 bg-obsidian-900 p-5 sm:p-7">
      {/* Now Playing Banner */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400">
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            Car / Hands-Free Mode
          </span>
          <span className="font-mono text-sm font-semibold text-zinc-300">
            {formatTime(currentTime)} <span className="text-zinc-600">/</span> {formatTime(duration)}
          </span>
        </div>
        <h2 className="truncate text-lg font-bold text-white sm:text-xl">
          {title || 'No lecture loaded'}
        </h2>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-obsidian-800">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Oversized Primary Controls */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <button
          type="button"
          onClick={() => onSeekRelative(-seekInterval)}
          className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-zinc-700/70 bg-obsidian-800 text-white transition active:scale-95 hover:border-amber-500/60 hover:bg-obsidian-700 sm:h-32"
        >
          <RotateCcw className="h-8 w-8 text-amber-400 sm:h-9 sm:w-9" />
          <span className="font-mono text-lg font-bold">-{seekInterval}s</span>
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-2xl bg-white text-black shadow-lg transition active:scale-95 hover:bg-zinc-200 sm:h-32"
        >
          {isPlaying ? (
            <>
              <Pause className="h-10 w-10 fill-current" />
              <span className="text-sm font-bold uppercase tracking-wider">Pause</span>
            </>
          ) : (
            <>
              <Play className="ml-1 h-10 w-10 fill-current" />
              <span className="text-sm font-bold uppercase tracking-wider">Play</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSeekRelative(seekInterval)}
          className="flex h-28 flex-col items-center justify-center gap-1.5 rounded-2xl border border-zinc-700/70 bg-obsidian-800 text-white transition active:scale-95 hover:border-amber-500/60 hover:bg-obsidian-700 sm:h-32"
        >
          <RotateCw className="h-8 w-8 text-amber-400 sm:h-9 sm:w-9" />
          <span className="font-mono text-lg font-bold">+{seekInterval}s</span>
        </button>
      </div>

      {/* Secondary Queue & Speed Controls */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          type="button"
          disabled={!hasPrev}
          onClick={onPrevVideo}
          className="flex h-14 items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-obsidian-950 px-4 text-sm font-semibold text-zinc-200 transition hover:bg-obsidian-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <SkipBack className="h-4 w-4" />
          Prev Video
        </button>

        <button
          type="button"
          disabled={!hasNext}
          onClick={onNextVideo}
          className="flex h-14 items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-obsidian-950 px-4 text-sm font-semibold text-zinc-200 transition hover:bg-obsidian-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next Video
          <SkipForward className="h-4 w-4" />
        </button>

        <SpeedPopover
          speed={playbackSpeed}
          variant="car"
          align="right"
          onSelectSpeed={onChangeSpeed}
        />
      </div>

      {/* Quick Interval Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800/80 bg-obsidian-950 p-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Hardware Scrub Interval
        </span>
        <div className="flex flex-wrap gap-1.5">
          {INTERVAL_PRESETS.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => onChangeInterval(sec)}
              className={`rounded-lg px-3 py-1.5 font-mono text-xs font-bold transition ${
                seekInterval === sec
                  ? 'bg-amber-500 text-black'
                  : 'bg-obsidian-800 text-zinc-300 hover:bg-obsidian-700'
              }`}
            >
              {sec}s
            </button>
          ))}
        </div>
      </div>

      {/* Hardware Signal Debugger */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/70 bg-obsidian-950/70 px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="font-medium text-zinc-400">AVRCP Signal:</span>
          <span className="font-mono text-zinc-200">
            {lastSignal ? `${lastSignal.type} → ${lastSignal.detail}` : 'Listening for Bluetooth / steering wheel'}
          </span>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onTestSignal('prev')}
            className="rounded-md bg-obsidian-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-obsidian-700"
          >
            Test Back
          </button>
          <button
            type="button"
            onClick={() => onTestSignal('next')}
            className="rounded-md bg-obsidian-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-obsidian-700"
          >
            Test Fwd
          </button>
        </div>
      </div>
    </div>
  );
}
