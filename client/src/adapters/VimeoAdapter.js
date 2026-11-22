import Player from '@vimeo/player';
import { MediaAdapter } from './MediaAdapter';

export class VimeoAdapter extends MediaAdapter {
  constructor(container, callbacks) {
    super(container, callbacks);
    this.player = null;
    this.pendingRate = 1;
    this._currentTime = 0;
    this._duration = 0;
  }

  async load(source, startTime = 0, playbackRate = 1) {
    this.pendingRate = playbackRate || 1;
    this._currentTime = startTime || 0;
    this._duration = source.duration || 0;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.callbacks.onError({
        code: 'OFFLINE_UNAVAILABLE',
        message: 'Internet connection required to play Vimeo lectures.',
        recoverable: true,
      });
      return;
    }

    if (this.destroyed || !this.container) return;

    const mountEl = document.createElement('div');
    mountEl.className = 'h-full w-full';
    this.container.innerHTML = '';
    this.container.appendChild(mountEl);

    const options = {
      url: source.sourceUrl || `https://vimeo.com/${(source.id || '').replace(/^vimeo:/, '')}`,
      responsive: true,
      autoplay: true,
      controls: false,
      playsinline: true,
      dnt: true,
    };

    try {
      this.player = new Player(mountEl, options);
    } catch (err) {
      this.callbacks.onError({
        code: 'VIMEO_INIT_ERROR',
        message: err?.message || 'Failed to initialize Vimeo player.',
        recoverable: true,
      });
      return;
    }

    this.player.on('loaded', async () => {
      if (this.destroyed || !this.player) return;
      try {
        const dur = await this.player.getDuration();
        if (Number.isFinite(dur)) this._duration = dur;
      } catch {
        // ignore
      }

      try {
        await this.player.setPlaybackRate(this.pendingRate);
      } catch {
        // Some Vimeo tiers restrict playback rate; ignore safely
      }

      if (startTime > 2 && (!this._duration || startTime < this._duration - 5)) {
        try {
          await this.player.setCurrentTime(startTime);
          this._currentTime = startTime;
        } catch {
          // ignore
        }
      }

      if (!this.destroyed) {
        this.callbacks.onReady();
        this.callbacks.onTimeUpdate(this._currentTime, this._duration);
      }
    });

    this.player.on('play', () => {
      if (!this.destroyed) this.callbacks.onStateChange('playing');
    });

    this.player.on('pause', () => {
      if (!this.destroyed) this.callbacks.onStateChange('paused');
    });

    this.player.on('bufferstart', () => {
      if (!this.destroyed) this.callbacks.onStateChange('buffering');
    });

    this.player.on('bufferend', () => {
      if (!this.destroyed) this.callbacks.onStateChange('playing');
    });

    this.player.on('ended', () => {
      if (!this.destroyed) {
        this.callbacks.onStateChange('ended');
        this.callbacks.onTimeUpdate(this._duration || this._currentTime, this._duration);
      }
    });

    this.player.on('timeupdate', (data) => {
      if (this.destroyed) return;
      if (Number.isFinite(data?.seconds)) this._currentTime = data.seconds;
      if (Number.isFinite(data?.duration)) this._duration = data.duration;
      this.callbacks.onTimeUpdate(this._currentTime, this._duration);
    });

    this.player.on('error', (err) => {
      if (this.destroyed) return;
      this.callbacks.onStateChange('paused');
      const isPrivacy = err?.name === 'PrivacyError' || err?.name === 'PasswordError';
      this.callbacks.onError({
        code: isPrivacy ? 'EMBED_RESTRICTED' : 'VIMEO_ERROR',
        message: isPrivacy
          ? 'This Vimeo video restricts embedding on external websites.'
          : err?.message || 'Vimeo playback error occurred.',
        recoverable: true,
      });
    });

    // Ensure embedded Vimeo iframe stretches to full stage height
    this.player.ready().then(() => {
      if (this.destroyed || !this.container) return;
      const iframe = this.container.querySelector('iframe');
      if (iframe) {
        iframe.style.width = '100%';
        iframe.style.height = '100%';
      }
    }).catch(() => {});
  }

  play() {
    this.player?.play?.().catch(() => {});
  }

  pause() {
    this.player?.pause?.().catch(() => {});
  }

  seekTo(seconds) {
    if (!this.player) return;
    const target = Math.max(0, this._duration > 0 ? Math.min(this._duration - 0.5, seconds) : seconds);
    this._currentTime = target;
    this.player.setCurrentTime(target).catch(() => {});
    this.callbacks.onTimeUpdate(target, this._duration);
  }

  setPlaybackRate(rate) {
    this.pendingRate = rate;
    this.player?.setPlaybackRate?.(rate).catch(() => {});
  }

  getCurrentTime() {
    return this._currentTime;
  }

  getDuration() {
    return this._duration;
  }

  destroy() {
    this.destroyed = true;
    if (this.player) {
      try {
        this.player.destroy();
      } catch {
        // ignore
      }
      this.player = null;
    }
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
