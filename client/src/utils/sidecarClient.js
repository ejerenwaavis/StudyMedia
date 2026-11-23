/**
 * Client for the optional self-hosted StudyMedia Sidecar Server (yt-dlp + ffmpeg)
 * and configurable Tier 2 external downloader fallback.
 */

export const DEFAULT_FALLBACK_CONVERTER_URL = 'https://ytmp3.gl/';
export const SIDECAR_STORAGE_KEY = 'studymedia_sidecar_v1';

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/+$/, '');
}

/**
 * Load persisted sidecar & fallback converter config from localStorage.
 */
export function loadSidecarConfig() {
  try {
    const raw = localStorage.getItem(SIDECAR_STORAGE_KEY);
    if (!raw) {
      return {
        sidecarUrl: '',
        sidecarApiKey: '',
        fallbackConverterUrl: DEFAULT_FALLBACK_CONVERTER_URL,
      };
    }
    const parsed = JSON.parse(raw);
    return {
      sidecarUrl: parsed?.sidecarUrl ?? parsed?.url ?? '',
      sidecarApiKey: parsed?.sidecarApiKey ?? parsed?.apiKey ?? '',
      fallbackConverterUrl:
        parsed?.fallbackConverterUrl?.trim() || DEFAULT_FALLBACK_CONVERTER_URL,
    };
  } catch {
    return {
      sidecarUrl: '',
      sidecarApiKey: '',
      fallbackConverterUrl: DEFAULT_FALLBACK_CONVERTER_URL,
    };
  }
}

/**
 * Persist sidecar & fallback converter config to localStorage.
 */
export function saveSidecarConfig({ sidecarUrl, sidecarApiKey, fallbackConverterUrl }) {
  try {
    localStorage.setItem(
      SIDECAR_STORAGE_KEY,
      JSON.stringify({
        sidecarUrl: (sidecarUrl || '').trim(),
        sidecarApiKey: (sidecarApiKey || '').trim(),
        fallbackConverterUrl:
          (fallbackConverterUrl || '').trim() || DEFAULT_FALLBACK_CONVERTER_URL,
      })
    );
  } catch {
    // ignore storage quota errors
  }
}

/**
 * Resolve fallback converter URL, substituting optional {url} or {id} template tokens.
 */
export function buildConverterUrl(templateUrl, videoUrl = '', videoId = '') {
  const base = (templateUrl || '').trim() || DEFAULT_FALLBACK_CONVERTER_URL;
  let resolved = base;
  if (resolved.includes('{url}')) {
    resolved = resolved.replace(/\{url\}/g, encodeURIComponent(videoUrl || ''));
  }
  if (resolved.includes('{id}')) {
    resolved = resolved.replace(/\{id\}/g, encodeURIComponent(videoId || ''));
  }
  return resolved;
}

function buildAuthHeaders(apiKey, extra = {}) {
  const saved = !apiKey ? loadSidecarConfig().sidecarApiKey : apiKey;
  const trimmedKey = (saved || '').trim();
  const headers = { ...extra };
  if (trimmedKey) {
    headers['x-api-key'] = trimmedKey;
  }
  return headers;
}

/**
 * Tier 1 Health Check with strict 1500ms AbortController timeout so the UI
 * never hangs when the home desktop is asleep or unreachable.
 */
export async function checkSidecarHealth(sidecarUrl, apiKey, timeoutMs = 1500) {
  const stored = loadSidecarConfig();
  const cleanUrl = normalizeBaseUrl(sidecarUrl !== undefined ? sidecarUrl : stored.sidecarUrl);
  const resolvedKey = (apiKey !== undefined ? apiKey : stored.sidecarApiKey || '').trim();

  if (!cleanUrl) {
    return { ok: false, status: 'unconfigured', error: 'Sidecar URL is not configured' };
  }
  if (!resolvedKey) {
    return { ok: false, status: 'unauthorized', error: 'API key is required' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${cleanUrl}/health`, {
      method: 'GET',
      headers: buildAuthHeaders(resolvedKey),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 'unauthorized', error: 'Invalid API key (401 Unauthorized)' };
    }
    if (!res.ok) {
      return { ok: false, status: 'offline', error: `Sidecar responded with HTTP ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    if (data?.status === 'ok') {
      return { ok: true, status: 'online', data };
    }
    return { ok: false, status: 'offline', error: 'Unexpected health response' };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return {
        ok: false,
        status: 'offline',
        error: `Home Sidecar offline (timed out after ${timeoutMs}ms)`,
      };
    }
    return {
      ok: false,
      status: 'offline',
      error: err.message || 'Home Sidecar unreachable',
    };
  }
}

function sleepWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Extraction cancelled');
      err.name = 'AbortError';
      return reject(err);
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error('Extraction cancelled');
      err.name = 'AbortError';
      reject(err);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function readErrorMessage(res, fallback) {
  try {
    const errData = await res.json();
    if (errData?.error) return errData.error;
  } catch {
    // ignore non-JSON error
  }
  return fallback;
}

/**
 * Request async media extraction (MP4 or MP3) from the sidecar server:
 * 1) POST /extract/start -> { jobId } (HTTP 202)
 * 2) Poll GET /extract/status/:jobId every 1000ms for live yt-dlp progress
 * 3) Stream GET /extract/download/:jobId into a Blob with live transfer progress
 */
export async function extractViaSidecar({
  baseUrl,
  apiKey,
  url,
  format = 'mp4',
  signal,
  onProgress,
}) {
  const stored = loadSidecarConfig();
  const cleanUrl = normalizeBaseUrl(baseUrl !== undefined ? baseUrl : stored.sidecarUrl);
  const resolvedKey = (apiKey !== undefined ? apiKey : stored.sidecarApiKey || '').trim();

  if (!cleanUrl || !resolvedKey) {
    throw new Error('Home Sidecar URL and API key must be configured in Settings.');
  }

  onProgress?.({
    phase: 'Starting yt-dlp...',
    state: 'queued',
    percent: 0,
    pct: null,
    speed: null,
    eta: null,
    receivedBytes: 0,
    totalBytes: 0,
  });

  // Step 1: Start async extraction job
  const startRes = await fetch(`${cleanUrl}/extract/start`, {
    method: 'POST',
    headers: buildAuthHeaders(resolvedKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, format }),
    signal,
  });

  if (startRes.status === 401 || startRes.status === 403) {
    throw new Error('Sidecar rejected API key (401 Unauthorized). Check Settings.');
  }

  if (!startRes.ok) {
    throw new Error(
      await readErrorMessage(startRes, `Failed to start extraction (HTTP ${startRes.status})`)
    );
  }

  const startData = await startRes.json().catch(() => ({}));
  const jobId = startData?.jobId;
  if (!jobId) {
    throw new Error('Sidecar did not return a jobId. Restart your local sidecar.');
  }

  const cancelJobBestEffort = () => {
    fetch(`${cleanUrl}/extract/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: buildAuthHeaders(resolvedKey),
      keepalive: true,
    }).catch(() => {});
  };

  // Step 2: Poll job status every 1000ms until 'ready' or 'error'
  let transientFailures = 0;
  let readyFileSize = 0;

  while (true) {
    try {
      await sleepWithAbort(1000, signal);
    } catch (err) {
      cancelJobBestEffort();
      throw err;
    }

    let statusRes;
    try {
      const pollController = new AbortController();
      const pollTimeout = setTimeout(() => pollController.abort(), 10_000);
      const onParentAbort = () => pollController.abort();
      signal?.addEventListener('abort', onParentAbort, { once: true });

      try {
        statusRes = await fetch(`${cleanUrl}/extract/status/${encodeURIComponent(jobId)}`, {
          method: 'GET',
          headers: buildAuthHeaders(resolvedKey),
          signal: pollController.signal,
        });
      } finally {
        clearTimeout(pollTimeout);
        signal?.removeEventListener('abort', onParentAbort);
      }
    } catch (err) {
      if (signal?.aborted) {
        cancelJobBestEffort();
        const abortErr = new Error('Extraction cancelled');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      transientFailures += 1;
      if (transientFailures >= 4) {
        throw new Error('Lost connection to Home Sidecar while polling extraction status.');
      }
      continue;
    }

    if (statusRes.status === 401 || statusRes.status === 403) {
      throw new Error('Sidecar rejected API key (401 Unauthorized). Check Settings.');
    }

    if (statusRes.status === 404) {
      throw new Error('Extraction job expired or was cleared on Home Sidecar. Please retry.');
    }

    if (!statusRes.ok) {
      transientFailures += 1;
      if (transientFailures >= 4) {
        throw new Error(
          await readErrorMessage(statusRes, `Sidecar status error (HTTP ${statusRes.status})`)
        );
      }
      continue;
    }

    transientFailures = 0;
    const status = await statusRes.json().catch(() => ({}));

    if (status.state === 'error') {
      throw new Error(status.error || 'Sidecar extraction failed.');
    }

    if (status.state === 'cancelled') {
      const abortErr = new Error('Extraction cancelled');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const numericPct =
      typeof status.percent === 'number' && Number.isFinite(status.percent)
        ? Math.min(100, Math.max(0, status.percent))
        : null;

    onProgress?.({
      phase: status.phase || 'Extracting on Home Sidecar...',
      state: status.state || 'downloading',
      percent: numericPct,
      pct: numericPct != null ? Math.round(numericPct) : null,
      speed: status.speed || null,
      eta: status.eta || null,
      receivedBytes: 0,
      totalBytes: status.fileSize || 0,
    });

    if (status.state === 'ready') {
      readyFileSize = status.fileSize || 0;
      break;
    }
  }

  // Step 3: Stream finished file into Blob with live device-save progress
  onProgress?.({
    phase: 'Saving to device...',
    state: 'saving',
    percent: 0,
    pct: 0,
    speed: null,
    eta: null,
    receivedBytes: 0,
    totalBytes: readyFileSize,
  });

  const dlRes = await fetch(`${cleanUrl}/extract/download/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    headers: buildAuthHeaders(resolvedKey),
    signal,
  });

  if (dlRes.status === 401 || dlRes.status === 403) {
    throw new Error('Sidecar rejected API key (401 Unauthorized). Check Settings.');
  }

  if (!dlRes.ok) {
    throw new Error(
      await readErrorMessage(dlRes, `Failed to download extracted file (HTTP ${dlRes.status})`)
    );
  }

  const mimeType =
    dlRes.headers.get('content-type') || (format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
  const totalBytes = Number(dlRes.headers.get('content-length')) || readyFileSize || 0;
  const ext = format === 'mp3' ? 'mp3' : 'mp4';

  let blob;
  if (dlRes.body && typeof dlRes.body.getReader === 'function') {
    const reader = dlRes.body.getReader();
    const chunks = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        receivedBytes += value.byteLength;
        const pct = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null;
        onProgress?.({
          phase: 'Saving to device...',
          state: 'saving',
          percent: pct,
          pct,
          speed: null,
          eta: null,
          receivedBytes,
          totalBytes,
        });
      }
    }
    blob = new Blob(chunks, { type: mimeType });
  } else {
    blob = await dlRes.blob();
  }

  return {
    blob,
    mimeType,
    sizeBytes: blob.size,
    fileName: `studymedia-${Date.now()}.${ext}`,
  };
}
