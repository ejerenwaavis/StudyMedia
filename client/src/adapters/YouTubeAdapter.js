import { MediaAdapter } from './MediaAdapter';

let ytApiPromise = null;

function loadYouTubeApi() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window unavailable'));
  }
  if (window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return Promise.reject(new Error('OFFLINE'));
  }
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prevCallback = window.onYouTubeIframeAPIReady;

    const timeout = setTimeout(() => {
      ytApiPromise = null;
      reject(new Error('YOUTUBE_API_TIMEOUT'));
    }, 10000);

    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      if (typeof prevCallback === 'function') prevCallback();
      resolve(window.YT);
    };

    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      tag.onerror = () => {
        clearTimeout(timeout);
        ytApiPromise = null;
        reject(new Error('YOUTUBE_API_LOAD_FAILED'));
      };
      document.head.appendChild(tag);
    }
  });

  return ytApiPromise;
}

export class YouTubeAdapter extends MediaAdapter {
  constructor(container, callbacks) {
    super(container, callbacks);
    this.player = null;
    this.pollTimer = null;
    this.isReady = false;
    this.pendingRate = 1;
    this.initialSeekDone = false;
  }

  async load(source, startTime = 0, playbackRate = 1) {
    this.pendingRate = playbackRate || 1;
    this.initialSeekDone = false;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.callbacks.onError({
        code: 'OFFLINE_UNAVAILABLE',
        message: 'Internet connection required to play online YouTube lectures.',
        recoverable: true,
      });
      return;
    }

    let YT;
    try {
      YT = await loadYouTubeApi();
    } catch {
      if (!this.destroyed) {
        this.callbacks.onError({
          code: 'OFFLINE_UNAVAILABLE',
          message: 'Could not reach YouTube player API. Check your internet connection or import a local copy.',
          recoverable: true,
        });
      }
      return;
    }

    if (this.destroyed || !this.container) return;

    const rawId = source.youtubeVideoId || source.videoId || source.id || '';
    const videoId = rawId.startsWith('playlist:') ? undefined : rawId;
    const playlistId = source.playlistId || null;

    const mountEl = document.createElement('div');
    this.container.innerHTML = '';
    this.container.appendChild(mountEl);

    const playerVars = {
      autoplay: 1,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      playsinline: 1,
      enablejsapi: 1,
      origin: window.location.origin,
    };

    if (!videoId && playlistId) {
      playerVars.listType = 'playlist';
      playerVars.list = playlistId;
    }

    this.player = new YT.Player(mountEl, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars,
      events: {
        onReady: (event) => {
          if (this.destroyed) return;
          const player = event.target;
          this.isReady = true;

          const dur = player.getDuration?.() || 0;
          try {
            player.setPlaybackRate(this.pendingRate);
          } catch {
            // ignore unsupported rate
          }

          if (startTime > 2 && (!dur || startTime < dur - 10) && !this.initialSeekDone) {
            this.initialSeekDone = true;
            try {
              player.seekTo(startTime, true);
            } catch {
              // ignore
            }
          }

          this.callbacks.onReady();
          this.callbacks.onTimeUpdate(this.getCurrentTime(), dur);
          this._startPolling();

          try {
            player.playVideo?.();
          } catch {
            // ignore autoplay gesture blocks
          }
        },
        onStateChange: (event) => {
          if (this.destroyed) return;
          const state = event.data;
          const cur = this.getCurrentTime();
          const dur = this.getDuration();

          const PLAYING = YT.PlayerState?.PLAYING ?? 1;
          const PAUSED = YT.PlayerState?.PAUSED ?? 2;
          const BUFFERING = YT.PlayerState?.BUFFERING ?? 3;
          const ENDED = YT.PlayerState?.ENDED ?? 0;

          if (state === PLAYING) {
            this.callbacks.onStateChange('playing');
          } else if (state === PAUSED) {
            this.callbacks.onStateChange('paused');
          } else if (state === BUFFERING) {
            this.callbacks.onStateChange('buffering');
          } else if (state === ENDED) {
            this.callbacks.onStateChange('ended');
          }

          this.callbacks.onTimeUpdate(cur, dur);
        },
        onError: (event) => {
          if (this.destroyed) return;
          const errCode = event?.data;
          if (errCode === 101 || errCode === 150) {
            this.callbacks.onStateChange('paused');
            this.callbacks.onError({
              code: 'EMBED_RESTRICTED',
              message: 'Playback on external sites is disabled by the creator.',
              recoverable: true,
              rawCode: errCode,
            });
          } else if (errCode === 100) {
            this.callbacks.onStateChange('paused');
            this.callbacks.onError({
              code: 'VIDEO_NOT_FOUND',
              message: 'This YouTube video is private or no longer available.',
              recoverable: true,
              rawCode: errCode,
            });
          } else {
            this.callbacks.onStateChange('paused');
            this.callbacks.onError({
              code: 'YOUTUBE_ERROR',
              message: `YouTube playback error (code ${errCode || 'unknown'}).`,
              recoverable: true,
              rawCode: errCode,
            });
          }
        },
      },
    });
  }

  _startPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.destroyed || !this.isReady) return;
      const cur = this.getCurrentTime();
      const dur = this.getDuration();
      this.callbacks.onTimeUpdate(cur, dur);
    }, 500);
  }

  play() {
    try {
      this.player?.playVideo?.();
    } catch {
      // ignore
    }
  }

  pause() {
    try {
      this.player?.pauseVideo?.();
    } catch {
      // ignore
    }
  }

  seekTo(seconds) {
    if (!this.player || typeof this.player.seekTo !== 'function') return;
    const dur = this.getDuration();
    const target = Math.max(0, dur > 0 ? Math.min(dur - 0.5, seconds) : seconds);
    try {
      this.player.seekTo(target, true);
      this.callbacks.onTimeUpdate(target, dur);
    } catch {
      // ignore
    }
  }

  setPlaybackRate(rate) {
    this.pendingRate = rate;
    if (this.isReady && this.player?.setPlaybackRate) {
      try {
        this.player.setPlaybackRate(rate);
      } catch {
        // ignore
      }
    }
  }

  getCurrentTime() {
    try {
      const t = this.player?.getCurrentTime?.();
      return Number.isFinite(t) ? t : 0;
    } catch {
      return 0;
    }
  }

  getDuration() {
    try {
      const d = this.player?.getDuration?.();
      return Number.isFinite(d) ? d : 0;
    } catch {
      return 0;
    }
  }

  destroy() {
    this.destroyed = true;
    this.isReady = false;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
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
