import { checkSidecarHealth, extractViaSidecar } from './sidecarClient.js';
import { getExternalUrl } from './sourceDetector.js';
import { saveMediaFile, extractMediaInfo, deleteMediaFile } from '../storage/mediaDB.js';

/**
 * Client-orchestrated sequential offline playlist downloader.
 * Downloads eligible YouTube lectures one at a time via the Home Sidecar,
 * saving each Blob immediately to StudyMediaDB (IndexedDB) so completed items
 * are preserved on pause, cancel, or signal loss and skipped on resume.
 */
export class SequentialPlaylistDownloader {
  constructor() {
    this.abortController = null;
    this.paused = false;
    this.running = false;
    this._resumeResolver = null;
  }

  isRunning() {
    return this.running;
  }

  isPaused() {
    return this.paused;
  }

  pause() {
    if (!this.running) return;
    this.paused = true;
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this._resumeResolver) {
      const resolve = this._resumeResolver;
      this._resumeResolver = null;
      resolve();
    }
  }

  cancel() {
    this.paused = false;
    if (this._resumeResolver) {
      const resolve = this._resumeResolver;
      this._resumeResolver = null;
      resolve();
    }
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  async _waitIfPaused(signal) {
    while (this.paused && !signal.aborted) {
      await new Promise((resolve) => {
        this._resumeResolver = resolve;
      });
    }
  }

  /**
   * Run pre-flight sidecar health check and sequentially download eligible YouTube items.
   */
  async start({
    playlistId,
    items,
    format = 'mp4',
    sidecarUrl,
    sidecarApiKey,
    onPreflightFailed,
    onStateUpdate,
    onItemComplete,
    onItemError,
  }) {
    if (this.running) return { started: false, reason: 'already_running' };

    const pendingItems = (items || []).filter(
      (item) => item.sourceType === 'youtube' && !item.isOfflineReady && !String(item.id).startsWith('playlist:')
    );

    if (pendingItems.length === 0) {
      return { started: false, reason: 'nothing_to_download', completed: 0, failed: 0, total: 0 };
    }

    // Step 1: Pre-flight health check (strict 1.5s timeout)
    const health = await checkSidecarHealth(sidecarUrl, sidecarApiKey, 1500);
    if (!health.ok) {
      const msg =
        health.status === 'unauthorized'
          ? 'Home Sidecar rejected API key — check Settings'
          : 'Home Sidecar is offline — connect Tailscale or start your PC sidecar';
      onPreflightFailed?.(msg, health);
      return { started: false, reason: 'sidecar_offline', message: msg };
    }

    this.running = true;
    this.paused = false;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const total = pendingItems.length;
    let completed = 0;
    let failed = 0;

    let wasCancelled = false;
    try {
      for (let idx = 0; idx < pendingItems.length; idx++) {
        await this._waitIfPaused(signal);
        if (signal.aborted) break;

        const item = pendingItems[idx];
        const url = getExternalUrl(item);

        onStateUpdate?.({
          playlistId,
          status: this.paused ? 'paused' : 'downloading',
          currentIndex: idx + 1,
          total,
          completed,
          failed,
          activeItemId: item.id,
          activeItemTitle: item.title,
          itemPct: 0,
          phase: 'extracting',
          format,
        });

        if (!url) {
          failed += 1;
          onItemError?.(item, 'Missing valid YouTube URL');
          continue;
        }

        try {
          const result = await extractViaSidecar({
            baseUrl: sidecarUrl,
            apiKey: sidecarApiKey,
            url,
            format,
            signal,
            onProgress: (prog) => {
              onStateUpdate?.({
                playlistId,
                status: this.paused ? 'paused' : 'downloading',
                currentIndex: idx + 1,
                total,
                completed,
                failed,
                activeItemId: item.id,
                activeItemTitle: item.title,
                itemPct: prog?.pct ?? null,
                receivedBytes: prog?.receivedBytes || 0,
                phase: prog?.phase || 'Downloading...',
                speed: prog?.speed || null,
                eta: prog?.eta || null,
                format,
              });
            },
          });

          if (signal.aborted) break;

          const fileLike = new File([result.blob], result.fileName, { type: result.mimeType });
          const info = await extractMediaInfo(fileLike, 5);
          const blobId = `local-upgrade:${item.id}:${Date.now()}`;

          if (item.localBlobId) {
            await deleteMediaFile(item.localBlobId).catch(() => {});
          }

          await saveMediaFile({
            id: blobId,
            fileName: result.fileName,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
            blob: result.blob,
            thumbnailDataUrl: item.thumbnail || info.thumbnailDataUrl || null,
            duration: info.duration > 0 ? info.duration : item.duration || 0,
          });

          completed += 1;

          onItemComplete?.(item, {
            sourceType: 'local',
            localBlobId: blobId,
            isOfflineReady: true,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
            thumbnail: item.thumbnail || info.thumbnailDataUrl || null,
            duration: info.duration > 0 ? info.duration : item.duration || 0,
            downloadError: null,
          });

          onStateUpdate?.({
            playlistId,
            status: this.paused ? 'paused' : 'downloading',
            currentIndex: idx + 1,
            total,
            completed,
            failed,
            activeItemId: item.id,
            activeItemTitle: item.title,
            itemPct: 100,
            phase: 'saved',
            format,
          });
        } catch (err) {
          if (signal.aborted || err?.name === 'AbortError') {
            break;
          }
          failed += 1;
          onItemError?.(item, err?.message || 'Sidecar extraction failed');
          // Continue sequentially to the next item without aborting the playlist
        }
      }
    } finally {
      wasCancelled = signal.aborted;
      this.running = false;
      this.paused = false;
      this.abortController = null;
      this._resumeResolver = null;

      onStateUpdate?.(null);
    }

    return {
      started: true,
      cancelled: wasCancelled,
      completed,
      failed,
      total,
    };
  }
}
