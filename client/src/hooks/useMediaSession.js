import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Generates a 1-second silent PCM WAV Blob URL in memory.
 * Used to anchor OS-level MediaSession focus to the parent StudyMedia window
 * so the YouTube iframe cannot hijack Bluetooth/steering-wheel AVRCP buttons.
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
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Samples remain all zeros (complete silence)
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

/**
 * Intercepts navigator.mediaSession AVRCP signals (previoustrack, nexttrack,
 * seekbackward, seekforward, play, pause) and remaps them to interval seeking
 * or double-tap video skipping.
 */
export function useMediaSession({
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
  onNextVideo,
  onPrevVideo,
  onPlay,
  onPause,
}) {
  const audioRef = useRef(null);
  const wavUrlRef = useRef(null);
  const [sessionLockActive, setSessionLockActive] = useState(false);
  const [lastSignal, setLastSignal] = useState(null);

  // Tap timers for single-tap vs double-tap detection
  const prevTapTimerRef = useRef(null);
  const nextTapTimerRef = useRef(null);

  // Latest callbacks in refs so MediaSession handlers never go stale
  const callbacksRef = useRef({});
  callbacksRef.current = {
    seekInterval,
    doubleTapToSkip,
    doubleTapWindow,
    onSeekRelative,
    onNextVideo,
    onPrevVideo,
    onPlay,
    onPause,
  };

  const emitSignal = useCallback((type, detail) => {
    setLastSignal({
      id: Date.now() + Math.random(),
      type,
      detail,
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    });
  }, []);

  // Initialize hidden looping silent audio element
  useEffect(() => {
    const url = createSilentWavUrl();
    wavUrlRef.current = url;
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0.001; // Near-zero; WAV is digital silence anyway
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

  // Sync silent audio playback with YouTube player state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio
        .play()
        .then(() => setSessionLockActive(true))
        .catch(() => setSessionLockActive(false));
    } else {
      audio.pause();
      setSessionLockActive(false);
    }
  }, [isPlaying]);

  // Update MediaSession metadata for car dashboards & lock screens
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'StudyMedia Lecture',
        artist: `StudyMedia • ±${seekInterval}s Scrub`,
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
  }, [title, thumbnail, seekInterval, playbackSpeed]);

  // Update MediaSession position state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof navigator.mediaSession.setPositionState !== 'function') return;
    if (!duration || duration <= 0) return;

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

  // Register MediaSession hardware action handlers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const handlePrevTrack = () => {
      const { seekInterval: interval, doubleTapToSkip: canSkip, doubleTapWindow: windowMs, onSeekRelative: seek, onPrevVideo: prevVid } =
        callbacksRef.current;

      if (!canSkip) {
        emitSignal('previoustrack', `Rewind -${interval}s`);
        seek?.(-interval);
        return;
      }

      if (prevTapTimerRef.current) {
        clearTimeout(prevTapTimerRef.current);
        prevTapTimerRef.current = null;
        emitSignal('double-tap-prev', 'Previous Video in Queue');
        prevVid?.();
      } else {
        prevTapTimerRef.current = setTimeout(() => {
          prevTapTimerRef.current = null;
          emitSignal('previoustrack', `Rewind -${interval}s`);
          seek?.(-interval);
        }, windowMs);
      }
    };

    const handleNextTrack = () => {
      const { seekInterval: interval, doubleTapToSkip: canSkip, doubleTapWindow: windowMs, onSeekRelative: seek, onNextVideo: nextVid } =
        callbacksRef.current;

      if (!canSkip) {
        emitSignal('nexttrack', `Forward +${interval}s`);
        seek?.(interval);
        return;
      }

      if (nextTapTimerRef.current) {
        clearTimeout(nextTapTimerRef.current);
        nextTapTimerRef.current = null;
        emitSignal('double-tap-next', 'Next Video in Queue');
        nextVid?.();
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
      callbacksRef.current.onPlay?.();
    };

    const handlePause = () => {
      emitSignal('pause', 'Pause Playback');
      callbacksRef.current.onPause?.();
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

  // Manual trigger for testing hardware signals in UI
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

  return {
    sessionLockActive,
    lastSignal,
    triggerTestSignal,
  };
}
