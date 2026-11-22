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
} from 'lucide-react';
import { PlayerController } from '../adapters/PlayerController';
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
  const stageRef = useRef(null);
  const controllerRef = useRef(null);
  const replaceInputRef = useRef(null);

  const [playerState, setPlayerState] = useState('paused'); // 'playing' | 'paused' | 'buffering' | 'ended'
  const [currentTime, setCurrentTime] = useState(initialTime || 0);
  const [duration, setDuration] = useState(source?.duration || 0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [playerError, setPlayerError] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  // 3-Tier Cascade State for Error 101/150
  const [sidecarHealth, setSidecarHealth] = useState('idle'); // 'idle' | 'checking' | 'online' | 'offline' | 'unconfigured'
  const [sidecarFormat, setSidecarFormat] = useState('mp4'); // 'mp4' | 'mp3'

  const fadeTimerRef = useRef(null);
  const isPlaying = playerState === 'playing';
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

  // Auto-fade controls in Theater Mode after 3 seconds of inactivity
  const resetFadeTimer = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(fadeTimerRef.current);
    if (theaterMode) {
      fadeTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [theaterMode]);

  useEffect(() => {
    resetFadeTimer();
    return () => clearTimeout(fadeTimerRef.current);
  }, [theaterMode, resetFadeTimer]);

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

    // Immediate offline check for non-local sources
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

  // Tier 1 Auto-Probe: Whenever EMBED_RESTRICTED fires on a YouTube video, check Sidecar health (strict 1.5s timeout)
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

  const handleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
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

  // Tier 2: Auto-copy YouTube URL -> show "Link copied!" toast -> open configurable fallback converter
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

  return (
    <div
      ref={stageRef}
      onMouseMove={resetFadeTimer}
      onTouchStart={resetFadeTimer}
      className={`relative w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-obsidian-900 shadow-2xl transition-all duration-300 ${
        theaterMode ? 'aspect-[16/9] max-h-[78vh]' : 'aspect-video'
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

      {/* Unified Adapter Stage Mount (kept mounted in audioOnlyMode so playback continues) */}
      <div
        ref={containerRef}
        className={`h-full w-full transition-opacity duration-300 ${
          audioOnlyMode || playerError ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      />

      {/* Audio-Only / Minimal Distraction Overlay */}
      {audioOnlyMode && !playerError && (
        <div
          onClick={() => controllerRef.current?.togglePlay()}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-obsidian-900 via-obsidian-950 to-zinc-900 p-6 text-center"
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
            Video hidden to save battery & reduce distraction • Tap to {isPlaying ? 'pause' : 'play'}
          </p>
        </div>
      )}

      {/* Center Play/Pause Tap Zone (Study Mode) */}
      {!audioOnlyMode && !theaterMode && !playerError && (
        <div
          onClick={() => controllerRef.current?.togglePlay()}
          className="group absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 transition-colors hover:bg-black/20"
        >
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all duration-200 ${
              isPlaying
                ? 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100'
                : 'scale-100 opacity-100'
            }`}
          >
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </div>
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

          {/* Sidecar Status Pill (for Error 101/150) */}
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

          {/* Active Sidecar Extraction / Download Progress Bar */}
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

          {/* 3-Tier Cascade Action Row */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
            {/* TIER 1: Home Sidecar Online (Format Toggle + Prominent Fetch Button) */}
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

            {/* TIER 2: Sidecar Offline or Unconfigured -> Open External Downloader (Auto-Copies URL) */}
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

            {/* TIER 3: Local Import -> Always right next to Tier 1 / Tier 2 */}
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

          {/* Secondary Utility Row: Copy URL & Open in YouTube */}
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

      {/* Fullscreen button (Study Mode bottom-right) */}
      {!theaterMode && !playerError && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleFullscreen();
          }}
          title="Fullscreen"
          className="absolute bottom-3 right-3 z-10 rounded-lg bg-black/60 p-2 text-zinc-300 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}

      {/* Theater Mode Auto-Fading Bottom Overlay */}
      {theaterMode && !playerError && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/75 to-transparent px-5 pb-4 pt-12 transition-opacity duration-500 ${
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
              }}
              className="study-scrubber absolute inset-0 h-full w-full opacity-0 hover:opacity-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {source?.title || 'Lecture Playing'}
              </p>
              <p className="font-mono text-xs text-zinc-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => controllerRef.current?.seekRelative(-seekInterval)}
                className="flex items-center gap-1 rounded-full bg-zinc-800/80 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
              >
                <RotateCcw className="h-4 w-4" />
                {seekInterval}s
              </button>

              <button
                type="button"
                onClick={() => controllerRef.current?.togglePlay()}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={() => controllerRef.current?.seekRelative(seekInterval)}
                className="flex items-center gap-1 rounded-full bg-zinc-800/80 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
              >
                {seekInterval}s
                <RotateCw className="h-4 w-4" />
              </button>

              <span className="rounded-full border border-zinc-700 bg-zinc-800/90 px-2.5 py-1 font-mono text-xs font-medium text-zinc-200">
                {playbackSpeed}x
              </span>

              <button
                type="button"
                onClick={onExitTheater}
                title="Exit Theater Mode"
                className="rounded-lg bg-zinc-800/80 p-2 text-zinc-300 hover:bg-zinc-700 hover:text-white"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default VideoPlayer;
