/**
 * Parse any YouTube URL or raw video ID into { videoId, playlistId }.
 * Supports:
 * - youtube.com/watch?v=ID
 * - youtu.be/ID
 * - youtube.com/live/ID
 * - youtube.com/shorts/ID
 * - youtube.com/embed/ID
 * - list=PLAYLIST_ID (with or without videoId)
 */
export function parseYouTubeUrl(input) {
  if (!input || typeof input !== 'string') return { videoId: null, playlistId: null };
  const trimmed = input.trim();

  // Raw 11-char YouTube ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return { videoId: trimmed, playlistId: null };
  }

  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return { videoId: null, playlistId: null };
  }

  const host = url.hostname.replace(/^www\./, '');
  const playlistId = url.searchParams.get('list') || null;
  let videoId = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] || null;
  } else if (host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
    if (url.searchParams.get('v')) {
      videoId = url.searchParams.get('v');
    } else {
      const match = url.pathname.match(/^\/(live|shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (match) {
        videoId = match[2];
      }
    }
  }

  // Validate 11-char videoId if present
  if (videoId && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    videoId = null;
  }

  return { videoId, playlistId };
}

export function getThumbnailUrl(videoId) {
  if (!videoId) return '';
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const secs = Math.floor(totalSeconds);
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  const seconds = secs % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export async function fetchVideoMetadata(videoId, rawUrl) {
  try {
    const params = new URLSearchParams();
    if (videoId) params.set('videoId', videoId);
    if (rawUrl) params.set('url', rawUrl);
    const res = await fetch(`/api/metadata?${params.toString()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
