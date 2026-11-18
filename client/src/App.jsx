import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Plus,
  Sun,
  Moon,
  Lock,
  Unlock,
  Headphones,
  Settings,
  Download,
  Car,
  BookOpen,
  Monitor,
  SkipBack,
  SkipForward,
  Radio,
  Link2,
} from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import QueuePanel from './components/QueuePanel';
import CarControlDeck from './components/CarControlDeck';
import SettingsModal from './components/SettingsModal';
import { useMediaSession } from './hooks/useMediaSession';
import { useWakeLock } from './hooks/useWakeLock';
import { parseYouTubeUrl, getThumbnailUrl, formatTime, fetchVideoMetadata } from './utils/youtube';

const STORAGE_KEY = 'studymedia_state_v1';
const INTERVAL_PRESETS = [5, 10, 15, 30, 60];
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function App() {
  const initialLocal = useMemo(() => loadLocalState(), []);

  const [workspaceId, setWorkspaceId] = useState(initialLocal?.workspaceId || 'default');
  const [items, setItems] = useState(initialLocal?.items || []);
  const [activeVideoId, setActiveVideoId] = useState(initialLocal?.activeVideoId || null);
  const [activePlaylistId, setActivePlaylistId] = useState(initialLocal?.activePlaylistId || null);

  const [mode, setMode] = useState(initialLocal?.mode || 'study'); // 'study' | 'car' | 'theater'
  const [seekInterval, setSeekInterval] = useState(initialLocal?.seekInterval || 15);
  const [playbackSpeed, setPlaybackSpeed] = useState(initialLocal?.playbackSpeed || 1.25);
  const [doubleTapToSkip, setDoubleTapToSkip] = useState(
    initialLocal?.doubleTapToSkip !== undefined ? initialLocal.doubleTapToSkip : true
  );
  const [doubleTapWindow, setDoubleTapWindow] = useState(initialLocal?.doubleTapWindow || 450);
  const [audioOnlyMode, setAudioOnlyMode] = useState(initialLocal?.audioOnlyMode || false);

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dbConnected, setDbConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSignalToast, setShowSignalToast] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);

  const playerRef = useRef(null);
  const toastTimerRef = useRef(null);

  const wakeLock = useWakeLock(true);

  // Derived Queue & History
  const queue = useMemo(
    () =>
      items
        .filter((i) => i.inQueue)
        .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0)),
    [items]
  );

  const history = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.lastWatchedAt || 0).getTime() - new Date(a.lastWatchedAt || 0).getTime()
      ),
    [items]
  );

  const activeItem = useMemo(
    () => items.find((i) => i.videoId === activeVideoId) || null,
    [items, activeVideoId]
  );

  const activeQueueIndex = useMemo(
    () => queue.findIndex((i) => i.videoId === activeVideoId),
    [queue, activeVideoId]
  );

  // Save to localStorage whenever core state changes
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          workspaceId,
          items,
          activeVideoId,
          activePlaylistId,
          mode,
          seekInterval,
          playbackSpeed,
          doubleTapToSkip,
          doubleTapWindow,
          audioOnlyMode,
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [
    workspaceId,
    items,
    activeVideoId,
    activePlaylistId,
    mode,
    seekInterval,
    playbackSpeed,
    doubleTapToSkip,
    doubleTapWindow,
    audioOnlyMode,
  ]);

  // Listen for PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Load state from MongoDB backend on mount or workspaceId change
  useEffect(() => {
    let cancelled = false;
    async function syncFromServer() {
      try {
        const healthRes = await fetch('/api/health');
        const health = await healthRes.json();
        if (!cancelled) setDbConnected(Boolean(health?.dbConnected));

        if (!health?.dbConnected) return;

        const stateRes = await fetch(`/api/state?workspaceId=${encodeURIComponent(workspaceId)}`);
        const data = await stateRes.json();
        if (cancelled || !data?.synced) return;

        if (Array.isArray(data.items) && data.items.length > 0) {
          setItems(data.items);
          if (!activeVideoId) {
            const firstQueue = data.items.find((i) => i.inQueue) || data.items[0];
            if (firstQueue) {
              setActiveVideoId(firstQueue.videoId);
              setActivePlaylistId(firstQueue.playlistId || null);
            }
          }
        }
        if (data.settings) {
          if (data.settings.seekInterval) setSeekInterval(data.settings.seekInterval);
          if (data.settings.playbackSpeed) setPlaybackSpeed(data.settings.playbackSpeed);
          if (data.settings.doubleTapToSkip !== undefined)
            setDoubleTapToSkip(data.settings.doubleTapToSkip);
          if (data.settings.doubleTapWindow) setDoubleTapWindow(data.settings.doubleTapWindow);
          if (data.settings.activeMode) setMode(data.settings.activeMode);
          if (data.settings.activeVideoId && !activeVideoId)
            setActiveVideoId(data.settings.activeVideoId);
        }
      } catch {
        // Offline or local-only fallback
      }
    }
    syncFromServer();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const syncSettingsToServer = useCallback(
    (patch) => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...patch }),
      }).catch(() => {});
    },
    [workspaceId]
  );

  // Navigation between queued lectures
  const handleNextVideo = useCallback(() => {
    if (queue.length === 0) return;
    const nextIdx = activeQueueIndex >= 0 ? (activeQueueIndex + 1) % queue.length : 0;
    const next = queue[nextIdx];
    if (next) {
      setActiveVideoId(next.videoId);
      setActivePlaylistId(next.playlistId || null);
      syncSettingsToServer({ activeVideoId: next.videoId });
    }
  }, [queue, activeQueueIndex, syncSettingsToServer]);

  const handlePrevVideo = useCallback(() => {
    if (queue.length === 0) return;
    const prevIdx =
      activeQueueIndex > 0 ? activeQueueIndex - 1 : Math.max(0, queue.length - 1);
    const prev = queue[prevIdx];
    if (prev) {
      setActiveVideoId(prev.videoId);
      setActivePlaylistId(prev.playlistId || null);
      syncSettingsToServer({ activeVideoId: prev.videoId });
    }
  }, [queue, activeQueueIndex, syncSettingsToServer]);

  const handleSeekRelative = useCallback((delta) => {
    playerRef.current?.seekRelative(delta);
  }, []);

  // Hardware MediaSession Hijacker & Silent Audio Lock
  const { sessionLockActive, lastSignal, triggerTestSignal } = useMediaSession({
    isPlaying,
    title: activeItem?.title || (activeVideoId ? `Lecture (${activeVideoId})` : 'StudyMedia'),
    thumbnail: activeItem?.thumbnail || getThumbnailUrl(activeVideoId),
    seekInterval,
    playbackSpeed,
    duration,
    currentTime,
    doubleTapToSkip,
    doubleTapWindow,
    onSeekRelative: handleSeekRelative,
    onNextVideo: handleNextVideo,
    onPrevVideo: handlePrevVideo,
    onPlay: () => playerRef.current?.play(),
    onPause: () => playerRef.current?.pause(),
  });

  // Show floating toast briefly whenever hardware signal arrives
  useEffect(() => {
    if (!lastSignal) return;
    setShowSignalToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowSignalToast(false), 2600);
    return () => clearTimeout(toastTimerRef.current);
  }, [lastSignal]);

  // Keyboard shortcuts for desktop usability
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        playerRef.current?.togglePlay();
      } else if (e.code === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleSeekRelative(-seekInterval);
      } else if (e.code === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleSeekRelative(seekInterval);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSeekRelative, seekInterval]);

  // Add or Play YouTube URL
  const handleAddUrl = async (playImmediately = true) => {
    setUrlError('');
    const { videoId, playlistId } = parseYouTubeUrl(urlInput);

    if (!videoId && !playlistId) {
      setUrlError('Please paste a valid YouTube video or playlist URL.');
      return;
    }

    const effectiveId = videoId || `playlist:${playlistId}`;
    const thumbnail = videoId ? getThumbnailUrl(videoId) : '';

    // Optimistically add item
    const newItem = {
      videoId: effectiveId,
      playlistId,
      title: videoId ? `Loading lecture (${videoId})...` : `YouTube Playlist`,
      thumbnail,
      duration: 0,
      lastPosition: 0,
      inQueue: true,
      queueOrder: queue.length,
      lastWatchedAt: new Date().toISOString(),
    };

    setItems((prev) => {
      const existing = prev.find((i) => i.videoId === effectiveId);
      if (existing) {
        return prev.map((i) =>
          i.videoId === effectiveId ? { ...i, inQueue: true, playlistId: playlistId || i.playlistId } : i
        );
      }
      return [...prev, newItem];
    });

    if (playImmediately) {
      setActiveVideoId(effectiveId);
      setActivePlaylistId(playlistId);
      syncSettingsToServer({ activeVideoId: effectiveId });
    }

    setUrlInput('');

    // Fetch real title & author in background
    const meta = await fetchVideoMetadata(videoId, urlInput);
    const resolvedTitle = meta?.title || (videoId ? `Lecture (${videoId})` : 'YouTube Playlist');
    const resolvedThumb = meta?.thumbnail || thumbnail;

    setItems((prev) =>
      prev.map((i) =>
        i.videoId === effectiveId
          ? { ...i, title: resolvedTitle, author: meta?.author || '', thumbnail: resolvedThumb }
          : i
      )
    );

    fetch('/api/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        videoId: effectiveId,
        playlistId,
        title: resolvedTitle,
        author: meta?.author || '',
        thumbnail: resolvedThumb,
        inQueue: true,
        queueOrder: queue.length,
      }),
    }).catch(() => {});
  };

  const handleProgressSave = useCallback(
    (time, dur) => {
      if (!activeVideoId) return;
      const nowIso = new Date().toISOString();

      setItems((prev) =>
        prev.map((i) =>
          i.videoId === activeVideoId
            ? {
                ...i,
                lastPosition: time,
                duration: dur > 0 ? dur : i.duration,
                lastWatchedAt: nowIso,
              }
            : i
        )
      );

      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          videoId: activeVideoId,
          lastPosition: time,
          duration: dur,
        }),
      }).catch(() => {});
    },
    [activeVideoId, workspaceId]
  );

  const handleSelectVideo = (item) => {
    setActiveVideoId(item.videoId);
    setActivePlaylistId(item.playlistId || null);
    syncSettingsToServer({ activeVideoId: item.videoId });
  };

  const handleRemoveFromQueue = (videoId) => {
    setItems((prev) => prev.map((i) => (i.videoId === videoId ? { ...i, inQueue: false } : i)));
    fetch(`/api/items/${encodeURIComponent(videoId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    }).catch(() => {});
  };

  const handleDeleteHistoryItem = (videoId) => {
    setItems((prev) => prev.filter((i) => i.videoId !== videoId));
    fetch(
      `/api/items/${encodeURIComponent(videoId)}?workspaceId=${encodeURIComponent(workspaceId)}&hard=true`,
      { method: 'DELETE' }
    ).catch(() => {});
  };

  const handleMoveQueueItem = (fromIdx, toIdx) => {
    const updatedQueue = [...queue];
    const [moved] = updatedQueue.splice(fromIdx, 1);
    updatedQueue.splice(toIdx, 0, moved);
    const orderMap = new Map(updatedQueue.map((item, index) => [item.videoId, index]));

    setItems((prev) =>
      prev.map((item) =>
        orderMap.has(item.videoId) ? { ...item, queueOrder: orderMap.get(item.videoId) } : item
      )
    );
  };

  const handleCycleInterval = () => {
    const idx = INTERVAL_PRESETS.indexOf(seekInterval);
    const next = INTERVAL_PRESETS[(idx + 1) % INTERVAL_PRESETS.length];
    setSeekInterval(next);
    syncSettingsToServer({ seekInterval: next });
  };

  const handleCycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(playbackSpeed);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackSpeed(next);
    syncSettingsToServer({ playbackSpeed: next });
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    syncSettingsToServer({ activeMode: nextMode });
  };

  const handleInstallPwa = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-obsidian-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/15 ring-1 ring-amber-500/40">
              <Play className="h-4 w-4 fill-amber-400 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white">StudyMedia</h1>
                <span className="hidden rounded-md border border-zinc-800 bg-obsidian-900 px-2 py-0.5 font-mono text-[10px] text-zinc-400 sm:inline-block">
                  studymedia.aceddivision.com
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">Hands-Free AVRCP Lecture Player</p>
            </div>
          </div>

          {/* Mode Toggle Pill (Study | Car | Theater) */}
          <div className="flex items-center rounded-xl border border-zinc-800 bg-obsidian-900 p-1">
            <button
              type="button"
              onClick={() => handleModeChange('study')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === 'study'
                  ? 'bg-zinc-100 text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Study
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('car')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === 'car'
                  ? 'bg-amber-500 text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Car className="h-3.5 w-3.5" />
              Car
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('theater')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                mode === 'theater'
                  ? 'bg-zinc-100 text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              Theater
            </button>
          </div>

          {/* Status & Action Pills */}
          <div className="flex items-center gap-2">
            {/* Session Lock Indicator */}
            <div
              title="Silent audio lock keeps OS Bluetooth/steering-wheel controls bound to StudyMedia"
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium md:flex ${
                sessionLockActive
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-zinc-800 bg-obsidian-900 text-zinc-400'
              }`}
            >
              {sessionLockActive ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              <span>{sessionLockActive ? 'Session Lock Active' : 'Lock Standby'}</span>
            </div>

            {/* Wake Lock Toggle */}
            <button
              type="button"
              onClick={wakeLock.toggle}
              title={wakeLock.supported ? 'Keep Screen Awake' : 'Wake Lock unsupported in this browser'}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                wakeLock.enabled && wakeLock.active
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                  : 'border-zinc-800 bg-obsidian-900 text-zinc-400 hover:text-white'
              }`}
            >
              {wakeLock.enabled ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Awake</span>
            </button>

            {/* Install PWA button */}
            {installPrompt && (
              <button
                type="button"
                onClick={handleInstallPwa}
                className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-bold text-black transition hover:bg-amber-400"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Install App</span>
              </button>
            )}

            {/* Settings */}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Hardware & Sync Settings"
              className="rounded-lg border border-zinc-800 bg-obsidian-900 p-2 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-5">
        {/* Universal YouTube URL Bar */}
        <div className="mb-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAddUrl(true);
            }}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (urlError) setUrlError('');
                }}
                placeholder="Paste any YouTube lecture, live, shorts, or playlist URL..."
                className="w-full rounded-xl border border-zinc-800 bg-obsidian-900 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition focus:border-amber-500/70 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-amber-400 sm:flex-initial"
              >
                <Play className="h-4 w-4 fill-current" />
                Play Now
              </button>
              <button
                type="button"
                onClick={() => handleAddUrl(false)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-obsidian-900 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-700 hover:bg-obsidian-800"
              >
                <Plus className="h-4 w-4" />
                Queue
              </button>
            </div>
          </form>
          {urlError && <p className="mt-1.5 text-xs text-red-400">{urlError}</p>}
        </div>

        {/* Theater Mode Layout */}
        {mode === 'theater' && (
          <div className="space-y-4">
            {activeVideoId ? (
              <VideoPlayer
                ref={playerRef}
                videoId={activeVideoId.startsWith('playlist:') ? null : activeVideoId}
                playlistId={activePlaylistId}
                title={activeItem?.title}
                initialTime={activeItem?.lastPosition || 0}
                playbackSpeed={playbackSpeed}
                seekInterval={seekInterval}
                audioOnlyMode={audioOnlyMode}
                theaterMode={true}
                onStateChange={(playing) => setIsPlaying(playing)}
                onTimeUpdate={(cur, dur) => {
                  setCurrentTime(cur);
                  if (dur > 0) setDuration(dur);
                }}
                onProgressSave={handleProgressSave}
                onExitTheater={() => handleModeChange('study')}
              />
            ) : (
              <EmptyPlayerCard onLoadDemo={() => setUrlInput('https://www.youtube.com/watch?v=dQw4w9WgXcQ')} />
            )}
            <p className="text-center text-xs text-zinc-500">
              Theater mode: controls fade out after 3 seconds • Move mouse or tap to reveal
            </p>
          </div>
        )}

        {/* Study Mode Layout (matches mockup) */}
        {mode === 'study' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left / Main Stage */}
            <div className="space-y-4 lg:col-span-8 xl:col-span-9">
              {activeVideoId ? (
                <VideoPlayer
                  ref={playerRef}
                  videoId={activeVideoId.startsWith('playlist:') ? null : activeVideoId}
                  playlistId={activePlaylistId}
                  title={activeItem?.title}
                  initialTime={activeItem?.lastPosition || 0}
                  playbackSpeed={playbackSpeed}
                  seekInterval={seekInterval}
                  audioOnlyMode={audioOnlyMode}
                  theaterMode={false}
                  onStateChange={(playing) => setIsPlaying(playing)}
                  onTimeUpdate={(cur, dur) => {
                    setCurrentTime(cur);
                    if (dur > 0) setDuration(dur);
                  }}
                  onProgressSave={handleProgressSave}
                />
              ) : (
                <EmptyPlayerCard />
              )}

              {/* Progress Scrubber & Timestamps */}
              <div className="rounded-2xl border border-zinc-800/80 bg-obsidian-900 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-zinc-100">
                    {activeItem?.title || 'Ready to study'}
                  </p>
                  <span className="shrink-0 font-mono text-xs text-zinc-400">
                    {formatTime(currentTime)} <span className="text-zinc-600">/</span>{' '}
                    {formatTime(duration)}
                  </span>
                </div>

                {/* Amber Progress Bar */}
                <div className="relative mb-4 flex h-4 items-center">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-obsidian-800">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    value={currentTime}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      playerRef.current?.seekTo(val);
                      setCurrentTime(val);
                    }}
                    className="study-scrubber absolute inset-0 h-full w-full"
                  />
                </div>

                {/* Study Mode Controls Bar (matches mockup) */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handlePrevVideo}
                      disabled={queue.length < 2}
                      title="Previous Video"
                      className="rounded-full p-2 text-zinc-400 transition hover:bg-obsidian-800 hover:text-white disabled:opacity-30"
                    >
                      <SkipBack className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeekRelative(-seekInterval)}
                      title={`Rewind ${seekInterval}s`}
                      className="flex h-11 items-center gap-1.5 rounded-full border border-zinc-700/80 bg-obsidian-800 px-3.5 text-xs font-bold text-zinc-100 transition active:scale-95 hover:border-amber-500/60"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {seekInterval}
                    </button>

                    <button
                      type="button"
                      onClick={() => playerRef.current?.togglePlay()}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-black shadow-lg transition active:scale-95 hover:bg-zinc-200"
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5 fill-current" />
                      ) : (
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeekRelative(seekInterval)}
                      title={`Forward ${seekInterval}s`}
                      className="flex h-11 items-center gap-1.5 rounded-full border border-zinc-700/80 bg-obsidian-800 px-3.5 text-xs font-bold text-zinc-100 transition active:scale-95 hover:border-amber-500/60"
                    >
                      {seekInterval}
                      <RotateCw className="h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={handleNextVideo}
                      disabled={queue.length < 2}
                      title="Next Video"
                      className="rounded-full p-2 text-zinc-400 transition hover:bg-obsidian-800 hover:text-white disabled:opacity-30"
                    >
                      <SkipForward className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Interval Pill (Amber) */}
                    <button
                      type="button"
                      onClick={handleCycleInterval}
                      title="Click to cycle seek interval"
                      className="rounded-full bg-amber-500 px-3.5 py-1.5 font-mono text-xs font-bold text-black transition hover:bg-amber-400"
                    >
                      {seekInterval}s
                    </button>

                    {/* Playback Speed Pill */}
                    <button
                      type="button"
                      onClick={handleCycleSpeed}
                      title="Click to cycle playback speed"
                      className="rounded-full border border-zinc-700 bg-obsidian-800 px-3.5 py-1.5 font-mono text-xs font-semibold text-zinc-200 transition hover:border-zinc-600 hover:text-white"
                    >
                      {playbackSpeed}x
                    </button>

                    {/* Audio-Only Mode Pill */}
                    <button
                      type="button"
                      onClick={() => setAudioOnlyMode((prev) => !prev)}
                      title="Toggle Audio-Only / Minimal Distraction Mode"
                      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        audioOnlyMode
                          ? 'border-amber-500/50 bg-amber-500/15 text-amber-400'
                          : 'border-zinc-700 bg-obsidian-800 text-zinc-300 hover:text-white'
                      }`}
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Audio Only</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar: Queue & History */}
            <div className="lg:col-span-4 xl:col-span-3">
              <QueuePanel
                queue={queue}
                history={history}
                activeVideoId={activeVideoId}
                onSelectVideo={handleSelectVideo}
                onRemoveFromQueue={handleRemoveFromQueue}
                onDeleteHistoryItem={handleDeleteHistoryItem}
                onMoveQueueItem={handleMoveQueueItem}
              />
            </div>
          </div>
        )}

        {/* Car Mode Layout */}
        {mode === 'car' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-8">
              <CarControlDeck
                title={activeItem?.title}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                seekInterval={seekInterval}
                playbackSpeed={playbackSpeed}
                hasPrev={queue.length > 1}
                hasNext={queue.length > 1}
                lastSignal={lastSignal}
                onTogglePlay={() => playerRef.current?.togglePlay()}
                onSeekRelative={handleSeekRelative}
                onPrevVideo={handlePrevVideo}
                onNextVideo={handleNextVideo}
                onChangeInterval={(sec) => {
                  setSeekInterval(sec);
                  syncSettingsToServer({ seekInterval: sec });
                }}
                onChangeSpeed={(spd) => {
                  setPlaybackSpeed(spd);
                  syncSettingsToServer({ playbackSpeed: spd });
                }}
                onTestSignal={triggerTestSignal}
              />

              {/* Keep YouTube Player mounted in Car Mode (Audio-Only friendly) */}
              {activeVideoId && (
                <div className="overflow-hidden rounded-2xl">
                  <VideoPlayer
                    ref={playerRef}
                    videoId={activeVideoId.startsWith('playlist:') ? null : activeVideoId}
                    playlistId={activePlaylistId}
                    title={activeItem?.title}
                    initialTime={activeItem?.lastPosition || 0}
                    playbackSpeed={playbackSpeed}
                    seekInterval={seekInterval}
                    audioOnlyMode={true}
                    theaterMode={false}
                    onStateChange={(playing) => setIsPlaying(playing)}
                    onTimeUpdate={(cur, dur) => {
                      setCurrentTime(cur);
                      if (dur > 0) setDuration(dur);
                    }}
                    onProgressSave={handleProgressSave}
                  />
                </div>
              )}
            </div>

            <div className="lg:col-span-4">
              <QueuePanel
                queue={queue}
                history={history}
                activeVideoId={activeVideoId}
                onSelectVideo={handleSelectVideo}
                onRemoveFromQueue={handleRemoveFromQueue}
                onDeleteHistoryItem={handleDeleteHistoryItem}
                onMoveQueueItem={handleMoveQueueItem}
              />
            </div>
          </div>
        )}
      </main>

      {/* Live Hardware Signal Intercept Toast */}
      {showSignalToast && lastSignal && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-amber-500/40 bg-obsidian-900/95 px-4 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md">
          <Radio className="h-4 w-4 text-amber-400" />
          <span className="font-mono text-amber-400">{lastSignal.type}</span>
          <span className="text-zinc-300">{lastSignal.detail}</span>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        seekInterval={seekInterval}
        doubleTapToSkip={doubleTapToSkip}
        doubleTapWindow={doubleTapWindow}
        workspaceId={workspaceId}
        dbConnected={dbConnected}
        onSave={(next) => {
          setSeekInterval(next.seekInterval);
          setDoubleTapToSkip(next.doubleTapToSkip);
          setDoubleTapWindow(next.doubleTapWindow);
          setWorkspaceId(next.workspaceId);
          syncSettingsToServer(next);
        }}
      />
    </div>
  );
}

function EmptyPlayerCard() {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-obsidian-900/60 p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/30">
        <Play className="ml-1 h-7 w-7 text-amber-400" />
      </div>
      <h2 className="text-lg font-bold text-white">Paste a YouTube Lecture to Start</h2>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
        Your Bluetooth earbuds & steering wheel Back/Forward buttons will scrub by your chosen interval instead of skipping videos.
      </p>
    </div>
  );
}
