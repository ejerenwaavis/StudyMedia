import { YouTubeAdapter } from './YouTubeAdapter';
import { HTML5Adapter } from './HTML5Adapter';
import { VimeoAdapter } from './VimeoAdapter';

const SEEK_ACCUMULATION_WINDOW_MS = 1500;

/**
 * Unified PlayerController
 * Single canonical controller bridging the UI + Hardware MediaSession to whichever
 * MediaAdapter matches the active queue item's sourceType.
 */
export class PlayerController {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = {
      onReady: callbacks.onReady || (() => {}),
      onStateChange: callbacks.onStateChange || (() => {}),
      onTimeUpdate: callbacks.onTimeUpdate || (() => {}),
      onError: callbacks.onError || (() => {}),
      onProgressSave: callbacks.onProgressSave || (() => {}),
      onEnded: callbacks.onEnded || (() => {}),
    };
    this.adapter = null;
    this.currentSource = null;
    this.state = 'paused'; // 'playing' | 'paused' | 'buffering' | 'ended'
    this.lastSavedAt = 0;
    this.hasEmittedEnded = false;

    // Optimistic seek accumulation state for rapid repeated hardware/UI taps
    this.pendingSeekTarget = null;
    this.lastSeekAt = 0;
  }

  _resetPendingSeek() {
    this.pendingSeekTarget = null;
    this.lastSeekAt = 0;
  }

  _createAdapter(source, callbacks) {
    // Any item with a local IndexedDB blob OR Cloudflare R2 key uses native HTML5Adapter
    if (source?.isOfflineReady && source?.localBlobId) {
      return new HTML5Adapter(this.container, callbacks);
    }
    switch (source?.sourceType) {
      case 'youtube':
        return new YouTubeAdapter(this.container, callbacks);
      case 'vimeo':
        return new VimeoAdapter(this.container, callbacks);
      case 'local':
      case 'direct':
      case 'r2':
        return new HTML5Adapter(this.container, callbacks);
      default:
        return source?.r2Key
          ? new HTML5Adapter(this.container, callbacks)
          : new YouTubeAdapter(this.container, callbacks);
    }
  }

  async load(source, { startTime = 0, playbackRate = 1 } = {}) {
    this.destroyAdapter();
    if (!source || !this.container) return;

    this.currentSource = source;
    this.state = 'buffering';
    this.lastSavedAt = Date.now();
    this.hasEmittedEnded = false;
    this._resetPendingSeek();

    const adapterCallbacks = {
      onReady: () => {
        this.callbacks.onReady();
      },
      onStateChange: (nextState) => {
        if (nextState === 'playing') {
          this.hasEmittedEnded = false;
        }

        if (nextState === 'ended') {
          // Guard so ended/auto-advance fires strictly once per track completion
          if (this.hasEmittedEnded) return;
          this.hasEmittedEnded = true;
        }

        this.state = nextState;
        this.callbacks.onStateChange(nextState);

        if (nextState === 'paused' || nextState === 'ended') {
          const cur = this.getCurrentTime();
          const dur = this.getDuration();
          if (cur > 0 || dur > 0) {
            this.callbacks.onProgressSave(cur, dur);
          }
        }

        if (nextState === 'ended') {
          this.callbacks.onEnded();
        }
      },
      onTimeUpdate: (cur, dur) => {
        const now = Date.now();

        // While a recent seek is still buffering, prevent stale adapter ticks from snapping the UI backward
        if (this.pendingSeekTarget !== null) {
          const elapsed = now - this.lastSeekAt;
          if (elapsed <= SEEK_ACCUMULATION_WINDOW_MS) {
            if (Math.abs(cur - this.pendingSeekTarget) <= 1.5) {
              // Adapter caught up to the seek target
              this._resetPendingSeek();
            } else {
              // Keep UI scrubber pinned to the optimistic target while buffering
              this.callbacks.onTimeUpdate(this.pendingSeekTarget, dur);
              return;
            }
          } else {
            this._resetPendingSeek();
          }
        }

        this.callbacks.onTimeUpdate(cur, dur);
        if (this.state === 'playing' && now - this.lastSavedAt >= 5000) {
          this.lastSavedAt = now;
          this.callbacks.onProgressSave(cur, dur);
        }
      },
      onError: (err) => {
        this.state = 'paused';
        this._resetPendingSeek();
        this.callbacks.onError(err);
      },
    };

    this.adapter = this._createAdapter(source, adapterCallbacks);
    await this.adapter.load(source, startTime, playbackRate);
  }

  play() {
    this.adapter?.play();
  }

  pause() {
    this.adapter?.pause();
  }

  togglePlay() {
    if (this.state === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  seekTo(seconds) {
    if (!this.adapter) return;
    const dur = this.adapter.getDuration() || 0;
    const clamped =
      dur > 0 ? Math.max(0, Math.min(dur, seconds)) : Math.max(0, seconds);

    this.pendingSeekTarget = clamped;
    this.lastSeekAt = Date.now();

    this.adapter.seekTo(clamped);
    this.callbacks.onTimeUpdate(clamped, dur);
  }

  /**
   * Relative seek with optimistic accumulation for repeated rapid taps.
   * Always reads live time directly from the active adapter (never React state).
   * If tapped again within 1500ms while buffering, accumulates on pendingSeekTarget
   * so repeated taps step cleanly (-15s -> -30s -> -45s).
   */
  seekRelative(deltaSeconds) {
    if (!this.adapter || !Number.isFinite(deltaSeconds)) return;

    const now = Date.now();
    const dur = this.adapter.getDuration() || 0;
    const hasPendingSeek =
      this.pendingSeekTarget !== null &&
      now - this.lastSeekAt <= SEEK_ACCUMULATION_WINDOW_MS;

    const baseTime = hasPendingSeek
      ? this.pendingSeekTarget
      : this.adapter.getCurrentTime() || 0;

    const rawTarget = baseTime + deltaSeconds;
    const newTarget =
      dur > 0 ? Math.max(0, Math.min(dur, rawTarget)) : Math.max(0, rawTarget);

    this.pendingSeekTarget = newTarget;
    this.lastSeekAt = now;

    this.adapter.seekTo(newTarget);
    this.callbacks.onTimeUpdate(newTarget, dur);
    this.callbacks.onProgressSave(newTarget, dur);
  }

  setPlaybackRate(rate) {
    this.adapter?.setPlaybackRate(rate);
  }

  getCurrentTime() {
    if (
      this.pendingSeekTarget !== null &&
      Date.now() - this.lastSeekAt <= SEEK_ACCUMULATION_WINDOW_MS
    ) {
      return this.pendingSeekTarget;
    }
    return this.adapter?.getCurrentTime() || 0;
  }

  getDuration() {
    return this.adapter?.getDuration() || 0;
  }

  getState() {
    return this.state;
  }

  destroyAdapter() {
    this.hasEmittedEnded = false;
    this._resetPendingSeek();
    if (this.adapter) {
      this.adapter.destroy();
      this.adapter = null;
    }
  }

  destroy() {
    this.destroyAdapter();
    this.currentSource = null;
  }
}
