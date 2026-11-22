import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
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
  Upload,
  WifiOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  RefreshCw,
  ListPlus,
} from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import QueuePanel from './components/QueuePanel';
import CarControlDeck from './components/CarControlDeck';
import SettingsModal from './components/SettingsModal';
import SpeedPopover from './components/SpeedPopover';
import { useMediaSession } from './hooks/useMediaSession';
import { useWakeLock } from './hooks/useWakeLock';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { formatTime } from './utils/youtube';
import {
  detectSourceFromUrl,
  createLocalQueueItem,
  normalizeQueueItem,
  fetchSourceMetadata,
  fetchYouTubePlaylist,
  getExternalUrl,
} from './utils/sourceDetector';
import {
  saveMediaFile,
  deleteMediaFile,
  clearAllMediaFiles,
  extractMediaInfo,
} from './storage/mediaDB';
import {
  extractViaSidecar,
  loadSidecarConfig,
  saveSidecarConfig,
  DEFAULT_FALLBACK_CONVERTER_URL,
} from './utils/sidecarClient';
import { SequentialPlaylistDownloader } from './utils/playlistDownloader';

const STORAGE_KEY = 'studymedia_state_v1';
const DEFAULT_PLAYLIST_ID = 'default';
const INTERVAL_PRESETS = [5, 10, 15, 30, 60];

function createDefaultPlaylist(items = []) {
  return {
    id: DEFAULT_PLAYLIST_ID,
    name: 'Study Queue',
    createdAt: Date.now(),
    items,
  };
}

function normalizePlaylists(rawPlaylists) {
  if (!Array.isArray(rawPlaylists) || rawPlaylists.length === 0) return null;
  const cleaned = rawPlaylists
    .filter((pl) => pl && typeof pl === 'object')
    .map((pl, idx) => ({
      id: String(pl.id || `pl_${Date.now()}_${idx}`),
      name: String(pl.name || (idx === 0 ? 'Study Queue' : `Playlist ${idx + 1}`)).trim() || 'Study Queue',
      createdAt: Number(pl.createdAt) || Date.now(),
      items: Array.isArray(pl.items)
        ? pl.items.map(normalizeQueueItem).filter(Boolean)
        : [],
    }));
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Load state from localStorage and cleanly migrate any legacy flat `items` queue
 * into the new named `playlists` array without losing any items or timestamps.
 */
function loadLocalState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        playlists: [createDefaultPlaylist([])],
        activePlaylistId: DEFAULT_PLAYLIST_ID,
        history: [],
      };
    }

    const parsed = JSON.parse(raw);

    // Case 1: Already migrated to named playlists
    const existingPlaylists = normalizePlaylists(parsed?.playlists);
    if (existingPlaylists) {
      const normalizedHistory = Array.isArray(parsed.history)
        ? parsed.history.map(normalizeQueueItem).filter(Boolean)
        : [];
      const activePlaylistId = existingPlaylists.some((p) => p.id === parsed.activePlaylistId)
        ? parsed.activePlaylistId
        : existingPlaylists[0].id;

      return {
        ...parsed,
        playlists: existingPlaylists,
        activePlaylistId,
        history: normalizedHistory,
      };
    }

    // Case 2: Legacy flat `items` schema -> migrate cleanly into "Study Queue" playlist + history
    const legacyItems = Array.isArray(parsed?.items)
      ? parsed.items.map(normalizeQueueItem).filter(Boolean)
      : [];

    const queuedItems = legacyItems
      .filter((i) => i.inQueue)
      .sort((a, b) => (a.queueOrder ?? 0) - (b.queueOrder ?? 0));

    return {
      ...parsed,
      playlists: [createDefaultPlaylist(queuedItems)],
      activePlaylistId: DEFAULT_PLAYLIST_ID,
      history: legacyItems,
    };
  } catch {
    return {
      playlists: [createDefaultPlaylist([])],
      activePlaylistId: DEFAULT_PLAYLIST_ID,
      history: [],
    };
  }
}

export default function App() {
  const initialLocal = useMemo(() => loadLocalState(), []);
  const initialSidecar = useMemo(() => loadSidecarConfig(), []);

  const [workspaceId, setWorkspaceId] = useState(initialLocal?.workspaceId || 'default');
  const [playlists, setPlaylists] = useState(
    () => initialLocal?.playlists || [createDefaultPlaylist([])]
  );
  const [activePlaylistId, setActivePlaylistId] = useState(
    () => initialLocal?.activePlaylistId || DEFAULT_PLAYLIST_ID
  );
  const [historyItems, setHistoryItems] = useState(() => initialLocal?.history || []);
  const [activeItemId, setActiveItemId] = useState(
    initialLocal?.activeItemId || initialLocal?.activeVideoId || null
  );

  const [mode, setMode] = useState(initialLocal?.mode || 'study'); // 'study' | 'car' | 'theater'
  const [seekInterval, setSeekInterval] = useState(initialLocal?.seekInterval || 15);
  const [playbackSpeed, setPlaybackSpeed] = useState(initialLocal?.playbackSpeed || 1.25);
  const [doubleTapToSkip, setDoubleTapToSkip] = useState(
    initialLocal?.doubleTapToSkip !== undefined ? Boolean(initialLocal.doubleTapToSkip) : false
  );
  const [doubleTapWindow, setDoubleTapWindow] = useState(initialLocal?.doubleTapWindow || 450);
  const [autoPlayNext, setAutoPlayNext] = useState(
    initialLocal?.autoPlayNext !== undefined ? Boolean(initialLocal.autoPlayNext) : true
  );
  const [audioOnlyMode, setAudioOnlyMode] = useState(initialLocal?.audioOnlyMode || false);

  const [sidecarUrl, setSidecarUrl] = useState(initialSidecar.sidecarUrl);
  const [sidecarApiKey, setSidecarApiKey] = useState(initialSidecar.sidecarApiKey);
  const [fallbackConverterUrl, setFallbackConverterUrl] = useState(
    initialSidecar.fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL
  );

  const [urlInput, setUrlInput] = useState('');
  const [urlError, setUrlError] = useState('');
  const [playlistImportMode, setPlaylistImportMode] = useState('new'); // 'new' | 'append'
  const [isAddingUrl, setIsAddingUrl] = useState(false);

  // Multi-file sequential local import progress
  const [localImportProgress, setLocalImportProgress] = useState(null); // null | { current, total, fileName }
  const isImportingLocal = Boolean(localImportProgress);

  // Single-item sidecar extraction state
  const [extractingItemId, setExtractingItemId] = useState(null);
  const [extractProgress, setExtractProgress] = useState(null);

  // Sequential offline playlist download state
  const [batchDownload, setBatchDownload] = useState(null);
  const [batchErrors, setBatchErrors] = useState({});
  const playlistDownloaderRef = useRef(null);
  if (!playlistDownloaderRef.current) {
    playlistDownloaderRef.current = new SequentialPlaylistDownloader();
  }

  const [isRefreshingApp, setIsRefreshingApp] = useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dbConnected, setDbConnected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showSignalToast, setShowSignalToast] = useState(false);
  const [statusToast, setStatusToast] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);

  const playerRef = useRef(null);
  const localFileInputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const statusToastTimerRef = useRef(null);
  const dragCounterRef = useRef(0);

  const wakeLock = useWakeLock(true);
  const isOnline = useOnlineStatus();
  const sidecarConfigured = Boolean(sidecarUrl.trim() && sidecarApiKey.trim());

  const showNotice = useCallback((text, type = 'success') => {
    setStatusToast({ id: Date.now(), type, text });
    clearTimeout(statusToastTimerRef.current);
    statusToastTimerRef.current = setTimeout(() => setStatusToast(null), 3800);
  }, []);

  // Derived active playlist, queue, history, and active playing item
  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || playlists[0] || createDefaultPlaylist([]),
    [playlists, activePlaylistId]
  );

  const queue = activePlaylist.items;

  const history = useMemo(
    () =>
      [...historyItems].sort(
        (a, b) => new Date(b.lastWatchedAt || 0).getTime() - new Date(a.lastWatchedAt || 0).getTime()
      ),
    [historyItems]
  );

  // Resolve activeItem across active playlist -> all playlists -> history
  // so browsing/reordering/switching playlists NEVER interrupts active playback
  const activeItem = useMemo(() => {
    if (!activeItemId) return null;
    const inActive = queue.find((i) => (i.id || i.videoId) === activeItemId);
    if (inActive) return inActive;
    for (const pl of playlists) {
      const found = pl.items.find((i) => (i.id || i.videoId) === activeItemId);
      if (found) return found;
    }
    return historyItems.find((i) => (i.id || i.videoId) === activeItemId) || null;
  }, [activeItemId, queue, playlists, historyItems]);

  // Playlist currently playing from (used by Next/Prev hardware & deck controls)
  const playingPlaylistItems = useMemo(() => {
    if (activeItemId) {
      if (queue.some((i) => i.id === activeItemId)) return queue;
      const owner = playlists.find((pl) => pl.items.some((i) => i.id === activeItemId));
      if (owner) return owner.items;
    }
    return queue;
  }, [activeItemId, queue, playlists]);

  const urlLooksLikePlaylist = useMemo(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return false;
    return /[?&]list=[a-zA-Z0-9_-]{8,}/i.test(trimmed);
  }, [urlInput]);

  // Helper: update a single item consistently across ALL playlists and history
  const updateItemAcrossAll = useCallback((itemId, updater) => {
    setPlaylists((prev) =>
      prev.map((pl) => ({
        ...pl,
        items: pl.items.map((item) =>
          item.id === itemId ? updater(item) : item
        ),
      }))
    );
    setHistoryItems((prev) =>
      prev.map((item) => (item.id === itemId ? updater(item) : item))
    );
  }, []);

  // Helper: upsert items into watch history cleanly
  const upsertHistoryItems = useCallback((incomingList) => {
    if (!Array.isArray(incomingList) || incomingList.length === 0) return;
    setHistoryItems((prev) => {
      const map = new Map(prev.map((i) => [i.id, i]));
      for (const item of incomingList) {
        const existing = map.get(item.id);
        map.set(item.id, existing ? { ...existing, ...item } : item);
      }
      return Array.from(map.values());
    });
  }, []);

  // Persist named playlists & core state to localStorage immediately
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          workspaceId,
          playlists,
          activePlaylistId,
          history: historyItems,
          activeItemId,
          activeVideoId: activeItemId,
          mode,
          seekInterval,
          playbackSpeed,
          doubleTapToSkip,
          doubleTapWindow,
          autoPlayNext,
          audioOnlyMode,
        })
      );
    } catch {
      // Ignore quota errors
    }
  }, [
    workspaceId,
    playlists,
    activePlaylistId,
    historyItems,
    activeItemId,
    mode,
    seekInterval,
    playbackSpeed,
    doubleTapToSkip,
    doubleTapWindow,
    autoPlayNext,
    audioOnlyMode,
  ]);

  // Persist Sidecar & Tier 2 Fallback Converter config in localStorage
  useEffect(() => {
    saveSidecarConfig({ sidecarUrl, sidecarApiKey, fallbackConverterUrl });
  }, [sidecarUrl, sidecarApiKey, fallbackConverterUrl]);

  // Listen for PWA install prompt
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Sync from MongoDB backend on mount / workspaceId change (safely preserving device-local offline items)
  useEffect(() => {
    if (!isOnline) return;
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

        if (data.settings) {
          if (data.settings.seekInterval) setSeekInterval(data.settings.seekInterval);
          if (data.settings.playbackSpeed) setPlaybackSpeed(data.settings.playbackSpeed);
          if (data.settings.doubleTapToSkip !== undefined)
            setDoubleTapToSkip(Boolean(data.settings.doubleTapToSkip));
          if (data.settings.doubleTapWindow) setDoubleTapWindow(data.settings.doubleTapWindow);
          if (data.settings.autoPlayNext !== undefined)
            setAutoPlayNext(Boolean(data.settings.autoPlayNext));
          if (data.settings.activeMode) setMode(data.settings.activeMode);
          if (data.settings.activeVideoId && !activeItemId)
            setActiveItemId(data.settings.activeVideoId);
          if (data.settings.sidecarUrl && !sidecarUrl)
            setSidecarUrl(data.settings.sidecarUrl);
          if (data.settings.sidecarApiKey && !sidecarApiKey)
            setSidecarApiKey(data.settings.sidecarApiKey);
          if (data.settings.fallbackConverterUrl)
            setFallbackConverterUrl(data.settings.fallbackConverterUrl);

          const remotePlaylists = normalizePlaylists(data.settings.playlists);
          if (remotePlaylists) {
            setPlaylists((prev) => {
              const localOfflineById = new Map();
              for (const pl of prev) {
                for (const item of pl.items) {
                  if (item.isOfflineReady) localOfflineById.set(item.id, item);
                }
              }
              return remotePlaylists.map((pl) => ({
                ...pl,
                items: pl.items.map((item) => {
                  const localCopy = localOfflineById.get(item.id);
                  return localCopy
                    ? {
                        ...item,
                        ...localCopy,
                        lastPosition: Math.max(item.lastPosition || 0, localCopy.lastPosition || 0),
                      }
                    : item;
                }),
              }));
            });
          }
        }

        if (Array.isArray(data.items) && data.items.length > 0) {
          const remoteNormalized = data.items.map(normalizeQueueItem).filter(Boolean);
          upsertHistoryItems(remoteNormalized);
        }
      } catch {
        // Offline or local-only fallback
      }
    }
    syncFromServer();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, isOnline]);

  const syncSettingsToServer = useCallback(
    (patch) => {
      if (!isOnline) return;
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, ...patch }),
      }).catch(() => {});
    },
    [workspaceId, isOnline]
  );

  // Sync non-local playlist structure to MongoDB when playlists change (debounced)
  useEffect(() => {
    if (!isOnline || !dbConnected) return;
    const timer = setTimeout(() => {
      const syncablePlaylists = playlists.map((pl) => ({
        id: pl.id,
        name: pl.name,
        createdAt: pl.createdAt,
        items: pl.items
          .filter((i) => i.sourceType !== 'local' || i.sourceUrl)
          .map((i) => ({
            ...i,
            // Never push local blob IDs to other devices
            localBlobId: null,
            isOfflineReady: false,
          })),
      }));
      syncSettingsToServer({ playlists: syncablePlaylists });
    }, 1500);
    return () => clearTimeout(timer);
  }, [playlists, isOnline, dbConnected, syncSettingsToServer]);

  const syncItemToServer = useCallback(
    (item) => {
      if (!isOnline || !item || item.sourceType === 'local' || item.id.startsWith('local:')) return;
      fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          videoId: item.id,
          sourceType: item.sourceType,
          sourceUrl: item.sourceUrl,
          playlistId: item.playlistId,
          playlistTitle: item.playlistTitle,
          title: item.title,
          author: item.author || '',
          thumbnail: item.thumbnail || '',
          duration: item.duration || 0,
          lastPosition: item.lastPosition || 0,
          inQueue: true,
          queueOrder: item.queueOrder || 0,
        }),
      }).catch(() => {});
    },
    [workspaceId, isOnline]
  );

  // Playable track list & Prev/Next boundary flags (skips online-only items when offline)
  const playableTrackList = useMemo(() => {
    if (playingPlaylistItems.length === 0) return [];
    if (isOnline) return playingPlaylistItems;
    return playingPlaylistItems.filter((i) => i.isOfflineReady);
  }, [playingPlaylistItems, isOnline]);

  const currentTrackIndex = useMemo(
    () => playableTrackList.findIndex((i) => i.id === activeItemId),
    [playableTrackList, activeItemId]
  );

  const hasPrevTrack = currentTrackIndex > 0;
  const hasNextTrack =
    currentTrackIndex >= 0 && currentTrackIndex < playableTrackList.length - 1;

  // Navigation between lectures in the active playing playlist (respects offline mode & bounds)
  const handleNextTrack = useCallback(() => {
    if (playableTrackList.length === 0) return;
    if (currentTrackIndex < 0) {
      const first = playableTrackList[0];
      if (first) {
        setActiveItemId(first.id);
        if (first.sourceType !== 'local') syncSettingsToServer({ activeVideoId: first.id });
      }
      return;
    }
    if (currentTrackIndex >= playableTrackList.length - 1) return;
    const next = playableTrackList[currentTrackIndex + 1];
    if (next) {
      setActiveItemId(next.id);
      if (next.sourceType !== 'local') {
        syncSettingsToServer({ activeVideoId: next.id });
      }
    }
  }, [playableTrackList, currentTrackIndex, syncSettingsToServer]);

  const handlePrevTrack = useCallback(() => {
    if (playableTrackList.length === 0 || currentTrackIndex <= 0) return;
    const prev = playableTrackList[currentTrackIndex - 1];
    if (prev) {
      setActiveItemId(prev.id);
      if (prev.sourceType !== 'local') {
        syncSettingsToServer({ activeVideoId: prev.id });
      }
    }
  }, [playableTrackList, currentTrackIndex, syncSettingsToServer]);

  // Auto-advance strictly to the next playable item when a video ends (keeps fullscreen active)
  const handleAutoAdvance = useCallback(() => {
    if (!autoPlayNext) return;
    if (playingPlaylistItems.length === 0) return;

    const rawIdx = playingPlaylistItems.findIndex((i) => i.id === activeItemId);
    if (rawIdx < 0) return;

    // Scan forward from the finished lecture; skip online-only items when offline
    for (let i = rawIdx + 1; i < playingPlaylistItems.length; i++) {
      const candidate = playingPlaylistItems[i];
      if (isOnline || candidate.isOfflineReady) {
        setActiveItemId(candidate.id);
        if (candidate.sourceType !== 'local') {
          syncSettingsToServer({ activeVideoId: candidate.id });
        }
        return;
      }
    }
  }, [autoPlayNext, playingPlaylistItems, activeItemId, isOnline, syncSettingsToServer]);

  const seekIntervalRef = useRef(seekInterval);
  seekIntervalRef.current = seekInterval;

  const handleSeekRelative = useCallback((delta) => {
    playerRef.current?.seekRelative(delta);
  }, []);

  const handleSeekTo = useCallback((seconds) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  const handleTogglePlay = useCallback(() => {
    playerRef.current?.togglePlay();
  }, []);

  const handlePlay = useCallback(() => {
    playerRef.current?.play();
  }, []);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  // Unified Hardware MediaSession & Conditional Silent Audio Lock
  const { sessionLockActive, sessionLockMode, lastSignal, triggerTestSignal } = useMediaSession({
    sourceType: activeItem?.sourceType || 'youtube',
    isPlaying,
    title: activeItem?.title || (activeItemId ? `Lecture (${activeItemId})` : 'StudyMedia'),
    thumbnail: activeItem?.thumbnail || '',
    seekInterval,
    playbackSpeed,
    duration,
    currentTime,
    doubleTapToSkip,
    doubleTapWindow,
    onSeekRelative: handleSeekRelative,
    onSeekTo: handleSeekTo,
    onNextTrack: handleNextTrack,
    onPrevTrack: handlePrevTrack,
    onTogglePlay: handleTogglePlay,
    onPlay: handlePlay,
    onPause: handlePause,
  });

  // Show floating toast briefly whenever hardware signal arrives
  useEffect(() => {
    if (!lastSignal) return;
    setShowSignalToast(true);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setShowSignalToast(false), 2600);
    return () => clearTimeout(toastTimerRef.current);
  }, [lastSignal]);

  // Keyboard shortcuts for desktop usability (reads live seekIntervalRef)
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        playerRef.current?.togglePlay();
      } else if (e.code === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        handleSeekRelative(-seekIntervalRef.current);
      } else if (e.code === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        handleSeekRelative(seekIntervalRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSeekRelative]);

  // --- Named Playlist Curation ---
  const handleSelectPlaylist = useCallback((playlistId) => {
    setActivePlaylistId(playlistId);
  }, []);

  const handleCreatePlaylist = useCallback(
    (name) => {
      const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newPlaylist = {
        id,
        name: name.trim() || 'Untitled Playlist',
        createdAt: Date.now(),
        items: [],
      };
      setPlaylists((prev) => [...prev, newPlaylist]);
      setActivePlaylistId(id);
      showNotice(`Created playlist "${newPlaylist.name}"`, 'success');
    },
    [showNotice]
  );

  const handleRenamePlaylist = useCallback(
    (playlistId, nextName) => {
      const clean = nextName.trim();
      if (!clean) return;
      setPlaylists((prev) =>
        prev.map((pl) => (pl.id === playlistId ? { ...pl, name: clean } : pl))
      );
      showNotice(`Renamed playlist to "${clean}"`, 'info');
    },
    [showNotice]
  );

  const handleDeletePlaylist = useCallback(
    (playlistId) => {
      setPlaylists((prev) => {
        if (prev.length <= 1) return prev;
        const remaining = prev.filter((pl) => pl.id !== playlistId);
        if (activePlaylistId === playlistId && remaining[0]) {
          setActivePlaylistId(remaining[0].id);
        }
        return remaining;
      });
      showNotice('Deleted playlist', 'info');
    },
    [activePlaylistId, showNotice]
  );

  // Touch & Pointer Drag-and-Drop / Move Up-Down reordering (never disturbs active playback!)
  const handleMoveQueueItem = useCallback(
    (fromIdx, toIdx) => {
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== activePlaylist.id) return pl;
          if (
            fromIdx < 0 ||
            toIdx < 0 ||
            fromIdx >= pl.items.length ||
            toIdx >= pl.items.length
          ) {
            return pl;
          }
          const reordered = arrayMove(pl.items, fromIdx, toIdx).map((item, idx) => ({
            ...item,
            queueOrder: idx,
          }));
          return { ...pl, items: reordered };
        })
      );
    },
    [activePlaylist.id]
  );

  // --- Sequential Multi-File Local Media Import (Mobile RAM safe) ---
  const handleImportLocalFiles = useCallback(
    async (fileList, playFirst = true) => {
      const files = Array.from(fileList || []).filter(
        (f) =>
          f.type.startsWith('video/') ||
          f.type.startsWith('audio/') ||
          /\.(mp4|m4v|webm|mov|mp3|m4a|wav|ogg|aac|flac|opus)$/i.test(f.name)
      );

      if (files.length === 0) {
        showNotice('Please choose valid video or audio files (MP4, MP3, M4A, WebM).', 'error');
        return;
      }

      const targetPlaylistId = activePlaylist.id;
      let firstImportedId = null;
      let importedCount = 0;

      try {
        for (let idx = 0; idx < files.length; idx++) {
          const file = files[idx];
          setLocalImportProgress({
            current: idx + 1,
            total: files.length,
            fileName: file.name,
          });

          const info = await extractMediaInfo(file, 5);
          const id = `local:${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;

          await saveMediaFile({
            id,
            fileName: file.name,
            mimeType: file.type || (info.isAudio ? 'audio/mpeg' : 'video/mp4'),
            sizeBytes: file.size,
            blob: file,
            thumbnailDataUrl: info.thumbnailDataUrl,
            duration: info.duration,
          });

          const newItem = createLocalQueueItem({
            id,
            fileName: file.name,
            mimeType: file.type || (info.isAudio ? 'audio/mpeg' : 'video/mp4'),
            sizeBytes: file.size,
            thumbnailDataUrl: info.thumbnailDataUrl,
            duration: info.duration,
            queueOrder: idx,
          });

          if (!firstImportedId) firstImportedId = newItem.id;
          importedCount += 1;

          // Append each completed file immediately into the active playlist & history
          setPlaylists((prev) =>
            prev.map((pl) =>
              pl.id === targetPlaylistId
                ? {
                    ...pl,
                    items: [...pl.items, { ...newItem, queueOrder: pl.items.length }],
                  }
                : pl
            )
          );
          upsertHistoryItems([newItem]);
        }

        if (playFirst && firstImportedId) {
          setActiveItemId(firstImportedId);
        }

        showNotice(
          importedCount === 1
            ? `Saved 1 local lecture to "${activePlaylist.name}" (Offline Ready)`
            : `Imported ${importedCount} offline lectures into "${activePlaylist.name}"`,
          'success'
        );
      } catch (err) {
        showNotice(err?.message || 'Failed to save local media to IndexedDB.', 'error');
      } finally {
        setLocalImportProgress(null);
      }
    },
    [activePlaylist.id, activePlaylist.name, showNotice, upsertHistoryItems]
  );

  // Desktop multi-file drag-and-drop listeners
  useEffect(() => {
    const onDragEnter = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsDraggingFiles(true);
    };
    const onDragOver = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
    };
    const onDragLeave = (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) setIsDraggingFiles(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingFiles(false);
      if (e.dataTransfer?.files?.length) {
        handleImportLocalFiles(e.dataTransfer.files, !activeItemId);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleImportLocalFiles, activeItemId]);

  // Upgrade an existing item (e.g. Error 101/150 restricted video) to a local IndexedDB copy
  const handleReplaceWithLocalFile = useCallback(
    async (targetItem, file) => {
      if (!targetItem || !file) return;
      setLocalImportProgress({ current: 1, total: 1, fileName: file.name });
      try {
        const info = await extractMediaInfo(file, 5);
        const blobId = `local-upgrade:${targetItem.id}:${Date.now()}`;

        if (targetItem.localBlobId) {
          await deleteMediaFile(targetItem.localBlobId).catch(() => {});
        }

        await saveMediaFile({
          id: blobId,
          fileName: file.name,
          mimeType: file.type || (info.isAudio ? 'audio/mpeg' : 'video/mp4'),
          sizeBytes: file.size,
          blob: file,
          thumbnailDataUrl: targetItem.thumbnail || info.thumbnailDataUrl || null,
          duration: info.duration > 0 ? info.duration : targetItem.duration || 0,
        });

        updateItemAcrossAll(targetItem.id, (i) => ({
          ...i,
          sourceType: 'local',
          localBlobId: blobId,
          isOfflineReady: true,
          mimeType: file.type || (info.isAudio ? 'audio/mpeg' : 'video/mp4'),
          sizeBytes: file.size,
          thumbnail: i.thumbnail || info.thumbnailDataUrl || null,
          duration: info.duration > 0 ? info.duration : i.duration,
          downloadError: null,
          lastWatchedAt: new Date().toISOString(),
        }));

        setBatchErrors((prev) => {
          if (!prev[targetItem.id]) return prev;
          const next = { ...prev };
          delete next[targetItem.id];
          return next;
        });

        setActiveItemId(targetItem.id);
        showNotice(`Upgraded "${targetItem.title}" to Offline Ready local playback!`, 'success');
      } catch (err) {
        showNotice(err?.message || 'Could not import local replacement file.', 'error');
      } finally {
        setLocalImportProgress(null);
      }
    },
    [showNotice, updateItemAcrossAll]
  );

  // Pull a single YouTube lecture via the user's private Home Sidecar straight into IndexedDB
  const handleFetchViaSidecar = useCallback(
    async (targetItem, format = 'mp4') => {
      const url = getExternalUrl(targetItem);
      if (!url || !sidecarConfigured) {
        showNotice('Configure your Home Sidecar URL & API key in Settings first.', 'error');
        return;
      }

      setExtractingItemId(targetItem.id);
      setExtractProgress({ phase: 'extracting', receivedBytes: 0, totalBytes: 0, pct: null });
      showNotice(`Requesting ${format.toUpperCase()} from Home Sidecar...`, 'info');
      try {
        const result = await extractViaSidecar({
          baseUrl: sidecarUrl,
          apiKey: sidecarApiKey,
          url,
          format,
          onProgress: (prog) => setExtractProgress(prog),
        });

        const fileLike = new File([result.blob], result.fileName, { type: result.mimeType });
        await handleReplaceWithLocalFile(targetItem, fileLike);
      } catch (err) {
        showNotice(err?.message || 'Sidecar extraction failed.', 'error');
      } finally {
        setExtractingItemId(null);
        setExtractProgress(null);
      }
    },
    [sidecarConfigured, sidecarUrl, sidecarApiKey, handleReplaceWithLocalFile, showNotice]
  );

  // --- Sequential Offline Playlist Downloader ---
  const handleStartPlaylistDownload = useCallback(
    async (playlist, format = 'mp4') => {
      if (!playlist) return;
      const downloader = playlistDownloaderRef.current;
      if (downloader.isRunning()) {
        showNotice('A playlist download is already in progress.', 'info');
        return;
      }

      const result = await downloader.start({
        playlistId: playlist.id,
        items: playlist.items,
        format,
        sidecarUrl,
        sidecarApiKey,
        onPreflightFailed: (message) => {
          showNotice(message, 'error');
        },
        onStateUpdate: (state) => {
          setBatchDownload(state);
        },
        onItemComplete: (item, upgradePatch) => {
          updateItemAcrossAll(item.id, (existing) => ({
            ...existing,
            ...upgradePatch,
          }));
          setBatchErrors((prev) => {
            if (!prev[item.id]) return prev;
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
        },
        onItemError: (item, errorMessage) => {
          setBatchErrors((prev) => ({ ...prev, [item.id]: errorMessage }));
        },
      });

      if (!result?.started) return;

      if (result.cancelled) {
        showNotice(
          result.completed > 0
            ? `Download cancelled — ${result.completed} completed lecture${
                result.completed === 1 ? '' : 's'
              } saved offline.`
            : 'Playlist download cancelled.',
          'info'
        );
      } else if (result.failed > 0) {
        showNotice(
          `Saved ${result.completed} of ${result.total} lectures offline (${result.failed} failed).`,
          'info'
        );
      } else if (result.completed > 0) {
        showNotice(
          `Downloaded all ${result.completed} lectures in "${playlist.name}" for offline playback!`,
          'success'
        );
      }
    },
    [sidecarUrl, sidecarApiKey, showNotice, updateItemAcrossAll]
  );

  const handleTogglePausePlaylistDownload = useCallback(() => {
    const downloader = playlistDownloaderRef.current;
    if (!downloader.isRunning()) return;
    if (downloader.isPaused()) {
      downloader.resume();
      setBatchDownload((prev) => (prev ? { ...prev, status: 'downloading' } : null));
    } else {
      downloader.pause();
      setBatchDownload((prev) => (prev ? { ...prev, status: 'paused' } : null));
    }
  }, []);

  const handleCancelPlaylistDownload = useCallback(() => {
    playlistDownloaderRef.current.cancel();
  }, []);

  // Add or Play any URL (YouTube video, YouTube playlist, Vimeo, or Direct MP4/MP3)
  const handleAddUrl = async (playImmediately = true) => {
    setUrlError('');
    const detected = detectSourceFromUrl(urlInput);

    if (!detected) {
      setUrlError(
        'Please paste a valid YouTube, YouTube Playlist, Vimeo, or direct MP4/MP3/WebM media URL.'
      );
      return;
    }

    const rawUrl = urlInput.trim();
    setUrlInput('');

    // Handle YouTube Playlist expansion -> create named playlist OR append to current playlist
    if (detected.sourceType === 'youtube' && detected.isPlaylist && detected.playlistId) {
      setIsAddingUrl(true);
      try {
        const playlistData = await fetchYouTubePlaylist(detected.playlistId);
        if (playlistData && Array.isArray(playlistData.items) && playlistData.items.length > 0) {
          const nowIso = new Date().toISOString();
          const ytPlaylistName = playlistData.playlistTitle || 'YouTube Playlist';

          const playlistItems = playlistData.items.map((entry, idx) =>
            normalizeQueueItem({
              id: entry.videoId,
              videoId: entry.videoId,
              sourceType: 'youtube',
              sourceUrl: entry.sourceUrl,
              localBlobId: null,
              playlistId: detected.playlistId,
              playlistTitle: ytPlaylistName,
              title: entry.title,
              author: entry.author || '',
              thumbnail: entry.thumbnail,
              duration: entry.duration || 0,
              lastPosition: 0,
              isOfflineReady: false,
              inQueue: true,
              queueOrder: idx,
              lastWatchedAt: nowIso,
            })
          );

          if (playlistImportMode === 'new') {
            const newPlId = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const newNamedPlaylist = {
              id: newPlId,
              name: ytPlaylistName,
              createdAt: Date.now(),
              items: playlistItems,
            };
            setPlaylists((prev) => [...prev, newNamedPlaylist]);
            setActivePlaylistId(newPlId);
          } else {
            // Append into currently active playlist (deduplicating by id)
            const targetId = activePlaylist.id;
            setPlaylists((prev) =>
              prev.map((pl) => {
                if (pl.id !== targetId) return pl;
                const existingIds = new Set(pl.items.map((i) => i.id));
                const additions = playlistItems.filter((i) => !existingIds.has(i.id));
                const merged = [...pl.items, ...additions].map((item, i) => ({
                  ...item,
                  queueOrder: i,
                }));
                return { ...pl, items: merged };
              })
            );
          }

          upsertHistoryItems(playlistItems);

          const startVideoId =
            detected.youtubeVideoId &&
            playlistItems.some((item) => item.id === detected.youtubeVideoId)
              ? detected.youtubeVideoId
              : playlistItems[0].id;

          if (playImmediately && startVideoId) {
            setActiveItemId(startVideoId);
            syncSettingsToServer({ activeVideoId: startVideoId });
          }

          playlistItems.slice(0, 30).forEach((item) => syncItemToServer(item));

          showNotice(
            playlistImportMode === 'new'
              ? `Created playlist "${ytPlaylistName}" (${playlistItems.length} lectures)`
              : `Appended ${playlistItems.length} lectures to "${activePlaylist.name}"`,
            'success'
          );
          return;
        }
      } finally {
        setIsAddingUrl(false);
      }
    }

    // Standard single source (YouTube video, Vimeo, Direct MP4/MP3, or playlist fallback)
    const newItem = normalizeQueueItem({
      ...detected,
      inQueue: true,
      queueOrder: queue.length,
      lastWatchedAt: new Date().toISOString(),
    });

    const targetPlaylistId = activePlaylist.id;
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id !== targetPlaylistId) return pl;
        const exists = pl.items.some((i) => i.id === newItem.id);
        if (exists) {
          return {
            ...pl,
            items: pl.items.map((i) =>
              i.id === newItem.id
                ? { ...i, playlistId: newItem.playlistId || i.playlistId }
                : i
            ),
          };
        }
        return {
          ...pl,
          items: [...pl.items, { ...newItem, queueOrder: pl.items.length }],
        };
      })
    );
    upsertHistoryItems([newItem]);

    if (playImmediately) {
      setActiveItemId(newItem.id);
      syncSettingsToServer({ activeVideoId: newItem.id });
    }

    // Fetch real title, author & thumbnail for YouTube & Vimeo in background
    if (newItem.sourceType === 'youtube' || newItem.sourceType === 'vimeo') {
      const meta = await fetchSourceMetadata({
        ...detected,
        sourceUrl: newItem.sourceUrl || rawUrl,
      });
      const resolvedTitle =
        meta?.title ||
        (newItem.sourceType === 'vimeo'
          ? `Vimeo Lecture (${detected.vimeoId || newItem.id})`
          : detected.youtubeVideoId
          ? `Lecture (${detected.youtubeVideoId})`
          : 'YouTube Playlist');
      const resolvedThumb = meta?.thumbnail || newItem.thumbnail;
      const resolvedDuration = meta?.duration || newItem.duration || 0;

      const updatedItem = {
        ...newItem,
        title: resolvedTitle,
        author: meta?.author || '',
        thumbnail: resolvedThumb,
        duration: resolvedDuration,
      };

      updateItemAcrossAll(newItem.id, (i) => ({
        ...i,
        title: resolvedTitle,
        author: meta?.author || i.author || '',
        thumbnail: resolvedThumb || i.thumbnail,
        duration: resolvedDuration > 0 ? resolvedDuration : i.duration,
      }));

      syncItemToServer(updatedItem);
    } else {
      syncItemToServer(newItem);
    }
  };

  const handleProgressSave = useCallback(
    (time, dur) => {
      if (!activeItemId) return;
      const nowIso = new Date().toISOString();

      updateItemAcrossAll(activeItemId, (i) => ({
        ...i,
        lastPosition: time,
        duration: dur > 0 ? dur : i.duration,
        lastWatchedAt: nowIso,
      }));

      if (
        isOnline &&
        activeItem &&
        activeItem.sourceType !== 'local' &&
        !activeItemId.startsWith('local:')
      ) {
        fetch('/api/progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            videoId: activeItemId,
            sourceType: activeItem.sourceType,
            sourceUrl: activeItem.sourceUrl,
            lastPosition: time,
            duration: dur,
          }),
        }).catch(() => {});
      }
    },
    [activeItemId, activeItem, workspaceId, isOnline, updateItemAcrossAll]
  );

  const handleSelectVideo = (item) => {
    const id = item.id || item.videoId;
    setActiveItemId(id);
    if (item.sourceType !== 'local') {
      syncSettingsToServer({ activeVideoId: id });
    }
  };

  const handleRemoveFromQueue = (itemId) => {
    setPlaylists((prev) =>
      prev.map((pl) =>
        pl.id === activePlaylist.id
          ? {
              ...pl,
              items: pl.items
                .filter((i) => i.id !== itemId)
                .map((item, idx) => ({ ...item, queueOrder: idx })),
            }
          : pl
      )
    );
    if (isOnline && !itemId.startsWith('local:')) {
      fetch(`/api/items/${encodeURIComponent(itemId)}?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: 'DELETE',
      }).catch(() => {});
    }
  };

  const handleDeleteHistoryItem = async (itemId) => {
    const target = historyItems.find((i) => i.id === itemId);
    if (target?.localBlobId) {
      await deleteMediaFile(target.localBlobId).catch(() => {});
    }
    setHistoryItems((prev) => prev.filter((i) => i.id !== itemId));
    setPlaylists((prev) =>
      prev.map((pl) => ({
        ...pl,
        items: pl.items.filter((i) => i.id !== itemId),
      }))
    );
    if (activeItemId === itemId) setActiveItemId(null);

    if (isOnline && !itemId.startsWith('local:')) {
      fetch(
        `/api/items/${encodeURIComponent(itemId)}?workspaceId=${encodeURIComponent(workspaceId)}&hard=true`,
        { method: 'DELETE' }
      ).catch(() => {});
    }
  };

  // Delete ONLY the IndexedDB blob for an offline item to free phone storage
  const handleDeleteLocalFile = async (item) => {
    const blobId = item.localBlobId || (item.sourceType === 'local' ? item.id : null);
    if (blobId) {
      await deleteMediaFile(blobId).catch(() => {});
    }

    if (item.sourceUrl) {
      const detected = detectSourceFromUrl(item.sourceUrl);
      updateItemAcrossAll(item.id, (i) => ({
        ...i,
        sourceType: detected?.sourceType || 'youtube',
        localBlobId: null,
        isOfflineReady: false,
        sizeBytes: null,
      }));
      showNotice(`Deleted offline copy of "${item.title}" to free storage.`, 'info');
    } else {
      setPlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          items: pl.items.filter((i) => i.id !== item.id),
        }))
      );
      setHistoryItems((prev) => prev.filter((i) => i.id !== item.id));
      if (activeItemId === item.id) setActiveItemId(null);
      showNotice(`Deleted local file "${item.title}" from device storage.`, 'info');
    }
  };

  // Wipe all IndexedDB blobs from Settings Modal
  const handleClearOfflineMedia = async () => {
    await clearAllMediaFiles();
    const stripOffline = (list) =>
      list
        .map((i) => {
          if (!i.isOfflineReady && i.sourceType !== 'local') return i;
          if (i.sourceUrl) {
            const detected = detectSourceFromUrl(i.sourceUrl);
            return {
              ...i,
              sourceType: detected?.sourceType || 'youtube',
              localBlobId: null,
              isOfflineReady: false,
              sizeBytes: null,
            };
          }
          return null;
        })
        .filter(Boolean);

    setPlaylists((prev) => prev.map((pl) => ({ ...pl, items: stripOffline(pl.items) })));
    setHistoryItems((prev) => stripOffline(prev));
    showNotice('Cleared all offline media blobs from IndexedDB.', 'info');
  };

  const handlePlayerStateChange = useCallback((playing) => {
    setIsPlaying(playing);
  }, []);

  const handleCycleInterval = () => {
    const idx = INTERVAL_PRESETS.indexOf(seekInterval);
    const next = INTERVAL_PRESETS[(idx + 1) % INTERVAL_PRESETS.length];
    setSeekInterval(next);
    syncSettingsToServer({ seekInterval: next });
  };

  const handleSelectSpeed = useCallback(
    (rate) => {
      setPlaybackSpeed(rate);
      syncSettingsToServer({ playbackSpeed: rate });
    },
    [syncSettingsToServer]
  );

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

  // Standalone PWA manual refresh: spin, check SW registration for newer build, then reload
  const handleAppRefresh = async () => {
    if (isRefreshingApp) return;
    setIsRefreshingApp(true);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await Promise.race([
            reg.update().catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ]);
        }
      }
    } catch {
      // ignore SW update errors when offline
    }
    setTimeout(() => {
      window.location.reload();
    }, 250);
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const sharedQueueProps = {
    playlists,
    activePlaylistId: activePlaylist.id,
    queue,
    history,
    activeItemId,
    isOnline,
    sidecarConfigured,
    fallbackConverterUrl,
    extractingItemId,
    localImportProgress,
    batchDownload,
    batchErrors,
    onSelectPlaylist: handleSelectPlaylist,
    onCreatePlaylist: handleCreatePlaylist,
    onRenamePlaylist: handleRenamePlaylist,
    onDeletePlaylist: handleDeletePlaylist,
    onSelectVideo: handleSelectVideo,
    onRemoveFromQueue: handleRemoveFromQueue,
    onDeleteHistoryItem: handleDeleteHistoryItem,
    onDeleteLocalFile: handleDeleteLocalFile,
    onMoveQueueItem: handleMoveQueueItem,
    onReplaceWithLocalFile: handleReplaceWithLocalFile,
    onFetchViaSidecar: handleFetchViaSidecar,
    onStartPlaylistDownload: handleStartPlaylistDownload,
    onTogglePausePlaylistDownload: handleTogglePausePlaylistDownload,
    onCancelPlaylistDownload: handleCancelPlaylistDownload,
    onNotify: showNotice,
  };

  return (
    <div className="min-h-screen bg-obsidian-950 text-zinc-100">
      {/* Hidden multi-file local media picker */}
      <input
        ref={localFileInputRef}
        type="file"
        accept="video/*,audio/*"
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            handleImportLocalFiles(e.target.files, !activeItemId);
          }
          e.target.value = '';
        }}
        className="hidden"
      />

      {/* Full-window Desktop Multi-File Drag & Drop Overlay */}
      {isDraggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-obsidian-950/85 p-6 backdrop-blur-md">
          <div className="flex max-w-md flex-col items-center rounded-3xl border-2 border-dashed border-amber-400 bg-obsidian-900/90 p-10 text-center shadow-2xl">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400">
              <Upload className="h-8 w-8" />
            </div>
            <h2 className="text-lg font-bold text-white">
              Drop Local Lectures into &ldquo;{activePlaylist.name}&rdquo;
            </h2>
            <p className="mt-1.5 text-xs text-zinc-400">
              Drop one or multiple MP4, WebM, MP3, or M4A files — processed sequentially into IndexedDB with auto-generated thumbnails.
            </p>
          </div>
        </div>
      )}

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
                {!isOnline && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-0.5 text-[10px] font-bold text-sky-300">
                    <WifiOff className="h-3 w-3" />
                    Offline Mode
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-500">Unified Hands-Free &amp; Offline Lecture Player</p>
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
            {/* Conditional Session Lock Indicator */}
            <div
              title={
                sessionLockMode === 'native'
                  ? 'Native HTML5 media owns OS Bluetooth & lock-screen controls directly'
                  : 'Silent audio lock keeps OS Bluetooth/steering-wheel controls bound to StudyMedia'
              }
              className={`hidden items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium md:flex ${
                sessionLockActive
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-zinc-800 bg-obsidian-900 text-zinc-400'
              }`}
            >
              {sessionLockMode === 'native' ? (
                <HardDrive className="h-3.5 w-3.5" />
              ) : sessionLockActive ? (
                <Lock className="h-3.5 w-3.5" />
              ) : (
                <Unlock className="h-3.5 w-3.5" />
              )}
              <span>
                {sessionLockMode === 'native'
                  ? 'Native MediaSession'
                  : sessionLockActive
                  ? 'Session Lock Active'
                  : 'Lock Standby'}
              </span>
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

            {/* Standalone PWA Refresh / Update Check */}
            <button
              type="button"
              onClick={handleAppRefresh}
              disabled={isRefreshingApp}
              title="Refresh & Check for App Updates"
              aria-label="Refresh App"
              className="rounded-lg border border-zinc-800 bg-obsidian-900 p-2 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-400 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshingApp ? 'animate-spin text-amber-400' : ''}`}
              />
            </button>

            {/* Settings */}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              title="Hardware, Offline Storage & Sync Settings"
              className="rounded-lg border border-zinc-800 bg-obsidian-900 p-2 text-zinc-300 transition hover:border-zinc-700 hover:text-white"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-5">
        {/* Universal Source URL Bar + Multi-File Import Local Media */}
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
                placeholder="Paste YouTube, playlist, Vimeo, or direct MP4/MP3 URL..."
                className="w-full rounded-xl border border-zinc-800 bg-obsidian-900 py-3 pl-10 pr-4 text-sm text-white placeholder-zinc-500 transition focus:border-amber-500/70 focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isAddingUrl}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-black transition hover:bg-amber-400 disabled:opacity-60 sm:flex-initial"
              >
                {isAddingUrl ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 fill-current" />
                )}
                Play Now
              </button>
              <button
                type="button"
                disabled={isAddingUrl}
                onClick={() => handleAddUrl(false)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-obsidian-900 px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:border-zinc-700 hover:bg-obsidian-800 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" />
                Queue
              </button>
              <button
                type="button"
                disabled={isImportingLocal}
                onClick={() => localFileInputRef.current?.click()}
                title="Import one or multiple local MP4, WebM, MP3, or M4A files for offline study"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:border-emerald-500/60 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {isImportingLocal ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                <span>
                  {localImportProgress
                    ? `Importing ${localImportProgress.current}/${localImportProgress.total}...`
                    : 'Import Local Media'}
                </span>
              </button>
            </div>
          </form>

          {/* Playlist Import Mode Toggle (shown automatically when a YouTube playlist URL is pasted) */}
          {urlLooksLikePlaylist && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-amber-300">
                <ListPlus className="h-3.5 w-3.5" />
                Playlist link detected:
              </span>
              <div className="flex items-center gap-1 rounded-lg bg-obsidian-950 p-0.5">
                <button
                  type="button"
                  onClick={() => setPlaylistImportMode('new')}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    playlistImportMode === 'new'
                      ? 'bg-amber-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Create New Named Playlist
                </button>
                <button
                  type="button"
                  onClick={() => setPlaylistImportMode('append')}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    playlistImportMode === 'append'
                      ? 'bg-amber-500 text-black'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Append to &ldquo;{activePlaylist.name}&rdquo;
                </button>
              </div>
            </div>
          )}

          {urlError && <p className="mt-1.5 text-xs text-red-400">{urlError}</p>}
        </div>

        {/* Theater Mode Layout */}
        {mode === 'theater' && (
          <div className="space-y-4">
            {activeItem ? (
              <VideoPlayer
                ref={playerRef}
                source={activeItem}
                initialTime={activeItem.lastPosition || 0}
                playbackSpeed={playbackSpeed}
                seekInterval={seekInterval}
                audioOnlyMode={audioOnlyMode}
                theaterMode={true}
                isOnline={isOnline}
                sidecarUrl={sidecarUrl}
                sidecarApiKey={sidecarApiKey}
                fallbackConverterUrl={fallbackConverterUrl}
                extractingItemId={extractingItemId}
                extractProgress={extractProgress}
                hasPrevTrack={hasPrevTrack}
                hasNextTrack={hasNextTrack}
                onStateChange={handlePlayerStateChange}
                onEnded={handleAutoAdvance}
                onPrevTrack={handlePrevTrack}
                onNextTrack={handleNextTrack}
                onChangeSpeed={handleSelectSpeed}
                onTimeUpdate={(cur, dur) => {
                  setCurrentTime(cur);
                  if (dur > 0) setDuration(dur);
                }}
                onProgressSave={handleProgressSave}
                onExitTheater={() => handleModeChange('study')}
                onReplaceWithLocalFile={handleReplaceWithLocalFile}
                onFetchViaSidecar={handleFetchViaSidecar}
                onNotify={showNotice}
              />
            ) : (
              <EmptyPlayerCard onImportClick={() => localFileInputRef.current?.click()} />
            )}
            <p className="text-center text-xs text-zinc-500">
              Theater mode: controls fade out after 3 seconds • Move mouse or tap to reveal
            </p>
          </div>
        )}

        {/* Study Mode Layout */}
        {mode === 'study' && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left / Main Stage */}
            <div className="space-y-4 lg:col-span-8 xl:col-span-9">
              {activeItem ? (
                <VideoPlayer
                  ref={playerRef}
                  source={activeItem}
                  initialTime={activeItem.lastPosition || 0}
                  playbackSpeed={playbackSpeed}
                  seekInterval={seekInterval}
                  audioOnlyMode={audioOnlyMode}
                  theaterMode={false}
                  isOnline={isOnline}
                  sidecarUrl={sidecarUrl}
                  sidecarApiKey={sidecarApiKey}
                  fallbackConverterUrl={fallbackConverterUrl}
                  extractingItemId={extractingItemId}
                  extractProgress={extractProgress}
                  hasPrevTrack={hasPrevTrack}
                  hasNextTrack={hasNextTrack}
                  onStateChange={handlePlayerStateChange}
                  onEnded={handleAutoAdvance}
                  onPrevTrack={handlePrevTrack}
                  onNextTrack={handleNextTrack}
                  onChangeSpeed={handleSelectSpeed}
                  onTimeUpdate={(cur, dur) => {
                    setCurrentTime(cur);
                    if (dur > 0) setDuration(dur);
                  }}
                  onProgressSave={handleProgressSave}
                  onReplaceWithLocalFile={handleReplaceWithLocalFile}
                  onFetchViaSidecar={handleFetchViaSidecar}
                  onNotify={showNotice}
                />
              ) : (
                <EmptyPlayerCard onImportClick={() => localFileInputRef.current?.click()} />
              )}

              {/* Progress Scrubber & Timestamps */}
              <div className="rounded-2xl border border-zinc-800/80 bg-obsidian-900 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {activeItem?.title || 'Ready to study'}
                    </p>
                    {activeItem?.isOfflineReady && (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                        Offline Ready
                      </span>
                    )}
                  </div>
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

                {/* Study Mode Controls Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handlePrevTrack}
                      disabled={!hasPrevTrack}
                      title="Previous Lecture"
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
                      onClick={handleTogglePlay}
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
                      onClick={handleNextTrack}
                      disabled={!hasNextTrack}
                      title="Next Lecture"
                      className="rounded-full p-2 text-zinc-400 transition hover:bg-obsidian-800 hover:text-white disabled:opacity-30"
                    >
                      <SkipForward className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCycleInterval}
                      title="Click to cycle seek interval"
                      className="rounded-full bg-amber-500 px-3.5 py-1.5 font-mono text-xs font-bold text-black transition hover:bg-amber-400"
                    >
                      {seekInterval}s
                    </button>

                    <SpeedPopover
                      speed={playbackSpeed}
                      variant="study"
                      align="right"
                      onSelectSpeed={handleSelectSpeed}
                    />

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

            {/* Right Sidebar: Named Playlists & History */}
            <div className="lg:col-span-4 xl:col-span-3">
              <QueuePanel {...sharedQueueProps} />
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
                hasPrev={hasPrevTrack}
                hasNext={hasNextTrack}
                lastSignal={lastSignal}
                onTogglePlay={handleTogglePlay}
                onSeekRelative={handleSeekRelative}
                onPrevVideo={handlePrevTrack}
                onNextVideo={handleNextTrack}
                onChangeInterval={(sec) => {
                  setSeekInterval(sec);
                  syncSettingsToServer({ seekInterval: sec });
                }}
                onChangeSpeed={handleSelectSpeed}
                onTestSignal={triggerTestSignal}
              />

              {/* Keep Unified Player mounted in Car Mode (Audio-Only friendly) */}
              {activeItem && (
                <div className="overflow-hidden rounded-2xl">
                  <VideoPlayer
                    ref={playerRef}
                    source={activeItem}
                    initialTime={activeItem.lastPosition || 0}
                    playbackSpeed={playbackSpeed}
                    seekInterval={seekInterval}
                    audioOnlyMode={true}
                    theaterMode={false}
                    isOnline={isOnline}
                    sidecarUrl={sidecarUrl}
                    sidecarApiKey={sidecarApiKey}
                    fallbackConverterUrl={fallbackConverterUrl}
                    extractingItemId={extractingItemId}
                    extractProgress={extractProgress}
                    hasPrevTrack={hasPrevTrack}
                    hasNextTrack={hasNextTrack}
                    onStateChange={handlePlayerStateChange}
                    onEnded={handleAutoAdvance}
                    onPrevTrack={handlePrevTrack}
                    onNextTrack={handleNextTrack}
                    onChangeSpeed={handleSelectSpeed}
                    onTimeUpdate={(cur, dur) => {
                      setCurrentTime(cur);
                      if (dur > 0) setDuration(dur);
                    }}
                    onProgressSave={handleProgressSave}
                    onReplaceWithLocalFile={handleReplaceWithLocalFile}
                    onFetchViaSidecar={handleFetchViaSidecar}
                    onNotify={showNotice}
                  />
                </div>
              )}
            </div>

            <div className="lg:col-span-4">
              <QueuePanel {...sharedQueueProps} />
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

      {/* Status Toast */}
      {statusToast && (
        <div
          className={`fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold shadow-2xl backdrop-blur-md ${
            statusToast.type === 'error'
              ? 'border-red-500/40 bg-obsidian-900/95 text-red-300'
              : statusToast.type === 'info'
              ? 'border-sky-500/40 bg-obsidian-900/95 text-sky-300'
              : 'border-emerald-500/40 bg-obsidian-900/95 text-emerald-300'
          }`}
        >
          {statusToast.type === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          )}
          <span>{statusToast.text}</span>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        seekInterval={seekInterval}
        doubleTapToSkip={doubleTapToSkip}
        doubleTapWindow={doubleTapWindow}
        autoPlayNext={autoPlayNext}
        workspaceId={workspaceId}
        dbConnected={dbConnected}
        sidecarUrl={sidecarUrl}
        sidecarApiKey={sidecarApiKey}
        fallbackConverterUrl={fallbackConverterUrl}
        onClearOfflineMedia={handleClearOfflineMedia}
        onSave={(next) => {
          setSeekInterval(next.seekInterval);
          setDoubleTapToSkip(next.doubleTapToSkip);
          setDoubleTapWindow(next.doubleTapWindow);
          setAutoPlayNext(next.autoPlayNext);
          setWorkspaceId(next.workspaceId);
          setSidecarUrl(next.sidecarUrl || '');
          setSidecarApiKey(next.sidecarApiKey || '');
          setFallbackConverterUrl(next.fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL);
          syncSettingsToServer({
            seekInterval: next.seekInterval,
            doubleTapToSkip: next.doubleTapToSkip,
            doubleTapWindow: next.doubleTapWindow,
            autoPlayNext: next.autoPlayNext,
            workspaceId: next.workspaceId,
            sidecarUrl: next.sidecarUrl || '',
            sidecarApiKey: next.sidecarApiKey || '',
            fallbackConverterUrl: next.fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL,
          });
        }}
      />
    </div>
  );
}

function EmptyPlayerCard({ onImportClick }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-obsidian-900/60 p-8 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/30">
        <Play className="ml-1 h-7 w-7 text-amber-400" />
      </div>
      <h2 className="text-lg font-bold text-white">Paste a Lecture URL or Import Local Media</h2>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
        Supports YouTube videos &amp; playlists, Vimeo, direct MP4/MP3 links, and multi-file offline local imports — with identical Car, Study, Theater &amp; Bluetooth AVRCP controls.
      </p>
      {onImportClick && (
        <button
          type="button"
          onClick={onImportClick}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
        >
          <Upload className="h-3.5 w-3.5" />
          Import Local MP4 / MP3 Files (or Drag &amp; Drop)
        </button>
      )}
    </div>
  );
}
