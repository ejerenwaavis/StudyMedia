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

/**
 * Request media extraction (MP4 or MP3) from the sidecar server and stream
 * the resulting Blob with optional progress callbacks.
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

  onProgress?.({ phase: 'extracting', receivedBytes: 0, totalBytes: 0, pct: null });

  const res = await fetch(`${cleanUrl}/extract`, {
    method: 'POST',
    headers: buildAuthHeaders(resolvedKey, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, format }),
    signal,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Sidecar rejected API key (401 Unauthorized). Check Settings.');
  }

  if (!res.ok) {
    let errMsg = `Extraction failed (HTTP ${res.status})`;
    try {
      const errData = await res.json();
      if (errData?.error) errMsg = errData.error;
    } catch {
      // ignore non-JSON error
    }
    throw new Error(errMsg);
  }

  const mimeType =
    res.headers.get('content-type') || (format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  const ext = format === 'mp3' ? 'mp3' : 'mp4';

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
          phase: 'downloading',
          receivedBytes,
          totalBytes,
          pct: totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : null,
        });
      }
    }
    blob = new Blob(chunks, { type: mimeType });
  } else {
    blob = await res.blob();
  }

  return {
    blob,
    mimeType,
    sizeBytes: blob.size,
    fileName: `studymedia-${Date.now()}.${ext}`,
  };
}
