import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Manages Screen Wake Lock API so mobile screens stay awake
 * while mounted on a car dashboard or desk.
 */
export function useWakeLock(preferred = true) {
  const [enabled, setEnabled] = useState(preferred);
  const [active, setActive] = useState(false);
  const [supported] = useState(() => typeof navigator !== 'undefined' && 'wakeLock' in navigator);
  const sentinelRef = useRef(null);

  const acquire = useCallback(async () => {
    if (!supported || !enabled) return;
    try {
      if (sentinelRef.current && !sentinelRef.current.released) {
        setActive(true);
        return;
      }
      const sentinel = await navigator.wakeLock.request('screen');
      sentinelRef.current = sentinel;
      setActive(true);
      sentinel.addEventListener('release', () => {
        setActive(false);
      });
    } catch {
      setActive(false);
    }
  }, [supported, enabled]);

  const release = useCallback(async () => {
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release();
      } catch {
        // Ignore release errors
      }
      sentinelRef.current = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      acquire();
    } else {
      release();
    }
    return () => {
      release();
    };
  }, [enabled, acquire, release]);

  // Re-acquire wake lock automatically when tab becomes visible again
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && enabled) {
        acquire();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled, acquire]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return { enabled, active, supported, toggle, setEnabled };
}
