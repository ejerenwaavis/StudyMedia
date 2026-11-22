import { YouTubeAdapter } from './YouTubeAdapter';
import { HTML5Adapter } from './HTML5Adapter';
import { VimeoAdapter } from './VimeoAdapter';

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
    };
    this.adapter = null;
    this.currentSource = null;
    this.state = 'paused'; // 'playing' | 'paused' | 'buffering' | 'ended'
    this.lastSavedAt = 0;
  }

  _createAdapter(sourceType, callbacks) {
    switch (sourceType) {
      case 'youtube':
        return new YouTubeAdapter(this.container, callbacks);
      case 'vimeo':
        return new VimeoAdapter(this.container, callbacks);
      case 'local':
      case 'direct':
        return new HTML5Adapter(this.container, callbacks);
      default:
        return new YouTubeAdapter(this.container, callbacks);
    }
  }

  async load(source, { startTime = 0, playbackRate = 1 } = {}) {
    this.destroyAdapter();
    if (!source || !this.container) return;

    this.currentSource = source;
    this.state = 'buffering';
    this.lastSavedAt = Date.now();

    const adapterCallbacks = {
      onReady: () => {
        this.callbacks.onReady();
      },
      onStateChange: (nextState) => {
        this.state = nextState;
        this.callbacks.onStateChange(nextState);

        if (nextState === 'paused' || nextState === 'ended') {
          const cur = this.getCurrentTime();
          const dur = this.getDuration();
          if (cur > 0 || dur > 0) {
            this.callbacks.onProgressSave(cur, dur);
          }
        }
      },
      onTimeUpdate: (cur, dur) => {
        this.callbacks.onTimeUpdate(cur, dur);
        const now = Date.now();
        if (this.state === 'playing' && now - this.lastSavedAt >= 5000) {
          this.lastSavedAt = now;
          this.callbacks.onProgressSave(cur, dur);
        }
      },
      onError: (err) => {
        this.state = 'paused';
        this.callbacks.onError(err);
      },
    };

    this.adapter = this._createAdapter(source.sourceType, adapterCallbacks);
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
    this.adapter?.seekTo(seconds);
  }

  seekRelative(delta) {
    if (!this.adapter) return;
    const cur = this.adapter.getCurrentTime();
    const dur = this.adapter.getDuration();
    const target = Math.max(0, dur > 0 ? Math.min(dur - 0.5, cur + delta) : cur + delta);
    this.adapter.seekTo(target);
    this.callbacks.onProgressSave(target, dur);
  }

  setPlaybackRate(rate) {
    this.adapter?.setPlaybackRate(rate);
  }

  getCurrentTime() {
    return this.adapter?.getCurrentTime() || 0;
  }

  getDuration() {
    return this.adapter?.getDuration() || 0;
  }

  getState() {
    return this.state;
  }

  destroyAdapter() {
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
