import { useEffect, useRef, useState, useCallback } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 280;
const DOUBLE_TAP_MAX_DIST = 28;
const DRAG_THRESHOLD_PX = 7;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function getTouchDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.hypot(dx, dy);
}

function getTouchMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

/**
 * Reusable 60fps Pinch-to-Zoom (1x–4x) & 1-Finger Pan Hook.
 * Directly mutates `contentRef.current.style.transform` during active gestures
 * for zero React re-render lag, syncing lightweight React state only for HUD display.
 */
export function usePinchZoom({
  stageRef,
  contentRef,
  overlayRef,
  enabled = true,
  onSingleTap,
  onActivity,
  resetKey = '',
}) {
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  const callbacksRef = useRef({});
  callbacksRef.current = { onSingleTap, onActivity };

  const singleTapTimerRef = useRef(null);
  const lastTapRef = useRef({ time: 0, x: 0, y: 0 });
  const lastTouchTimeRef = useRef(0);
  const gestureRef = useRef({
    mode: 'none', // 'none' | 'pinch' | 'pan' | 'mouse-pan' | 'tap-candidate'
    startScale: 1,
    startX: 0,
    startY: 0,
    startDist: 0,
    startMidX: 0,
    startMidY: 0,
    startClientX: 0,
    startClientY: 0,
    moved: false,
  });

  const clampTransform = useCallback(
    (scale, x, y) => {
      const clampedScale = clamp(scale, MIN_SCALE, MAX_SCALE);
      if (clampedScale <= 1.01) {
        return { scale: 1, x: 0, y: 0 };
      }
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return { scale: clampedScale, x: 0, y: 0 };
      }
      const maxX = (rect.width * (clampedScale - 1)) / 2;
      const maxY = (rect.height * (clampedScale - 1)) / 2;
      return {
        scale: clampedScale,
        x: clamp(x, -maxX, maxX),
        y: clamp(y, -maxY, maxY),
      };
    },
    [stageRef]
  );

  const applyTransform = useCallback(
    (nextScale, nextX, nextY, animate = false) => {
      const clamped = clampTransform(nextScale, nextX, nextY);
      transformRef.current = clamped;

      const el = contentRef.current;
      if (el) {
        el.style.transition = animate ? 'transform 180ms ease-out' : 'none';
        el.style.transform = `translate3d(${clamped.x.toFixed(2)}px, ${clamped.y.toFixed(
          2
        )}px, 0) scale(${clamped.scale.toFixed(4)})`;
      }

      const rounded = clamped.scale <= 1.01 ? 1 : Math.round(clamped.scale * 10) / 10;
      setZoomLevel((prev) => (prev === rounded ? prev : rounded));
    },
    [clampTransform, contentRef]
  );

  const zoomAtPoint = useCallback(
    (targetScale, clientX, clientY, animate = true) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) {
        applyTransform(targetScale, 0, 0, animate);
        return;
      }

      const { scale: s0, x: x0, y: y0 } = transformRef.current;
      const s1 = clamp(targetScale, MIN_SCALE, MAX_SCALE);
      if (s1 <= 1.01) {
        applyTransform(1, 0, 0, animate);
        return;
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const px = clientX - cx;
      const py = clientY - cy;

      const ux = (px - x0) / s0;
      const uy = (py - y0) / s0;
      const x1 = px - ux * s1;
      const y1 = py - uy * s1;

      applyTransform(s1, x1, y1, animate);
    },
    [stageRef, applyTransform]
  );

  const resetZoom = useCallback(
    (animate = true) => {
      applyTransform(1, 0, 0, animate);
    },
    [applyTransform]
  );

  const zoomIn = useCallback(() => {
    const next = clamp(transformRef.current.scale + 0.5, MIN_SCALE, MAX_SCALE);
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      zoomAtPoint(next, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
    } else {
      applyTransform(next, 0, 0, true);
    }
  }, [stageRef, zoomAtPoint, applyTransform]);

  const zoomOut = useCallback(() => {
    const next = clamp(transformRef.current.scale - 0.5, MIN_SCALE, MAX_SCALE);
    const rect = stageRef.current?.getBoundingClientRect();
    if (next <= 1.05) {
      resetZoom(true);
    } else if (rect) {
      zoomAtPoint(next, rect.left + rect.width / 2, rect.top + rect.height / 2, true);
    } else {
      applyTransform(next, 0, 0, true);
    }
  }, [stageRef, zoomAtPoint, applyTransform, resetZoom]);

  // Auto-reset whenever active track, fullscreen state, or audio-only changes
  useEffect(() => {
    clearTimeout(singleTapTimerRef.current);
    applyTransform(1, 0, 0, false);
  }, [resetKey, applyTransform]);

  // Re-clamp cleanly when container resizes (orientation change / fullscreen transition)
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const { scale, x, y } = transformRef.current;
      if (scale > 1) {
        applyTransform(scale, x, y, false);
      }
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stageRef, applyTransform]);

  // Bind non-passive touch, wheel, and mouse listeners directly to the overlay element
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !enabled) return;

    const handleTouchStart = (e) => {
      lastTouchTimeRef.current = Date.now();

      if (e.touches.length === 2) {
        e.preventDefault();
        callbacksRef.current.onActivity?.();
        clearTimeout(singleTapTimerRef.current);
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        gestureRef.current = {
          mode: 'pinch',
          startScale: transformRef.current.scale,
          startX: transformRef.current.x,
          startY: transformRef.current.y,
          startDist: Math.max(10, getTouchDistance(e.touches[0], e.touches[1])),
          startMidX: mid.x,
          startMidY: mid.y,
          startClientX: mid.x,
          startClientY: mid.y,
          moved: true,
        };
        setIsDragging(true);
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        gestureRef.current = {
          mode: transformRef.current.scale > 1.01 ? 'pan' : 'tap-candidate',
          startScale: transformRef.current.scale,
          startX: transformRef.current.x,
          startY: transformRef.current.y,
          startDist: 0,
          startMidX: t.clientX,
          startMidY: t.clientY,
          startClientX: t.clientX,
          startClientY: t.clientY,
          moved: false,
        };
      }
    };

    const handleTouchMove = (e) => {
      const g = gestureRef.current;

      if (e.touches.length === 2) {
        e.preventDefault();
        if (g.mode !== 'pinch') {
          const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
          g.mode = 'pinch';
          g.startScale = transformRef.current.scale;
          g.startX = transformRef.current.x;
          g.startY = transformRef.current.y;
          g.startDist = Math.max(10, getTouchDistance(e.touches[0], e.touches[1]));
          g.startMidX = mid.x;
          g.startMidY = mid.y;
          g.moved = true;
        }

        const rect = stageRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dist = getTouchDistance(e.touches[0], e.touches[1]);
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        const s1 = clamp(g.startScale * (dist / g.startDist), MIN_SCALE, MAX_SCALE);

        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ux = (g.startMidX - cx - g.startX) / g.startScale;
        const uy = (g.startMidY - cy - g.startY) / g.startScale;
        const x1 = mid.x - cx - ux * s1;
        const y1 = mid.y - cy - uy * s1;

        applyTransform(s1, x1, y1, false);
        return;
      }

      if (e.touches.length === 1 && (g.mode === 'pan' || g.mode === 'tap-candidate')) {
        const t = e.touches[0];
        const dx = t.clientX - g.startClientX;
        const dy = t.clientY - g.startClientY;

        if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
          g.moved = true;
          clearTimeout(singleTapTimerRef.current);
          if (transformRef.current.scale > 1.01) {
            setIsDragging(true);
          }
        }

        if (g.mode === 'pan' && transformRef.current.scale > 1.01) {
          e.preventDefault();
          applyTransform(transformRef.current.scale, g.startX + dx, g.startY + dy, false);
        }
      }
    };

    const handleTouchEnd = (e) => {
      lastTouchTimeRef.current = Date.now();
      const g = gestureRef.current;

      // Seamless handoff from 2-finger pinch to 1-finger pan without jump
      if (e.touches.length === 1 && g.mode === 'pinch') {
        const t = e.touches[0];
        gestureRef.current = {
          mode: transformRef.current.scale > 1.01 ? 'pan' : 'none',
          startScale: transformRef.current.scale,
          startX: transformRef.current.x,
          startY: transformRef.current.y,
          startDist: 0,
          startMidX: t.clientX,
          startMidY: t.clientY,
          startClientX: t.clientX,
          startClientY: t.clientY,
          moved: true,
        };
        return;
      }

      if (e.touches.length === 0) {
        setIsDragging(false);

        // Clean tap (no pinch, no drag)
        if (!g.moved && (g.mode === 'pan' || g.mode === 'tap-candidate')) {
          // Prevent synthetic mouse click double-firing after touch
          e.preventDefault();
          const now = Date.now();
          const prev = lastTapRef.current;
          const dist = Math.hypot(g.startClientX - prev.x, g.startClientY - prev.y);

          if (now - prev.time <= DOUBLE_TAP_MS && dist <= DOUBLE_TAP_MAX_DIST) {
            // Double-tap detected!
            clearTimeout(singleTapTimerRef.current);
            lastTapRef.current = { time: 0, x: 0, y: 0 };
            if (transformRef.current.scale > 1.05) {
              resetZoom(true);
            } else {
              zoomAtPoint(2, g.startClientX, g.startClientY, true);
            }
          } else {
            // Potential single-tap: debounce past double-tap window
            lastTapRef.current = { time: now, x: g.startClientX, y: g.startClientY };
            clearTimeout(singleTapTimerRef.current);
            singleTapTimerRef.current = setTimeout(() => {
              callbacksRef.current.onSingleTap?.();
            }, DOUBLE_TAP_MS);
          }
        }

        // Snap cleanly if released near 1x
        if (transformRef.current.scale <= 1.03) {
          applyTransform(1, 0, 0, true);
        }

        gestureRef.current.mode = 'none';
      }
    };

    // Desktop Ctrl + Wheel (and trackpad pinch)
    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      callbacksRef.current.onActivity?.();
      const factor = Math.exp(-e.deltaY * 0.004);
      const nextScale = clamp(transformRef.current.scale * factor, MIN_SCALE, MAX_SCALE);
      zoomAtPoint(nextScale, e.clientX, e.clientY, false);
    };

    // Desktop Mouse Pan & Click / Double-Click (strictly ignored after touch to prevent ghost mouse events)
    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (Date.now() - lastTouchTimeRef.current < 700) return;
      gestureRef.current = {
        mode: transformRef.current.scale > 1.01 ? 'mouse-pan' : 'tap-candidate',
        startScale: transformRef.current.scale,
        startX: transformRef.current.x,
        startY: transformRef.current.y,
        startDist: 0,
        startMidX: e.clientX,
        startMidY: e.clientY,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false,
      };
    };

    const handleWindowMouseMove = (e) => {
      if (Date.now() - lastTouchTimeRef.current < 700) return;
      const g = gestureRef.current;
      if (g.mode !== 'mouse-pan' && g.mode !== 'tap-candidate') return;
      if ((e.buttons & 1) === 0) return;

      const dx = e.clientX - g.startClientX;
      const dy = e.clientY - g.startClientY;

      if (!g.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        g.moved = true;
        clearTimeout(singleTapTimerRef.current);
        if (g.mode === 'mouse-pan') {
          setIsDragging(true);
        }
      }

      if (g.mode === 'mouse-pan' && g.moved) {
        e.preventDefault();
        applyTransform(transformRef.current.scale, g.startX + dx, g.startY + dy, false);
      }
    };

    const handleWindowMouseUp = (e) => {
      if (Date.now() - lastTouchTimeRef.current < 700) return;
      const g = gestureRef.current;
      if (g.mode !== 'mouse-pan' && g.mode !== 'tap-candidate') return;

      const wasMoved = g.moved;
      const tapX = g.startClientX;
      const tapY = g.startClientY;
      gestureRef.current.mode = 'none';
      setIsDragging(false);

      if (!wasMoved) {
        const now = Date.now();
        const prev = lastTapRef.current;
        const dist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);

        if (now - prev.time <= DOUBLE_TAP_MS && dist <= DOUBLE_TAP_MAX_DIST) {
          clearTimeout(singleTapTimerRef.current);
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          if (transformRef.current.scale > 1.05) {
            resetZoom(true);
          } else {
            zoomAtPoint(2, tapX, tapY, true);
          }
        } else {
          lastTapRef.current = { time: now, x: tapX, y: tapY };
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = setTimeout(() => {
            callbacksRef.current.onSingleTap?.();
          }, DOUBLE_TAP_MS);
        }
      }
    };

    overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
    overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
    overlay.addEventListener('touchend', handleTouchEnd, { passive: false });
    overlay.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    overlay.addEventListener('wheel', handleWheel, { passive: false });
    overlay.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      clearTimeout(singleTapTimerRef.current);
      overlay.removeEventListener('touchstart', handleTouchStart);
      overlay.removeEventListener('touchmove', handleTouchMove);
      overlay.removeEventListener('touchend', handleTouchEnd);
      overlay.removeEventListener('touchcancel', handleTouchEnd);
      overlay.removeEventListener('wheel', handleWheel);
      overlay.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [overlayRef, stageRef, enabled, applyTransform, zoomAtPoint, resetZoom]);

  return {
    zoomLevel,
    isZoomed: zoomLevel > 1.05,
    isDragging,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
