/**
 * Canonical MediaAdapter interface / base class.
 * Every source adapter (YouTube, HTML5, Vimeo) implements the exact same API
 * so the UI and hardware MediaSession controller remain 100% source-agnostic.
 *
 * Callbacks passed to constructor:
 * - onReady: () => void
 * - onStateChange: (state: 'playing' | 'paused' | 'buffering' | 'ended') => void
 * - onTimeUpdate: (currentTime: number, duration: number) => void
 * - onError: (error: { code: string, message: string, recoverable: boolean }) => void
 */
export class MediaAdapter {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = {
      onReady: callbacks.onReady || (() => {}),
      onStateChange: callbacks.onStateChange || (() => {}),
      onTimeUpdate: callbacks.onTimeUpdate || (() => {}),
      onError: callbacks.onError || (() => {}),
    };
    this.destroyed = false;
  }

  // eslint-disable-next-line no-unused-vars
  async load(source, startTime = 0, playbackRate = 1) {
    throw new Error('MediaAdapter.load() must be implemented');
  }

  play() {
    throw new Error('MediaAdapter.play() must be implemented');
  }

  pause() {
    throw new Error('MediaAdapter.pause() must be implemented');
  }

  // eslint-disable-next-line no-unused-vars
  seekTo(seconds) {
    throw new Error('MediaAdapter.seekTo() must be implemented');
  }

  // eslint-disable-next-line no-unused-vars
  setPlaybackRate(rate) {
    throw new Error('MediaAdapter.setPlaybackRate() must be implemented');
  }

  getCurrentTime() {
    return 0;
  }

  getDuration() {
    return 0;
  }

  destroy() {
    this.destroyed = true;
  }
}
