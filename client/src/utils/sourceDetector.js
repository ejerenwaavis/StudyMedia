import { parseYouTubeUrl, getThumbnailUrl } from './youtube.js';

const DIRECT_MEDIA_EXTENSIONS = /\.(mp4|m4v|webm|ogv|mov|mp3|m4a|wav|ogg|oga|aac|flac|opus)(\?.*|#.*)?$/i;
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|ogg|oga|aac|flac|opus)(\?.*|#.*)?$/i;

export const TRUSTED_DOWNLOADERS = [
  {
    name: 'Cobalt Tools',
    url: 'https://cobalt.tools/',
    description: 'Clean, ad-free open-source downloader (paste copied URL)',
  },
  {
    name: 'CNVMP3 (Audio/MP4)',
    url: 'https://cnvmp3.com/',
    description: 'Ad-free YouTube to MP3 / MP4 converter',
  },
  {
    name: 'Y2Down',
    url: 'https://y2down.cc/',
    description: 'Supports high-res YouTube videos & playlists',
  },
];

/**
 * Parse Vimeo video ID from standard Vimeo URLs:
 * - https://vimeo.com/123456789
 * - https://vimeo.com/channels/staffpicks/123456789
 * - https://vimeo.com/groups/name/videos/123456789
 * - https://player.vimeo.com/video/123456789
 * - https://vimeo.com/123456789/abcdef1234 (unlisted hash)
 */
export function parseVimeoUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  let url;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;

  const match = url.pathname.match(
    /(?:\/video\/|\/channels\/[^/]+\/|\/groups\/[^/]+\/videos\/|\/album\/\d+\/video\/|\/)(\d{5,})(?:\/([a-zA-Z0-9]+))?/
  );
  if (!match) return null;

  return {
    vimeoId: match[1],
    hash: match[2] || url.searchParams.get('h') || null,
    canonicalUrl: match[2]
      ? `https://vimeo.com/${match[1]}/${match[2]}`
      : `https://vimeo.com/${match[1]}`,
  };
}

/**
 * Auto-detect source type from any pasted URL string.
 * Returns null if not a recognized YouTube, Vimeo, or Direct media URL.
 */
export function detectSourceFromUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Check YouTube (video, shorts, live, playlist, or raw 11-char ID)
  const yt = parseYouTubeUrl(trimmed);
  if (yt.videoId || yt.playlistId) {
    const id = yt.videoId || `playlist:${yt.playlistId}`;
    const sourceUrl = yt.videoId
      ? yt.playlistId
        ? `https://www.youtube.com/watch?v=${yt.videoId}&list=${yt.playlistId}`
        : `https://www.youtube.com/watch?v=${yt.videoId}`
      : `https://www.youtube.com/playlist?list=${yt.playlistId}`;

    return {
      id,
      videoId: id,
      sourceType: 'youtube',
      sourceUrl,
      localBlobId: null,
      youtubeVideoId: yt.videoId,
      playlistId: yt.playlistId,
      isPlaylist: Boolean(yt.playlistId),
      title: yt.videoId ? `Loading lecture (${yt.videoId})...` : 'Loading YouTube Playlist...',
      thumbnail: yt.videoId ? getThumbnailUrl(yt.videoId) : null,
      duration: 0,
      lastPosition: 0,
      isOfflineReady: false,
      mimeType: null,
    };
  }

  // 2. Check Vimeo
  const vimeo = parseVimeoUrl(trimmed);
  if (vimeo) {
    const id = `vimeo:${vimeo.vimeoId}`;
    return {
      id,
      videoId: id,
      sourceType: 'vimeo',
      sourceUrl: vimeo.canonicalUrl,
      localBlobId: null,
      vimeoId: vimeo.vimeoId,
      playlistId: null,
      isPlaylist: false,
      title: `Loading Vimeo (${vimeo.vimeoId})...`,
      thumbnail: null,
      duration: 0,
      lastPosition: 0,
      isOfflineReady: false,
      mimeType: null,
    };
  }

  // 3. Check Direct Media URL (.mp4, .mp3, .m4a, .webm, etc.)
  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (
    (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') &&
    DIRECT_MEDIA_EXTENSIONS.test(parsedUrl.pathname + parsedUrl.search)
  ) {
    const cleanUrl = parsedUrl.toString();
    const rawFileName = decodeURIComponent(parsedUrl.pathname.split('/').pop() || 'Direct Media');
    const title = rawFileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || rawFileName;
    const isAudio = AUDIO_EXTENSIONS.test(parsedUrl.pathname);
    const hash = simpleHash(cleanUrl);
    const id = `direct:${hash}`;

    return {
      id,
      videoId: id,
      sourceType: 'direct',
      sourceUrl: cleanUrl,
      localBlobId: null,
      playlistId: null,
      isPlaylist: false,
      title,
      thumbnail: null,
      duration: 0,
      lastPosition: 0,
      isOfflineReady: false,
      mimeType: isAudio ? 'audio/mpeg' : 'video/mp4',
    };
  }

  return null;
}

/**
 * Create a normalized queue item from a locally imported File/Blob stored in IndexedDB.
 */
export function createLocalQueueItem({
  id,
  fileName,
  mimeType,
  sizeBytes,
  thumbnailDataUrl = null,
  duration = 0,
  title = null,
  queueOrder = 0,
  sourceUrl = null,
  lastPosition = 0,
}) {
  const cleanId = id || `local:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const displayTitle =
    title ||
    (fileName || 'Local Lecture').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() ||
    'Local Lecture';

  return {
    id: cleanId,
    videoId: cleanId,
    sourceType: 'local',
    sourceUrl: sourceUrl || null,
    localBlobId: cleanId,
    playlistId: null,
    title: displayTitle,
    author: 'Local Device',
    thumbnail: thumbnailDataUrl || null,
    duration: Number.isFinite(duration) ? duration : 0,
    lastPosition: Number.isFinite(lastPosition) ? lastPosition : 0,
    isOfflineReady: true,
    mimeType: mimeType || 'video/mp4',
    sizeBytes: sizeBytes || 0,
    inQueue: true,
    queueOrder,
    lastWatchedAt: new Date().toISOString(),
  };
}

/**
 * Normalize legacy StudyMedia items (from older localStorage or MongoDB docs)
 * into the canonical unified item schema without losing any data.
 */
export function normalizeQueueItem(item) {
  if (!item) return null;
  const id = item.id || item.videoId;
  if (!id) return null;

  let sourceType = item.sourceType;
  if (!sourceType) {
    if (item.localBlobId || id.startsWith('local:')) sourceType = 'local';
    else if (item.r2Key) sourceType = 'r2';
    else if (id.startsWith('vimeo:')) sourceType = 'vimeo';
    else if (id.startsWith('direct:')) sourceType = 'direct';
    else sourceType = 'youtube';
  }

  let sourceUrl = item.sourceUrl || null;
  if (!sourceUrl) {
    if (sourceType === 'youtube') {
      if (id.startsWith('playlist:') && item.playlistId) {
        sourceUrl = `https://www.youtube.com/playlist?list=${item.playlistId}`;
      } else if (!id.startsWith('playlist:')) {
        sourceUrl = `https://www.youtube.com/watch?v=${id}`;
      }
    } else if (sourceType === 'vimeo') {
      const vimeoId = id.replace(/^vimeo:/, '');
      sourceUrl = `https://vimeo.com/${vimeoId}`;
    }
  }

  const isOfflineReady = Boolean(item.isOfflineReady && item.localBlobId);

  return {
    ...item,
    id,
    videoId: id,
    sourceType,
    sourceUrl,
    r2Key: item.r2Key || null,
    localBlobId: item.localBlobId || (sourceType === 'local' && item.isOfflineReady ? id : null),
    playlistId: item.playlistId || null,
    playlistTitle: item.playlistTitle || null,
    title: item.title || `Lecture (${id})`,
    author: item.author || '',
    thumbnail:
      item.thumbnail ||
      (sourceType === 'youtube' && !id.startsWith('playlist:') ? getThumbnailUrl(id) : null),
    duration: Number(item.duration) || 0,
    lastPosition: Number(item.lastPosition) || 0,
    isOfflineReady,
    mimeType: item.mimeType || null,
    sizeBytes: item.sizeBytes || null,
    inQueue: item.inQueue !== undefined ? Boolean(item.inQueue) : true,
    queueOrder: item.queueOrder ?? 0,
    lastWatchedAt: item.lastWatchedAt || new Date().toISOString(),
  };
}

/**
 * Determine whether an item is audio-only (mp3, m4a, wav, audio/*).
 */
export function isAudioItem(item) {
  if (!item) return false;
  if (item.mimeType && item.mimeType.toLowerCase().startsWith('audio/')) return true;
  if (item.sourceUrl && AUDIO_EXTENSIONS.test(item.sourceUrl)) return true;
  return false;
}

/**
 * Return the best external URL for copying or opening externally.
 */
export function getExternalUrl(item) {
  if (!item) return null;
  if (item.sourceUrl) return item.sourceUrl;
  const id = item.id || item.videoId || '';
  if (item.sourceType === 'youtube') {
    if (id.startsWith('playlist:') && item.playlistId) {
      return `https://www.youtube.com/playlist?list=${item.playlistId}`;
    }
    if (/^[a-zA-Z0-9_-]{11}$/.test(id)) {
      return `https://www.youtube.com/watch?v=${id}`;
    }
  }
  if (item.sourceType === 'vimeo') {
    return `https://vimeo.com/${id.replace(/^vimeo:/, '')}`;
  }
  return null;
}

/**
 * Fetch metadata for YouTube or Vimeo via the backend /api/metadata proxy.
 */
export async function fetchSourceMetadata(item) {
  try {
    const params = new URLSearchParams();
    if (item.sourceType) params.set('sourceType', item.sourceType);
    if (item.sourceUrl) params.set('url', item.sourceUrl);
    if (item.sourceType === 'youtube' && item.youtubeVideoId) {
      params.set('videoId', item.youtubeVideoId);
    }
    const res = await fetch(`/api/metadata?${params.toString()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Resolve a YouTube playlist URL into an array of individual videos via /api/playlist.
 */
export async function fetchYouTubePlaylist(playlistId) {
  try {
    const res = await fetch(`/api/playlist?list=${encodeURIComponent(playlistId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function simpleHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
