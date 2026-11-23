import { MediaAdapter } from './MediaAdapter';
import { getMediaFile } from '../storage/mediaDB';
import { isAudioItem } from '../utils/sourceDetector';
import { getR2StreamUrl } from '../utils/r2Client';

export class HTML5Adapter extends MediaAdapter {
  constructor(container, callbacks) {
    super(container, callbacks);
    this.mediaEl = null;
    this.objectUrl = null;
    this.pendingRate = 1;
    this.initialSeekDone = false;
    this._listeners = [];
  }

  _revokeObjectUrl() {
    if (this.objectUrl) {
      try {
        URL.revokeObjectURL(this.objectUrl);
      } catch {
        // ignore
      }
      this.objectUrl = null;
    }
  }

  _bind(el, event, handler) {
    el.addEventListener(event, handler);
    this._listeners.push([el, event, handler]);
  }

  async load(source, startTime = 0, playbackRate = 1) {
    this.pendingRate = playbackRate || 1;
    this.initialSeekDone = false;
    this._revokeObjectUrl();

    if (!this.container || this.destroyed) return;

    let srcUrl = null;
    let isAudio = isAudioItem(source);

    // Priority 1: Local IndexedDB Blob (0 R2 / network requests!)
    if (source.localBlobId || (source.sourceType === 'local' && !source.r2Key)) {
      try {
        const record = await getMediaFile(source.localBlobId || source.id);
        if (this.destroyed) return;

        if (record && record.blob) {
          if (record.mimeType && record.mimeType.toLowerCase().startsWith('audio/')) {
            isAudio = true;
          }
          this.objectUrl = URL.createObjectURL(record.blob);
          srcUrl = this.objectUrl;
        } else if (!source.r2Key) {
          this.callbacks.onError({
            code: 'LOCAL_FILE_MISSING',
            message: 'This local media file is no longer in offline storage. Re-import the file to play it.',
            recoverable: true,
          });
          return;
        }
      } catch {
        if (!source.r2Key) {
          if (!this.destroyed) {
            this.callbacks.onError({
              code: 'LOCAL_DB_ERROR',
              message: 'Failed to read local media from IndexedDB storage.',
              recoverable: true,
            });
          }
          return;
        }
      }
    }

    // Priority 2: Cloudflare R2 Cloud Vault via fresh 4-hour Presigned GET URL
    if (!srcUrl && source.r2Key) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        this.callbacks.onError({
          code: 'OFFLINE_UNAVAILABLE',
          message: 'Internet connection required to stream from Cloud Vault. Use "Save Offline" while online for Airplane Mode.',
          recoverable: true,
        });
        return;
      }
      try {
        srcUrl = await getR2StreamUrl(source.r2Key);
        if (this.destroyed) return;
      } catch (err) {
        if (!this.destroyed) {
          this.callbacks.onError({
            code: 'R2_STREAM_ERROR',
            message: err?.message || 'Failed to load Cloud Vault stream URL.',
            recoverable: true,
          });
        }
        return;
      }
    }

    // Priority 3: Direct media URL
    if (!srcUrl && source.sourceUrl) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        this.callbacks.onError({
          code: 'OFFLINE_UNAVAILABLE',
          message: 'Internet connection required to stream direct media URLs.',
          recoverable: true,
        });
        return;
      }
      srcUrl = source.sourceUrl;
    }

    if (!srcUrl) {
      this.callbacks.onError({
        code: 'INVALID_SOURCE',
        message: 'No valid media URL, Cloud Vault key, or local file found for this item.',
        recoverable: false,
      });
      return;
    }

    if (this.destroyed || !this.container) {
      this._revokeObjectUrl();
      return;
    }

    this.container.innerHTML = '';

    const mediaEl = document.createElement(isAudio ? 'audio' : 'video');
    mediaEl.preload = 'metadata';
    mediaEl.controls = false;
    mediaEl.playsInline = true;
    mediaEl.setAttribute('playsinline', 'true');
    mediaEl.setAttribute('webkit-playsinline', 'true');

    if (isAudio) {
      mediaEl.className = 'hidden';
      const wrapper = document.createElement('div');
      wrapper.className =
        'flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-6 text-center';
      wrapper.innerHTML = `
        <div class="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 ring-1 ring-amber-500/40">
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>
          </svg>
        </div>
        <p class="max-w-md truncate text-sm font-semibold text-zinc-100"></p>
        <p class="mt-1 text-xs text-zinc-500">Native HTML5 Audio • Offline & Lock-Screen Ready</p>
      `;
      const titleNode = wrapper.querySelector('p');
      if (titleNode) titleNode.textContent = source.title || 'Local Audio Lecture';
      wrapper.appendChild(mediaEl);
      this.container.appendChild(wrapper);
    } else {
      mediaEl.className = 'h-full w-full bg-black object-contain';
      this.container.appendChild(mediaEl);
    }

    this.mediaEl = mediaEl;

    this._bind(mediaEl, 'loadedmetadata', () => {
      if (this.destroyed) return;
      const dur = this.getDuration();
      mediaEl.playbackRate = this.pendingRate;

      if (startTime > 2 && (!dur || startTime < dur - 5) && !this.initialSeekDone) {
        this.initialSeekDone = true;
        try {
          mediaEl.currentTime = startTime;
        } catch {
          // ignore
        }
      }

      this.callbacks.onReady();
      this.callbacks.onTimeUpdate(this.getCurrentTime(), dur);

      // Attempt autoplay; ignore browser gesture blocks gracefully
      mediaEl.play().catch(() => {
        if (!this.destroyed) {
          this.callbacks.onStateChange('paused');
        }
      });
    });

    this._bind(mediaEl, 'play', () => {
      if (!this.destroyed) this.callbacks.onStateChange('playing');
    });

    this._bind(mediaEl, 'playing', () => {
      if (!this.destroyed) this.callbacks.onStateChange('playing');
    });

    this._bind(mediaEl, 'pause', () => {
      if (!this.destroyed && !mediaEl.ended) this.callbacks.onStateChange('paused');
    });

    this._bind(mediaEl, 'waiting', () => {
      if (!this.destroyed) this.callbacks.onStateChange('buffering');
    });

    this._bind(mediaEl, 'ended', () => {
      if (!this.destroyed) {
        this.callbacks.onStateChange('ended');
        this.callbacks.onTimeUpdate(this.getCurrentTime(), this.getDuration());
      }
    });

    this._bind(mediaEl, 'timeupdate', () => {
      if (!this.destroyed) {
        this.callbacks.onTimeUpdate(this.getCurrentTime(), this.getDuration());
      }
    });

    this._bind(mediaEl, 'error', () => {
      if (this.destroyed) return;
      const code = mediaEl.error?.code;
      const messageMap = {
        1: 'Media playback was aborted.',
        2: 'A network error interrupted media loading.',
        3: 'Media file could not be decoded by this browser.',
        4: 'Unsupported media format or inaccessible URL.',
      };
      this.callbacks.onStateChange('paused');
      this.callbacks.onError({
        code: 'HTML5_MEDIA_ERROR',
        message: messageMap[code] || 'Failed to play this media file.',
        recoverable: true,
      });
    });

    mediaEl.src = srcUrl;
    mediaEl.load();
  }

  play() {
    if (!this.mediaEl) return;
    this.mediaEl.play().catch(() => {});
  }

  pause() {
    if (!this.mediaEl) return;
    try {
      this.mediaEl.pause();
    } catch {
      // ignore
    }
  }

  seekTo(seconds) {
    if (!this.mediaEl) return;
    const dur = this.getDuration();
    const target = Math.max(0, dur > 0 ? Math.min(dur - 0.25, seconds) : seconds);
    try {
      this.mediaEl.currentTime = target;
      this.callbacks.onTimeUpdate(target, dur);
    } catch {
      // ignore
    }
  }

  setPlaybackRate(rate) {
    this.pendingRate = rate;
    if (this.mediaEl) {
      try {
        this.mediaEl.playbackRate = rate;
      } catch {
        // ignore
      }
    }
  }

  getCurrentTime() {
    const t = this.mediaEl?.currentTime;
    return Number.isFinite(t) ? t : 0;
  }

  getDuration() {
    const d = this.mediaEl?.duration;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  destroy() {
    this.destroyed = true;
    for (const [el, evt, fn] of this._listeners) {
      try {
        el.removeEventListener(evt, fn);
      } catch {
        // ignore
      }
    }
    this._listeners = [];

    if (this.mediaEl) {
      try {
        this.mediaEl.pause();
        this.mediaEl.removeAttribute('src');
        this.mediaEl.load();
      } catch {
        // ignore
      }
      this.mediaEl = null;
    }

    this._revokeObjectUrl();

    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}
