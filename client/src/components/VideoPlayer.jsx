import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
} from 'react';
import {
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Headphones,
  RotateCcw,
  RotateCw,
  Upload,
  ExternalLink,
  Copy,
  Check,
  ShieldAlert,
  WifiOff,
  Download,
  Loader2,
  Server,
  RefreshCw,
  Hand,
  ZoomIn,
  ZoomOut,
  RotateCcw as ResetIcon,
} from 'lucide-react';
import { PlayerController } from '../adapters/PlayerController';
import { usePinchZoom } from '../hooks/usePinchZoom';
import { formatTime } from '../utils/youtube';
import { formatBytes } from '../storage/mediaDB';
import { getExternalUrl } from '../utils/sourceDetector';
import {
  checkSidecarHealth,
  buildConverterUrl,
  DEFAULT_FALLBACK_CONVERTER_URL,
} from '../utils/sidecarClient';

const VideoPlayer = forwardRef(function VideoPlayer(
  {
    source,
    initialTime = 0,
    playbackSpeed = 1.25,
    seekInterval = 15,
    audioOnlyMode = false,
    theaterMode = false,
    isOnline = true,
    sidecarUrl = '',
    sidecarApiKey = '',
    fallbackConverterUrl = DEFAULT_FALLBACK_CONVERTER_URL,
    extractingItemId = null,
    extractProgress = null,
    onStateChange,
    onTimeUpdate,
    onProgressSave,
    onExitTheater,
    onReplaceWithLocalFile,
    onFetchViaSidecar,
    onNotify,
  },
  ref
) {
  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const overlayRef = useRef(null);
  const stageRef = useRef(null);
  const controllerRef = useRef(null);
  const replaceInputRef = useRef(null);

  const [playerState, setPlayerState] = useState('paused');
  const [currentTime, setCurrentTime] = useState(initialTime || 0);
  const [duration, setDuration] = useState(source?.duration || 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerError, setPlayerError] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // Fullscreen & Native-Controls Pass-Through State
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isCssFullscreen, setIsCssFullscreen] = useState(false);
  const [interactMode, setInteractMode] = useState(false);

  // 3-Tier Cascade State for Error 101/150
  const [sidecarHealth, setSidecarHealth] = useState('idle');
  const [sidecarFormat, setSidecarFormat] = useState('mp4');

  const fadeTimerRef = useRef(null);
  const isPlaying = playerState === 'playing';
  const isFullscreen = isNativeFullscreen || isCssFullscreen;
  const isExtracting = Boolean(extractingItemId && source?.id === extractingItemId);
  const sidecarConfigured = Boolean(sidecarUrl?.trim() && sidecarApiKey?.trim());

  const latestPropsRef = useRef({});
  latestPropsRef.current = {
    initialTime,
    playbackSpeed,
    onStateChange,
    onTimeUpdate,
    onProgressSave,
  };

  // Auto-fade controls in Theater or Fullscreen Mode after 3 seconds of inactivity
  const resetFadeTimer = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(fadeTimerRef.current);
    if (theaterMode || isFullscreen) {
      fadeTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [theaterMode, isFullscreen]);

  useEffect(() => {
    resetFadeTimer();
    return () => clearTimeout(fadeTimerRef.current);
  }, [theaterMode, isFullscreen, resetFadeTimer]);

  // Single-tap handler from usePinchZoom (debounced past double-tap window):
  // - In Fullscreen or Theater: toggle HUD visibility
  // - In Study Mode: toggle Play/Pause
  const handleSingleTap = useCallback(() => {
    if (isFullscreen || theaterMode) {
      setControlsVisible((prev) => {
        const next = !prev;
        clearTimeout(fadeTimerRef.current);
        if (next) {
          fadeTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
        }
        return next;
      });
    } else {
      controllerRef.current?.togglePlay();
    }
  }, [isFullscreen, theaterMode]);

  // Pinch-to-Zoom (1x–4x) & Pan Hook (resets cleanly on track switch or fullscreen toggle)
  const gestureActive = !audioOnlyMode && !playerError && !interactMode;
  const { zoomLevel, isZoomed, isDragging, zoomIn, zoomOut, resetZoom } = usePinchZoom({
    stageRef,
    contentRef,
    overlayRef,
    enabled: gestureActive,
    onSingleTap: handleSingleTap,
    onActivity: resetFadeTimer,
    resetKey: `${source?.id || ''}|${isFullscreen}|${audioOnlyMode}`,
  });

  // Reset interactMode when switching tracks or entering audio-only mode
  useEffect(() => {
    setInteractMode(false);
  }, [source?.id, audioOnlyMode]);

  // Listen to native Fullscreen API changes (Esc / Android back gesture)
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const active = Boolean(fsEl && stageRef.current && fsEl === stageRef.current);
      setIsNativeFullscreen(active);
      if (!active) {
        try {
          window.screen?.orientation?.unlock?.();
        } catch {
          // ignore unsupported orientation unlock
        }
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, []);

  // Lock body scroll & listen for Escape when using iOS CSS Fullscreen fallback
  useEffect(() => {
    if (!isCssFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsCssFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
      try {
        window.screen?.orientation?.unlock?.();
      } catch {
        // ignore
      }
    };
  }, [isCssFullscreen]);

  // Mount & load active source via unified PlayerController
  const sourceKey = source
    ? `${source.id}|${source.sourceType}|${source.localBlobId || ''}|${source.sourceUrl || ''}|${retryToken}`
    : '';

  useEffect(() => {
    if (!source || !containerRef.current) return;

    setPlayerError(null);
    setSidecarHealth('idle');
    setPlayerState('buffering');
    setCurrentTime(latestPropsRef.current.initialTime || 0);
    setDuration(source.duration || 0);

    if (!isOnline && !source.isOfflineReady && source.sourceType !== 'local') {
      setPlayerState('paused');
      setPlayerError({
        code: 'OFFLINE_UNAVAILABLE',
        message: 'Internet connection is required to stream this online lecture.',
        recoverable: true,
      });
      return;
    }

    const controller = new PlayerController(containerRef.current, {
      onReady: () => {},
      onStateChange: (nextState) => {
        setPlayerState(nextState);
        latestPropsRef.current.onStateChange?.(nextState === 'playing', nextState);
      },
      onTimeUpdate: (cur, dur) => {
        setCurrentTime(cur);
        if (dur > 0) setDuration(dur);
        latestPropsRef.current.onTimeUpdate?.(cur, dur);
      },
      onProgressSave: (cur, dur) => {
        latestPropsRef.current.onProgressSave?.(cur, dur);
      },
      onError: (err) => {
        setPlayerState('paused');
        setPlayerError(err);
        latestPropsRef.current.onStateChange?.(false, 'paused');
      },
    });

    controllerRef.current = controller;
    controller.load(source, {
      startTime: latestPropsRef.current.initialTime || 0,
      playbackRate: latestPropsRef.current.playbackSpeed || 1,
    });

    return () => {
      controller.destroy();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [sourceKey, isOnline]);

  // Tier 1 Auto-Probe on EMBED_RESTRICTED (1.5s timeout)
  useEffect(() => {
    if (playerError?.code !== 'EMBED_RESTRICTED') {
      setSidecarHealth('idle');
      return;
    }

    if (!sidecarUrl?.trim()) {
      setSidecarHealth('unconfigured');
      return;
    }

    let cancelled = false;
    setSidecarHealth('checking');

    checkSidecarHealth(sidecarUrl, sidecarApiKey, 1500).then((res) => {
      if (cancelled) return;
      setSidecarHealth(res.ok ? 'online' : 'offline');
    });

    return () => {
      cancelled = true;
    };
  }, [playerError?.code, source?.id, sidecarUrl, sidecarApiKey]);

  // Apply playback speed updates
  useEffect(() => {
    controllerRef.current?.setPlaybackRate(playbackSpeed);
  }, [playbackSpeed]);

  // Expose canonical controller methods to App & MediaSession
  useImperativeHandle(ref, () => ({
    seekRelative(delta) {
      controllerRef.current?.seekRelative(delta);
    },
    seekTo(time) {
      controllerRef.current?.seekTo(time);
      setCurrentTime(time);
    },
    play() {
      controllerRef.current?.play();
    },
    pause() {
      controllerRef.current?.pause();
    },
    togglePlay() {
      controllerRef.current?.togglePlay();
    },
    getCurrentTime() {
      return controllerRef.current?.getCurrentTime() || 0;
    },
    getDuration() {
      return controllerRef.current?.getDuration() || 0;
    },
  }));

  // Fullscreen the Outer Stage (so gesture overlay, pinch-zoom & HUD remain active)
  // Falls back cleanly to CSS Fullscreen on iOS Safari where div.requestFullscreen is unavailable
  const handleToggleFullscreen = async () => {
    const el = stageRef.current;
    if (!el) return;

    // Exit fullscreen if active
    if (isCssFullscreen) {
      setIsCssFullscreen(false);
      try {
        window.screen?.orientation?.unlock?.();
      } catch {
        // ignore
      }
      return;
    }

    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      } catch {
        setIsNativeFullscreen(false);
      }
      return;
    }

    // Enter fullscreen on the outer stage container
    const reqFs = el.requestFullscreen || el.webkitRequestFullscreen;
    if (typeof reqFs === 'function') {
      try {
        await reqFs.call(el);
        try {
          await window.screen?.orientation?.lock?.('landscape');
        } catch {
          // Orientation lock optional
        }
        return;
      } catch {
        // Fall through to CSS fullscreen fallback
      }
    }

    // iOS Safari / restricted WebView CSS Fullscreen fallback
    setIsCssFullscreen(true);
    try {
      await window.screen?.orientation?.lock?.('landscape');
    } catch {
      // Orientation lock optional
    }
  };

  const externalUrl = getExternalUrl(source);

  const copyTextToClipboard = async (text) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleCopyExternalUrl = async () => {
    if (!externalUrl) return;
    await copyTextToClipboard(externalUrl);
    setCopiedUrl(true);
    onNotify?.('Link copied!', 'success');
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleOpenExternalDownloader = async () => {
    if (externalUrl) {
      await copyTextToClipboard(externalUrl);
      setCopiedUrl(true);
      onNotify?.('Link copied! Paste it in the downloader tab.', 'success');
      setTimeout(() => setCopiedUrl(false), 2500);
    }

    const rawId = source?.youtubeVideoId || source?.videoId || source?.id || '';
    const targetUrl = buildConverterUrl(
      fallbackConverterUrl || DEFAULT_FALLBACK_CONVERTER_URL,
      externalUrl || '',
      rawId.startsWith('playlist:') ? '' : rawId
    );
    window.open(targetUrl, '_blank', 'noopener,noreferrer');
  };

  const handleReplaceFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && source && onReplaceWithLocalFile) {
      onReplaceWithLocalFile(source, file);
    }
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const isEmbedRestricted = playerError?.code === 'EMBED_RESTRICTED';
  const showFloatingHud = !audioOnlyMode && !playerError;
  const showBottomHud = showFloatingHud && (isFullscreen || theaterMode);

  return (
    <div
      ref={stageRef}
      onMouseMove={resetFadeTimer}
      onTouchStart={resetFadeTimer}
      className={`overflow-hidden bg-black shadow-2xl transition-all duration-300 ${
        isCssFullscreen
          ? 'fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0'
          : isNativeFullscreen
          ? 'relative h-full w-full rounded-none border-0'
          : theaterMode
          ? 'relative aspect-[16/9] max-h-[78vh] w-full rounded-2xl border border-zinc-800/80'
          : 'relative aspect-video w-full rounded-2xl border border-zinc-800/80'
      }`}
    >
      {/* Hidden local file replacement input */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="video/*,audio/*"
        onChange={handleReplaceFileSelect}
        className="hidden"
      />

      {/* Inner Transform Wrapper (Pinch-Zoom 1x-4x & Pan target) */}
      <div
        ref={contentRef}
        className={`h-full w-full origin-center will-change-transform transition-opacity duration-300 ${
          audioOnlyMode || playerError ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      >
        <div ref={containerRef} className="h-full w-full" />
      </div>

      {/* Transparent Gesture Overlay (z-10, touch-action: none; switches to pointer-events-none in Interact Mode) */}
      {showFloatingHud && (
        <div
          ref={overlayRef}
          style={{ touchAction: 'none' }}
          className={`group absolute inset-0 z-10 flex items-center justify-center transition-colors ${
            interactMode
              ? 'pointer-events-none'
              : isZoomed
              ? isDragging
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-pointer hover:bg-black/15'
          }`}
        >
          {/* Subtle Center Play/Pause Icon (Study Mode non-fullscreen, non-zoomed, non-interact) */}
          {!theaterMode && !isFullscreen && !interactMode && !isZoomed && (
            <div
              className={`pointer-events-none flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all duration-200 ${
                isPlaying
                  ? 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100'
                  : 'scale-100 opacity-100'
              }`}
            >
              {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
            </div>
          )}
        </div>
      )}

      {/* Top-Right Floating Controls: Zoom HUD Pill & Native Controls "Interact" Escape Hatch (z-20) */}
      {showFloatingHud && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute right-3 top-3 z-20 flex items-center gap-2 transition-opacity duration-300 ${
            (isFullscreen || theaterMode) && !controlsVisible && !isZoomed && !interactMode
              ? 'pointer-events-none opacity-0'
              : 'opacity-100'
          }`}
        >
          {/* Live Zoom Level Pill + One-Tap Reset (visible whenever scale > 1.05) */}
          {isZoomed && (
            <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-black/75 px-2.5 py-1 text-xs font-bold text-amber-300 backdrop-blur-md">
              <span className="font-mono">{zoomLevel.toFixed(1)}x</span>
              <button
                type="button"
                onClick={() => resetZoom(true)}
                className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-200 transition hover:bg-amber-500/35"
              >
                <ResetIcon className="h-3 w-3" />
                Reset
              </button>
            </div>
          )}

          {/* Native Controls Escape Hatch ("Interact" Pass-Through Toggle) */}
          <button
            type="button"
            onClick={() => {
              setInteractMode((prev) => !prev);
              resetFadeTimer();
            }}
            title={
              interactMode
                ? 'Pass-through active: tap to return to Pinch-Zoom & Pan mode'
                : 'Interact Mode: temporarily pass taps through to YouTube/Vimeo CC, quality & settings'
            }
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold backdrop-blur-md transition ${
              interactMode
                ? 'border-amber-400 bg-amber-500 text-black shadow-lg'
                : 'border-zinc-700/70 bg-black/65 text-zinc-200 hover:border-zinc-500 hover:bg-black/85 hover:text-white'
            }`}
          >
            <Hand className="h-3.5 w-3.5" />
            <span>{interactMode ? 'Interact ON' : 'Interact'}</span>
          </button>
        </div>
      )}

      {/* Audio-Only / Minimal Distraction Overlay */}
      {audioOnlyMode && !playerError && (
        <div
          onClick={() => controllerRef.current?.togglePlay()}
          className="absolute inset-0 z-20 flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-obsidian-900 via-obsidian-950 to-zinc-900 p-6 text-center"
        >
          {source?.thumbnail && (
            <img
              src={source.thumbnail}
              alt={source.title}
              className="mb-4 h-24 w-40 rounded-xl object-cover opacity-50 ring-1 ring-zinc-700/60"
            />
          )}
          <div className="mb-2 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
            <Headphones className="h-3.5 w-3.5" />
            Audio-Only Focus Mode
          </div>
          <p className="max-w-md truncate text-base font-semibold text-zinc-100">
            {source?.title || 'Playing Lecture Audio'}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Video hidden to save battery &amp; reduce distraction • Tap to {isPlaying ? 'pause' : 'play'}
          </p>
        </div>
      )}

      {/* 3-Tier Error 101/150 (EMBED_RESTRICTED) & Offline Fallback Overlay */}
      {playerError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-obsidian-950 via-obsidian-900 to-zinc-950 p-5 text-center sm:p-8">
          <div
            className={`mb-2.5 flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ${
              playerError.code === 'OFFLINE_UNAVAILABLE'
                ? 'bg-sky-500/15 text-sky-400 ring-sky-500/30'
                : 'bg-amber-500/15 text-amber-400 ring-amber-500/30'
            }`}
          >
            {playerError.code === 'OFFLINE_UNAVAILABLE' ? (
              <WifiOff className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
          </div>

          <h3 className="text-base font-bold text-white sm:text-lg">
            {isEmbedRestricted
              ? 'Playback on external sites is disabled by the creator.'
              : playerError.code === 'OFFLINE_UNAVAILABLE'
              ? 'Offline Mode — Requires Internet'
              : playerError.code === 'LOCAL_FILE_MISSING'
              ? 'Local Media File Missing'
              : 'Unable to Play Stream'}
          </h3>

          {isEmbedRestricted && source?.sourceType === 'youtube' && (
            <div className="mt-2">
              {sidecarHealth === 'checking' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-obsidian-900 px-3 py-0.5 text-[11px] font-medium text-zinc-300">
                  <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
                  Checking Home Sidecar...
                </span>
              )}
              {sidecarHealth === 'online' && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-0.5 text-[11px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Home Sidecar Online
                </span>
              )}
              {(sidecarHealth === 'offline' || sidecarHealth === 'unconfigured') && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/90 px-3 py-0.5 text-[11px] font-medium text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
                  Home Sidecar Offline
                </span>
              )}
            </div>
          )}

          {!isEmbedRestricted && (
            <p className="mt-1.5 max-w-md text-xs leading-relaxed text-zinc-400">
              {playerError.message}
            </p>
          )}

          {isExtracting && (
            <div className="mt-3 w-full max-w-sm rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-left">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-emerald-300">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {extractProgress?.phase === 'downloading'
                    ? 'Downloading to IndexedDB...'
                    : 'Extracting on Home Sidecar...'}
                </span>
                <span className="font-mono">
                  {extractProgress?.pct != null
                    ? `${extractProgress.pct}%`
                    : extractProgress?.receivedBytes
                    ? formatBytes(extractProgress.receivedBytes)
                    : sidecarFormat.toUpperCase()}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-obsidian-950">
                <div
                  className={`h-full rounded-full bg-emerald-400 transition-all duration-200 ${
                    extractProgress?.pct == null ? 'w-1/2 animate-pulse' : ''
                  }`}
                  style={
                    extractProgress?.pct != null ? { width: `${extractProgress.pct}%` } : undefined
                  }
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {isEmbedRestricted &&
              source?.sourceType === 'youtube' &&
              sidecarConfigured &&
              sidecarHealth === 'online' && (
                <div className="flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-1">
                  <div className="flex rounded-lg bg-obsidian-950 p-0.5 text-[11px] font-bold">
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={() => setSidecarFormat('mp4')}
                      className={`rounded-md px-2 py-1 transition ${
                        sidecarFormat === 'mp4'
                          ? 'bg-emerald-500 text-black'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      MP4
                    </button>
                    <button
                      type="button"
                      disabled={isExtracting}
                      onClick={() => setSidecarFormat('mp3')}
                      className={`rounded-md px-2 py-1 transition ${
                        sidecarFormat === 'mp3'
                          ? 'bg-emerald-500 text-black'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      MP3
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={isExtracting}
                    onClick={() => onFetchViaSidecar?.(source, sidecarFormat)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-bold text-black shadow-lg transition hover:bg-emerald-400 disabled:opacity-60"
                  >
                    {isExtracting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Server className="h-4 w-4" />
                    )}
                    {isExtracting ? 'Fetching...' : 'Fetch via Home Sidecar'}
                  </button>
                </div>
              )}

            {isEmbedRestricted &&
              externalUrl &&
              sidecarHealth !== 'online' &&
              sidecarHealth !== 'checking' && (
                <button
                  type="button"
                  onClick={handleOpenExternalDownloader}
                  className="flex items-center gap-2 rounded-xl border border-amber-500/50 bg-amber-500/15 px-4 py-2.5 text-xs font-bold text-amber-300 transition hover:bg-amber-500/25"
                >
                  <Download className="h-4 w-4" />
                  Open External Downloader
                </button>
              )}

            <button
              type="button"
              onClick={() => replaceInputRef.current?.click()}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-black shadow-lg transition hover:bg-amber-400"
            >
              <Upload className="h-4 w-4" />
              Import Local Copy
            </button>

            {!isEmbedRestricted && playerError.code !== 'LOCAL_FILE_MISSING' && (
              <button
                type="button"
                onClick={() => setRetryToken((t) => t + 1)}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-obsidian-800 px-3.5 py-2.5 text-xs font-semibold text-zinc-300 hover:bg-obsidian-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            )}
          </div>

          {externalUrl && source?.sourceType !== 'local' && (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 text-[11px] text-zinc-400">
              <button
                type="button"
                onClick={handleCopyExternalUrl}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-obsidian-900 px-2.5 py-1.5 font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" />
                    <span className="text-emerald-400">Link Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy URL
                  </>
                )}
              </button>

              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-obsidian-900 px-2.5 py-1.5 font-medium text-zinc-300 transition hover:border-zinc-700 hover:text-white"
              >
                <ExternalLink className="h-3 w-3" />
                {source?.sourceType === 'youtube' ? 'Open in YouTube' : 'Open Original Link'}
              </a>
            </div>
          )}
        </div>
      )}

      {/* Bottom-Right Zoom & Fullscreen Controls (Study Mode, non-fullscreen, non-theater) */}
      {showFloatingHud && !theaterMode && !isFullscreen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5"
        >
          <button
            type="button"
            onClick={zoomOut}
            disabled={!isZoomed}
            title="Zoom Out (Ctrl + Scroll)"
            className="rounded-lg bg-black/65 p-2 text-zinc-300 backdrop-blur-md transition hover:bg-black/85 hover:text-white disabled:opacity-35"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomLevel >= 4}
            title="Zoom In (Ctrl + Scroll or Pinch)"
            className="rounded-lg bg-black/65 p-2 text-zinc-300 backdrop-blur-md transition hover:bg-black/85 hover:text-white disabled:opacity-35"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToggleFullscreen}
            title="Fullscreen (keeps Pinch-Zoom & StudyMedia HUD active)"
            className="rounded-lg bg-black/65 p-2 text-zinc-300 backdrop-blur-md transition hover:bg-black/85 hover:text-white"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Auto-Hiding Bottom HUD for Fullscreen & Theater Modes */}
      {showBottomHud && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/80 to-transparent px-4 pb-4 pt-12 transition-opacity duration-300 sm:px-5 ${
            controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* Amber Progress Bar */}
          <div className="relative mb-3 flex items-center">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700/70">
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
                controllerRef.current?.seekTo(val);
                setCurrentTime(val);
                resetFadeTimer();
              }}
              className="study-scrubber absolute inset-0 h-full w-full opacity-0 hover:opacity-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {source?.title || 'Lecture Playing'}
              </p>
              <p className="font-mono text-xs text-zinc-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Scrub Back */}
              <button
                type="button"
                onClick={() => {
                  controllerRef.current?.seekRelative(-seekInterval);
                  resetFadeTimer();
                }}
                className="flex items-center gap-1 rounded-full bg-zinc-800/85 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {seekInterval}s
              </button>

              {/* Play / Pause */}
              <button
                type="button"
                onClick={() => {
                  controllerRef.current?.togglePlay();
                  resetFadeTimer();
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>

              {/* Scrub Forward */}
              <button
                type="button"
                onClick={() => {
                  controllerRef.current?.seekRelative(seekInterval);
                  resetFadeTimer();
                }}
                className="flex items-center gap-1 rounded-full bg-zinc-800/85 px-2.5 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
              >
                {seekInterval}s
                <RotateCw className="h-3.5 w-3.5" />
              </button>

              {/* Zoom Controls (- / Reset / +) */}
              <div className="flex items-center gap-1 rounded-full border border-zinc-700/80 bg-zinc-900/85 p-0.5">
                <button
                  type="button"
                  onClick={() => {
                    zoomOut();
                    resetFadeTimer();
                  }}
                  disabled={!isZoomed}
                  title="Zoom Out"
                  className="rounded-full p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-35"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                {isZoomed ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetZoom(true);
                      resetFadeTimer();
                    }}
                    title="Reset Zoom to 1x"
                    className="rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300 hover:bg-amber-500/35"
                  >
                    {zoomLevel.toFixed(1)}x
                  </button>
                ) : (
                  <span className="px-1 font-mono text-[11px] text-zinc-400">1.0x</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    zoomIn();
                    resetFadeTimer();
                  }}
                  disabled={zoomLevel >= 4}
                  title="Zoom In"
                  className="rounded-full p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-35"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Interact Toggle inside Fullscreen HUD */}
              <button
                type="button"
                onClick={() => {
                  setInteractMode((prev) => !prev);
                  resetFadeTimer();
                }}
                title="Toggle Native Player Pass-Through"
                className={`rounded-lg p-2 transition ${
                  interactMode
                    ? 'bg-amber-500 text-black'
                    : 'bg-zinc-800/85 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                }`}
              >
                <Hand className="h-4 w-4" />
              </button>

              <span className="hidden rounded-full border border-zinc-700 bg-zinc-800/90 px-2.5 py-1 font-mono text-xs font-medium text-zinc-200 sm:inline-block">
                {playbackSpeed}x
              </span>

              {/* Fullscreen Toggle / Exit */}
              {isFullscreen ? (
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  title="Exit Fullscreen"
                  className="rounded-lg bg-zinc-800/85 p-2 text-zinc-200 hover:bg-zinc-700 hover:text-white"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleToggleFullscreen}
                    title="Enter Fullscreen"
                    className="rounded-lg bg-zinc-800/85 p-2 text-zinc-200 hover:bg-zinc-700 hover:text-white"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                  {theaterMode && onExitTheater && (
                    <button
                      type="button"
                      onClick={onExitTheater}
                      title="Exit Theater Mode"
                      className="rounded-lg bg-zinc-800/85 p-2 text-zinc-300 hover:bg-zinc-700 hover:text-white"
                    >
                      <Minimize2 className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default VideoPlayer;
