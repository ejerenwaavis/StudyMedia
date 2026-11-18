import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState, useCallback } from 'react';
import { Play, Pause, Maximize2, Minimize2, Headphones, RotateCcw, RotateCw } from 'lucide-react';
import { formatTime, getThumbnailUrl } from '../utils/youtube';

let ytApiPromise = null;

function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject();
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prevCallback = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevCallback === 'function') prevCallback();
      resolve(window.YT);
    };

    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

const VideoPlayer = forwardRef(function VideoPlayer(
  {
    videoId,
    playlistId,
    title,
    initialTime = 0,
    playbackSpeed = 1.25,
    seekInterval = 15,
    audioOnlyMode = false,
    theaterMode = false,
    onStateChange,
    onTimeUpdate,
    onProgressSave,
    onExitTheater,
  },
  ref
) {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const playerRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime || 0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const fadeTimerRef = useRef(null);
  const lastSavedRef = useRef(0);
  const initialSeekDoneRef = useRef(false);

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

  // Initialize YouTube IFrame Player
  useEffect(() => {
    if (!videoId && !playlistId) return;
    let destroyed = false;
    initialSeekDoneRef.current = false;

    loadYouTubeApi().then((YT) => {
      if (destroyed || !containerRef.current) return;

      // Clean up any previous player instance
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      const mountEl = document.createElement('div');
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(mountEl);

      const playerVars = {
        autoplay: 1,
        controls: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        origin: window.location.origin,
      };

      if (playlistId) {
        playerVars.listType = 'playlist';
        playerVars.list = playlistId;
      }

      playerRef.current = new YT.Player(mountEl, {
        videoId: videoId || undefined,
        width: '100%',
        height: '100%',
        playerVars,
        events: {
          onReady: (event) => {
            if (destroyed) return;
            const player = event.target;
            setIsReady(true);

            const dur = player.getDuration?.() || 0;
            setDuration(dur);

            if (latestPropsRef.current.playbackSpeed) {
              player.setPlaybackRate(latestPropsRef.current.playbackSpeed);
            }

            const startAt = latestPropsRef.current.initialTime || 0;
            if (startAt > 2 && (!dur || startAt < dur - 10) && !initialSeekDoneRef.current) {
              initialSeekDoneRef.current = true;
              player.seekTo(startAt, true);
              setCurrentTime(startAt);
            }
          },
          onStateChange: (event) => {
            if (destroyed) return;
            const state = event.data;
            const playing = state === YT.PlayerState.PLAYING;
            setIsPlaying(playing);
            latestPropsRef.current.onStateChange?.(playing, state);

            const player = event.target;
            const dur = player.getDuration?.() || 0;
            const cur = player.getCurrentTime?.() || 0;
            if (dur > 0) setDuration(dur);
            setCurrentTime(cur);

            if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED) {
              latestPropsRef.current.onProgressSave?.(cur, dur);
            }
          },
        },
      });
    });

    return () => {
      destroyed = true;
      setIsReady(false);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }
    };
  }, [videoId, playlistId]);

  // Apply playback speed updates
  useEffect(() => {
    if (isReady && playerRef.current?.setPlaybackRate) {
      try {
        playerRef.current.setPlaybackRate(playbackSpeed);
      } catch {
        // ignore
      }
    }
  }, [playbackSpeed, isReady]);

  // Poll current time & auto-save every 5 seconds
  useEffect(() => {
    if (!isReady) return;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;

      const cur = player.getCurrentTime() || 0;
      const dur = player.getDuration?.() || 0;
      setCurrentTime(cur);
      if (dur > 0) setDuration(dur);

      latestPropsRef.current.onTimeUpdate?.(cur, dur);

      const now = Date.now();
      if (isPlaying && now - lastSavedRef.current >= 5000) {
        lastSavedRef.current = now;
        latestPropsRef.current.onProgressSave?.(cur, dur);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [isReady, isPlaying]);

  useImperativeHandle(ref, () => ({
    seekRelative(delta) {
      const player = playerRef.current;
      if (!player || typeof player.getCurrentTime !== 'function') return;
      const cur = player.getCurrentTime() || 0;
      const dur = player.getDuration?.() || 0;
      const target = Math.max(0, dur > 0 ? Math.min(dur - 1, cur + delta) : cur + delta);
      player.seekTo(target, true);
      setCurrentTime(target);
      latestPropsRef.current.onTimeUpdate?.(target, dur);
      latestPropsRef.current.onProgressSave?.(target, dur);
    },
    seekTo(time) {
      const player = playerRef.current;
      if (!player || typeof player.seekTo !== 'function') return;
      const dur = player.getDuration?.() || 0;
      const target = Math.max(0, time);
      player.seekTo(target, true);
      setCurrentTime(target);
      latestPropsRef.current.onTimeUpdate?.(target, dur);
    },
    play() {
      playerRef.current?.playVideo?.();
    },
    pause() {
      playerRef.current?.pauseVideo?.();
    },
    togglePlay() {
      if (isPlaying) {
        playerRef.current?.pauseVideo?.();
      } else {
        playerRef.current?.playVideo?.();
      }
    },
    getCurrentTime() {
      return playerRef.current?.getCurrentTime?.() || 0;
    },
    getDuration() {
      return playerRef.current?.getDuration?.() || 0;
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

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={stageRef}
      onMouseMove={resetFadeTimer}
      onTouchStart={resetFadeTimer}
      className={`relative w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-obsidian-900 shadow-2xl transition-all duration-300 ${
        theaterMode ? 'aspect-[16/9] max-h-[78vh]' : 'aspect-video'
      }`}
    >
      {/* YouTube IFrame Mount (kept mounted in audioOnlyMode so playback continues) */}
      <div
        ref={containerRef}
        className={`h-full w-full transition-opacity duration-300 ${
          audioOnlyMode ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
      />

      {/* Audio-Only / Minimal Distraction Overlay */}
      {audioOnlyMode && (
        <div
          onClick={() => (isPlaying ? playerRef.current?.pauseVideo?.() : playerRef.current?.playVideo?.())}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-obsidian-900 via-obsidian-950 to-zinc-900 p-6 text-center"
        >
          {videoId && (
            <img
              src={getThumbnailUrl(videoId)}
              alt={title}
              className="mb-4 h-24 w-40 rounded-xl object-cover opacity-50 ring-1 ring-zinc-700/60"
            />
          )}
          <div className="mb-2 flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
            <Headphones className="h-3.5 w-3.5" />
            Audio-Only Focus Mode
          </div>
          <p className="max-w-md truncate text-base font-semibold text-zinc-100">
            {title || 'Playing Lecture Audio'}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Video hidden to save battery & reduce distraction • Tap to {isPlaying ? 'pause' : 'play'}
          </p>
        </div>
      )}

      {/* Center Play/Pause Tap Zone (Study Mode) */}
      {!audioOnlyMode && !theaterMode && (
        <div
          onClick={() => (isPlaying ? playerRef.current?.pauseVideo?.() : playerRef.current?.playVideo?.())}
          className="group absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 transition-colors hover:bg-black/20"
        >
          <div
            className={`flex h-16 w-16 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-all duration-200 ${
              isPlaying ? 'scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100' : 'scale-100 opacity-100'
            }`}
          >
            {isPlaying ? <Pause className="h-7 w-7" /> : <Play className="ml-1 h-7 w-7" />}
          </div>
        </div>
      )}

      {/* Fullscreen button (Study Mode top-right / bottom-right) */}
      {!theaterMode && (
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

      {/* Theater Mode Auto-Fading Bottom Overlay (matches mockup) */}
      {theaterMode && (
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
                playerRef.current?.seekTo?.(val, true);
                setCurrentTime(val);
              }}
              className="study-scrubber absolute inset-0 h-full w-full opacity-0 hover:opacity-100"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{title || 'Lecture Playing'}</p>
              <p className="font-mono text-xs text-zinc-400">
                {formatTime(currentTime)} / {formatTime(duration)}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const cur = playerRef.current?.getCurrentTime?.() || 0;
                  playerRef.current?.seekTo?.(Math.max(0, cur - seekInterval), true);
                }}
                className="flex items-center gap-1 rounded-full bg-zinc-800/80 px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:bg-zinc-700"
              >
                <RotateCcw className="h-4 w-4" />
                {seekInterval}s
              </button>

              <button
                type="button"
                onClick={() => (isPlaying ? playerRef.current?.pauseVideo?.() : playerRef.current?.playVideo?.())}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition hover:scale-105"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  const cur = playerRef.current?.getCurrentTime?.() || 0;
                  playerRef.current?.seekTo?.(cur + seekInterval, true);
                }}
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
