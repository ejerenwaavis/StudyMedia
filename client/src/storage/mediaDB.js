import { openDB } from 'idb';

const DB_NAME = 'StudyMediaDB';
const DB_VERSION = 1;
const STORE_NAME = 'mediaFiles';

let dbPromise = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Save a media Blob/File record into StudyMediaDB -> mediaFiles.
 * Record shape: { id, fileName, mimeType, sizeBytes, blob, thumbnailDataUrl, duration, createdAt }
 */
export async function saveMediaFile({
  id,
  fileName,
  mimeType,
  sizeBytes,
  blob,
  thumbnailDataUrl = null,
  duration = 0,
  createdAt = new Date().toISOString(),
}) {
  const db = await getDB();
  const record = {
    id,
    fileName: fileName || 'local-media',
    mimeType: mimeType || blob?.type || 'video/mp4',
    sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : blob?.size || 0,
    blob,
    thumbnailDataUrl,
    duration: Number.isFinite(duration) ? duration : 0,
    createdAt,
  };
  await db.put(STORE_NAME, record);
  return record;
}

/**
 * Retrieve a stored media record (including its Blob) by id.
 */
export async function getMediaFile(id) {
  if (!id) return null;
  const db = await getDB();
  return (await db.get(STORE_NAME, id)) || null;
}

/**
 * Check if a blob record exists in IndexedDB without loading all records.
 */
export async function hasMediaFile(id) {
  if (!id) return false;
  const db = await getDB();
  const key = await db.getKey(STORE_NAME, id);
  return Boolean(key);
}

/**
 * Delete a single local media blob from IndexedDB.
 */
export async function deleteMediaFile(id) {
  if (!id) return;
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

/**
 * Clear all locally stored media blobs from IndexedDB.
 */
export async function clearAllMediaFiles() {
  const db = await getDB();
  await db.clear(STORE_NAME);
}

/**
 * List metadata of all stored media files without retaining full Blob references in the returned array.
 */
export async function listMediaFilesMetadata() {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const results = [];
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const { id, fileName, mimeType, sizeBytes, thumbnailDataUrl, duration, createdAt } = cursor.value;
    results.push({ id, fileName, mimeType, sizeBytes, thumbnailDataUrl, duration, createdAt });
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
}

/**
 * Format bytes into human-readable string (e.g. "1.2 GB", "420 MB").
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * Query browser storage quota and calculate StudyMedia offline media usage.
 */
export async function getStorageEstimate() {
  let usage = 0;
  let quota = 0;
  let supported = false;

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      usage = estimate.usage || 0;
      quota = estimate.quota || 0;
      supported = true;
    } catch {
      supported = false;
    }
  }

  let localFilesCount = 0;
  let localFilesBytes = 0;
  try {
    const files = await listMediaFilesMetadata();
    localFilesCount = files.length;
    localFilesBytes = files.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  } catch {
    // Ignore IDB read issues
  }

  const effectiveUsage = Math.max(usage, localFilesBytes);
  const pct = quota > 0 ? Math.min(100, (effectiveUsage / quota) * 100) : 0;

  return {
    supported,
    usage: effectiveUsage,
    quota,
    pct,
    localFilesCount,
    localFilesBytes,
    formattedUsage: formatBytes(effectiveUsage),
    formattedQuota: quota > 0 ? formatBytes(quota) : 'Unknown',
    formattedLocalBytes: formatBytes(localFilesBytes),
    summaryText:
      quota > 0
        ? `${formatBytes(effectiveUsage)} used of ${formatBytes(quota)} available`
        : `${formatBytes(localFilesBytes)} stored locally`,
  };
}

/**
 * Extract duration and a thumbnail data URL (~5s mark) from a local video/audio File or Blob
 * using an offscreen <video>/<audio> + <canvas> element.
 */
export function extractMediaInfo(fileOrBlob, seekSeconds = 5) {
  return new Promise((resolve) => {
    const mime = (fileOrBlob?.type || '').toLowerCase();
    const name = (fileOrBlob?.name || '').toLowerCase();
    const isAudio =
      mime.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|aac|flac|opus)$/i.test(name);

    const objectUrl = URL.createObjectURL(fileOrBlob);
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        mediaEl.pause();
        mediaEl.removeAttribute('src');
        mediaEl.load();
      } catch {
        // ignore cleanup errors
      }
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const mediaEl = document.createElement(isAudio ? 'audio' : 'video');
    mediaEl.preload = 'metadata';
    mediaEl.muted = true;
    mediaEl.playsInline = true;
    mediaEl.crossOrigin = 'anonymous';

    const timeoutId = setTimeout(() => {
      finish({
        thumbnailDataUrl: null,
        duration: Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0,
        isAudio,
      });
    }, 8000);

    mediaEl.onerror = () => {
      finish({ thumbnailDataUrl: null, duration: 0, isAudio });
    };

    mediaEl.onloadedmetadata = () => {
      const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;

      if (isAudio) {
        finish({ thumbnailDataUrl: null, duration, isAudio: true });
        return;
      }

      // Seek to ~5s (or earlier for short clips)
      const targetTime =
        duration > 0 ? Math.min(seekSeconds, Math.max(0.5, duration * 0.25)) : 0;

      if (targetTime <= 0.05) {
        captureFrame(duration);
      } else {
        try {
          mediaEl.currentTime = targetTime;
        } catch {
          captureFrame(duration);
        }
      }
    };

    const captureFrame = (duration) => {
      try {
        const vw = mediaEl.videoWidth || 480;
        const vh = mediaEl.videoHeight || 270;
        const targetWidth = Math.min(480, vw);
        const targetHeight = Math.round((vh / vw) * targetWidth) || 270;

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(mediaEl, 0, 0, targetWidth, targetHeight);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
          finish({ thumbnailDataUrl: dataUrl, duration, isAudio: false });
          return;
        }
      } catch {
        // Canvas draw failed (unsupported codec / tainted)
      }
      finish({ thumbnailDataUrl: null, duration, isAudio: false });
    };

    mediaEl.onseeked = () => {
      const duration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;
      captureFrame(duration);
    };

    mediaEl.src = objectUrl;
  });
}
