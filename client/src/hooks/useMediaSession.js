import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Generates a 1-second silent PCM WAV Blob URL in memory.
 * Used ONLY for iframe-based adapters ('youtube' | 'vimeo') to anchor OS-level
 * MediaSession focus to the parent StudyMedia window so iframes cannot hijack
 * Bluetooth/steering-wheel AVRCP buttons.
 * Disabled for native HTML5 adapters ('local' | 'direct') so <video>/<audio>
 * owns navigator.mediaSession directly for superior lock-screen/background playback.
 */
function createSilentWavUrl() {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Unified Hardware MediaSession hook with Conditional Silent Audio Lock.
 * Binds exclusively to the canonical PlayerController actions (seekRelative,
 * togglePlay/play/pause, nextTrack, prevTrack) identically across all adapters.
 */
export function useMediaSession({
  sourceType = 'youtube',
  isPlaying,
  title,
  thumbnail,
  seekInterval,
  playbackSpeed,
  duration,
  currentTime,
  doubleTapToSkip = true,
  doubleTapWindow = 450,
  onSeekRelative,
  onNextTrack,
  onPrevTrack,
  onTogglePlay,
  onPlay,
  onPause,
}) {
  const audioRef = useRef(null);
  const wavUrlRef = useRef(null);
  const [silentLockPlaying, setSilentLockPlaying] = useState(false);
  const [lastSignal, setLastSignal] = useState(null);

  const isIframeSource = sourceType === 'youtube' || sourceType === 'vimeo';
  const isNativeSource = sourceType === 'local' || sourceType === 'direct';

  // Tap timers for single-tap (±seekInterval) vs double-tap (skip queue item)
  const prevTapTimerRef = useRef(null);
  const nextTapTimerRef = useRef(null);

  // Latest callbacks in refs so MediaSession handlers never go stale
  const callbacksRef = useRef({});
  callbacksRef.current = {
    seekInterval,
    doubleTapToSkip,
    doubleTapWindow,
    onSeekRelative,
    onNextTrack,
    onPrevTrack,
    onTogglePlay,
    onPlay,
    onPause,
  };

  const emitSignal = useCallback((type, detail) => {
    setLastSignal({
      id: Date.now() + Math.random(),
      type,
      detail,
      timestamp: new Date().toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });
  }, []);

  // Initialize hidden looping silent audio element once
  useEffect(() => {
    const url = createSilentWavUrl();
    wavUrlRef.current = url;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.001;
    audio.setAttribute('playsinline', '');
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      if (wavUrlRef.current) {
        URL.revokeObjectURL(wavUrlRef.current);
      }
      clearTimeout(prevTapTimerRef.current);
      clearTimeout(nextTapTimerRef.current);
    };
  }, []);

  // Conditional Silent Audio Lock:
  // Active ONLY when sourceType is 'youtube' or 'vimeo' AND playing.
  // Disabled immediately for 'local' or 'direct' HTML5 sources so native media owns MediaSession.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isIframeSource && isPlaying) {
      audio
        .play()
        .then(() => setSilentLockPlaying(true))
        .catch(() => setSilentLockPlaying(false));
    } else {
      audio.pause();
      setSilentLockPlaying(false);
    }
  }, [isIframeSource, isPlaying]);

  // Sync OS MediaSession playbackState
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch {
      // ignore
    }
  }, [isPlaying]);

  // Update MediaSession metadata for car dashboards & lock screens
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const sourceBadge =
      sourceType === 'local'
        ? 'Offline'
        : sourceType === 'vimeo'
        ? 'Vimeo'
        : sourceType === 'direct'
        ? 'Direct'
        : 'YouTube';

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'StudyMedia Lecture',
        artist: `StudyMedia (${sourceBadge}) • ±${seekInterval}s Scrub`,
        album: `${playbackSpeed}x Speed`,
        artwork: thumbnail
          ? [
              { src: thumbnail, sizes: '480x360', type: 'image/jpeg' },
              { src: thumbnail, sizes: '512x512', type: 'image/jpeg' },
            ]
          : [],
      });
    } catch {
      // Ignore metadata errors on unsupported browsers
    }
  }, [title, thumbnail, seekInterval, playbackSpeed, sourceType]);

  // Update MediaSession position state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!duration || duration <= 0 || !Number.isFinite(duration)) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: playbackSpeed || 1,
        position: Math.min(Math.max(0, currentTime || 0), duration),
      });
    } catch {
      // Ignore invalid position state errors
    }
  }, [duration, currentTime, playbackSpeed]);

  // Register MediaSession hardware action handlers (identical across all adapters)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const handlePrevTrack = () => {
      const {
        seekInterval: interval,
        doubleTapToSkip: canSkip,
        doubleTapWindow: windowMs,
        onSeekRelative: seek,
        onPrevTrack: prevTrack,
      } = callbacksRef.current;

      if (!canSkip) {
        emitSignal('previoustrack', `Rewind -${interval}s`);
        seek?.(-interval);
        return;
      }

      if (prevTapTimerRef.current) {
        clearTimeout(prevTapTimerRef.current);
        prevTapTimerRef.current = null;
        emitSignal('double-tap-prev', 'Previous Lecture in Queue');
        prevTrack?.();
      } else {
        prevTapTimerRef.current = setTimeout(() => {
          prevTapTimerRef.current = null;
          emitSignal('previoustrack', `Rewind -${interval}s`);
          seek?.(-interval);
        }, windowMs);
      }
    };

    const handleNextTrack = () => {
      const {
        seekInterval: interval,
        doubleTapToSkip: canSkip,
        doubleTapWindow: windowMs,
        onSeekRelative: seek,
        onNextTrack: nextTrack,
      } = callbacksRef.current;

      if (!canSkip) {
        emitSignal('nexttrack', `Forward +${interval}s`);
        seek?.(interval);
        return;
      }

      if (nextTapTimerRef.current) {
        clearTimeout(nextTapTimerRef.current);
        nextTapTimerRef.current = null;
        emitSignal('double-tap-next', 'Next Lecture in Queue');
        nextTrack?.();
      } else {
        nextTapTimerRef.current = setTimeout(() => {
          nextTapTimerRef.current = null;
          emitSignal('nexttrack', `Forward +${interval}s`);
          seek?.(interval);
        }, windowMs);
      }
    };

    const handleSeekBackward = (details) => {
      const interval = details?.seekOffset || callbacksRef.current.seekInterval;
      emitSignal('seekbackward', `Rewind -${interval}s`);
      callbacksRef.current.onSeekRelative?.(-interval);
    };

    const handleSeekForward = (details) => {
      const interval = details?.seekOffset || callbacksRef.current.seekInterval;
      emitSignal('seekforward', `Forward +${interval}s`);
      callbacksRef.current.onSeekRelative?.(interval);
    };

    const handlePlay = () => {
      emitSignal('play', 'Resume Playback');
      if (callbacksRef.current.onPlay) {
        callbacksRef.current.onPlay();
      } else {
        callbacksRef.current.onTogglePlay?.();
      }
    };

    const handlePause = () => {
      emitSignal('pause', 'Pause Playback');
      if (callbacksRef.current.onPause) {
        callbacksRef.current.onPause();
      } else {
        callbacksRef.current.onTogglePlay?.();
      }
    };

    const actions = [
      ['previoustrack', handlePrevTrack],
      ['nexttrack', handleNextTrack],
      ['seekbackward', handleSeekBackward],
      ['seekforward', handleSeekForward],
      ['play', handlePlay],
      ['pause', handlePause],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore cleanup errors
        }
      }
    };
  }, [emitSignal]);

  const triggerTestSignal = useCallback(
    (direction) => {
      if (direction === 'prev') {
        emitSignal('test-prev', `Simulated Back (-${seekInterval}s)`);
        onSeekRelative?.(-seekInterval);
      } else {
        emitSignal('test-next', `Simulated Forward (+${seekInterval}s)`);
        onSeekRelative?.(seekInterval);
      }
    },
    [emitSignal, onSeekRelative, seekInterval]
  );

  // Derived lock mode for header indicator
  const sessionLockMode = isNativeSource
    ? isPlaying
      ? 'native'
      : 'standby'
    : silentLockPlaying
    ? 'silent-lock'
    : 'standby';

  return {
    sessionLockActive: sessionLockMode !== 'standby',
    sessionLockMode,
    lastSignal,
    triggerTestSignal,
  };
}
