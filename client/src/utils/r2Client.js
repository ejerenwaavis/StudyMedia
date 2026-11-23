import { authFetch } from './authClient.js';
import { getMediaFile, saveMediaFile, extractMediaInfo, deleteMediaFile } from '../storage/mediaDB.js';

/**
 * Upload an IndexedDB Blob directly to Cloudflare R2 using a 15-minute Presigned PUT URL.
 * Uses XMLHttpRequest for live upload percentage tracking.
 */
export async function uploadLocalItemToR2({ item, onProgress }) {
  const blobId = item.localBlobId || item.id;
  const record = await getMediaFile(blobId);
  if (!record || !record.blob) {
    throw new Error('Local media file not found in IndexedDB.');
  }

  const contentType = record.mimeType || item.mimeType || record.blob.type || 'video/mp4';
  const fileName = record.fileName || `${item.title || 'lecture'}.mp4`;

  // Step 1: Request Presigned PUT URL from StudyMedia API
  const presignRes = await authFetch('/api/r2/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName,
      contentType,
      sizeBytes: record.blob.size,
    }),
  });

  const presignData = await presignRes.json().catch(() => ({}));
  if (!presignRes.ok || !presignData.uploadUrl || !presignData.r2Key) {
    throw new Error(presignData.error || `Failed to obtain R2 upload URL (HTTP ${presignRes.status})`);
  }

  // Step 2: PUT Blob directly from browser -> Cloudflare R2
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignData.uploadUrl, true);
    xhr.setRequestHeader('Content-Type', contentType);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
        onProgress?.({ loaded: evt.loaded, total: evt.total, pct });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: record.blob.size, total: record.blob.size, pct: 100 });
        resolve();
      } else {
        reject(new Error(`Cloudflare R2 upload failed (HTTP ${xhr.status}). Check R2 CORS policy.`));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network/CORS error while uploading to Cloudflare R2.'));
    };

    xhr.send(record.blob);
  });

  return {
    r2Key: presignData.r2Key,
    mimeType: contentType,
    sizeBytes: record.blob.size,
  };
}

/**
 * Fetch a 4-hour Presigned GET URL for streaming or downloading an R2 Cloud Vault object.
 */
export async function getR2StreamUrl(r2Key) {
  const res = await authFetch(`/api/r2/stream-url?key=${encodeURIComponent(r2Key)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.streamUrl) {
    throw new Error(data.error || `Failed to obtain R2 stream URL (HTTP ${res.status})`);
  }
  return data.streamUrl;
}

/**
 * Download an R2 Cloud Vault lecture via Presigned GET URL straight into IndexedDB
 * so all future plays & seeks run locally with 0 R2 requests.
 */
export async function downloadR2ItemOffline({ item, onProgress }) {
  if (!item?.r2Key) {
    throw new Error('This item does not have a Cloud Vault key.');
  }

  const streamUrl = await getR2StreamUrl(item.r2Key);
  const res = await fetch(streamUrl);
  if (!res.ok) {
    throw new Error(`Cloud Vault download failed (HTTP ${res.status})`);
  }

  const contentType = res.headers.get('content-type') || item.mimeType || 'video/mp4';
  const totalBytes = Number(res.headers.get('content-length')) || item.sizeBytes || 0;

  let blob;
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        onProgress?.({
          loaded: receivedBytes,
          total: totalBytes,
          pct: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null,
        });
      }
    }
    blob = new Blob(chunks, { type: contentType });
  } else {
    blob = await res.blob();
  }

  const fileName = item.r2Key.split('/').pop() || `${item.title || 'lecture'}.mp4`;
  const fileLike = new File([blob], fileName, { type: contentType });
  const info = await extractMediaInfo(fileLike, 5);
  const blobId = `r2-offline:${item.id}:${Date.now()}`;

  if (item.localBlobId) {
    await deleteMediaFile(item.localBlobId).catch(() => {});
  }

  await saveMediaFile({
    id: blobId,
    fileName,
    mimeType: contentType,
    sizeBytes: blob.size,
    blob,
    thumbnailDataUrl: item.thumbnail || info.thumbnailDataUrl || null,
    duration: info.duration > 0 ? info.duration : item.duration || 0,
  });

  return {
    localBlobId: blobId,
    isOfflineReady: true,
    mimeType: contentType,
    sizeBytes: blob.size,
    thumbnail: item.thumbnail || info.thumbnailDataUrl || null,
    duration: info.duration > 0 ? info.duration : item.duration || 0,
  };
}

/**
 * Delete an object from Cloudflare R2 to free bucket storage.
 */
export async function deleteR2CloudObject(r2Key) {
  const res = await authFetch(`/api/r2/object?key=${encodeURIComponent(r2Key)}`, {
    method: 'DELETE',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Failed to delete R2 file (HTTP ${res.status})`);
  }
  return data;
}
