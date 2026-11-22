const StudyItem = require('../models/StudyItem');
const UserSettings = require('../models/UserSettings');
const { getDBStatus } = require('../config/db');

function getWorkspaceId(req) {
  return (req.query.workspaceId || req.body?.workspaceId || 'default').trim() || 'default';
}

function decodeXmlEntities(str = '') {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseLengthTextToSeconds(text) {
  if (!text || typeof text !== 'string') return 0;
  const parts = text.trim().split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Walk a parsed YouTube ytInitialData object recursively to gather playlistVideoRenderer entries.
 */
function extractPlaylistRenderers(node, results = []) {
  if (!node || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    for (const child of node) extractPlaylistRenderers(child, results);
    return results;
  }
  if (node.playlistVideoRenderer && node.playlistVideoRenderer.videoId) {
    results.push(node.playlistVideoRenderer);
    return results;
  }
  for (const key of Object.keys(node)) {
    extractPlaylistRenderers(node[key], results);
  }
  return results;
}

exports.getHealth = (req, res) => {
  res.json({
    ok: true,
    service: 'StudyMedia API',
    dbConnected: getDBStatus(),
    timestamp: new Date().toISOString(),
  });
};

exports.getMediaMetadata = async (req, res) => {
  const { url, videoId, sourceType } = req.query;
  const isVimeo =
    sourceType === 'vimeo' || (typeof url === 'string' && /vimeo\.com/i.test(url));

  if (isVimeo && url) {
    try {
      const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
      const response = await fetch(oembedUrl);
      if (!response.ok) {
        return res.status(404).json({ error: 'Could not resolve Vimeo metadata' });
      }
      const data = await response.json();
      return res.json({
        title: data.title || 'Vimeo Lecture',
        author: data.author_name || '',
        thumbnail: data.thumbnail_url || '',
        duration: Number(data.duration) || 0,
      });
    } catch (err) {
      return res.status(502).json({ error: 'Vimeo metadata fetch failed', details: err.message });
    }
  }

  const targetUrl =
    url || (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null);

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url or videoId query parameter' });
  }

  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      return res.status(404).json({ error: 'Could not resolve YouTube metadata' });
    }
    const data = await response.json();
    return res.json({
      title: data.title || 'YouTube Lecture',
      author: data.author_name || '',
      thumbnail: data.thumbnail_url || '',
    });
  } catch (err) {
    return res.status(502).json({ error: 'Metadata fetch failed', details: err.message });
  }
};

exports.getYouTubePlaylist = async (req, res) => {
  const playlistId = (req.query.list || req.query.playlistId || '').trim();
  if (!playlistId || !/^[a-zA-Z0-9_-]{8,}$/.test(playlistId)) {
    return res.status(400).json({ error: 'Invalid or missing YouTube playlist ID' });
  }

  // Tier 1: Parse full playlist page ytInitialData (supports up to 100+ items with durations)
  try {
    const pageUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
    const htmlRes = await fetch(pageUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (htmlRes.ok) {
      const html = await htmlRes.text();
      const match =
        html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
        html.match(/window\["ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/);

      if (match && match[1]) {
        const data = JSON.parse(match[1]);
        const playlistTitle =
          data?.metadata?.playlistMetadataRenderer?.title ||
          data?.header?.playlistHeaderRenderer?.title?.simpleText ||
          'YouTube Playlist';

        const renderers = extractPlaylistRenderers(data);
        const seen = new Set();
        const items = [];

        for (const r of renderers) {
          const vid = r.videoId;
          if (!vid || seen.has(vid)) continue;
          seen.add(vid);

          const title =
            r.title?.runs?.map((run) => run.text).join('') ||
            r.title?.simpleText ||
            `Lecture (${vid})`;
          const author =
            r.shortBylineText?.runs?.map((run) => run.text).join('') || '';
          const durationSec =
            Number(r.lengthSeconds) ||
            parseLengthTextToSeconds(r.lengthText?.simpleText || '');

          items.push({
            videoId: vid,
            title,
            author,
            duration: Number.isFinite(durationSec) ? durationSec : 0,
            thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
            sourceUrl: `https://www.youtube.com/watch?v=${vid}&list=${playlistId}`,
          });
        }

        if (items.length > 0) {
          return res.json({
            playlistId,
            playlistTitle,
            count: items.length,
            items,
          });
        }
      }
    }
  } catch {
    // Fall through to Tier 2 Atom XML feed
  }

  // Tier 2: YouTube Atom XML feed fallback (reliable for standard public playlists)
  try {
    const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
    const feedRes = await fetch(feedUrl);
    if (!feedRes.ok) {
      return res.status(404).json({ error: 'Playlist could not be resolved' });
    }
    const xml = await feedRes.text();
    const feedTitleMatch = xml.match(/<title>([^<]+)<\/title>/);
    const playlistTitle = feedTitleMatch
      ? decodeXmlEntities(feedTitleMatch[1])
      : 'YouTube Playlist';

    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    const items = [];
    let m;
    while ((m = entryRegex.exec(xml)) !== null) {
      const entry = m[1];
      const vidMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      if (!vidMatch) continue;
      const vid = vidMatch[1].trim();
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const authorMatch = entry.match(/<author>\s*<name>([^<]+)<\/name>/);

      items.push({
        videoId: vid,
        title: titleMatch ? decodeXmlEntities(titleMatch[1]) : `Lecture (${vid})`,
        author: authorMatch ? decodeXmlEntities(authorMatch[1]) : '',
        duration: 0,
        thumbnail: `https://img.youtube.com/vi/${vid}/hqdefault.jpg`,
        sourceUrl: `https://www.youtube.com/watch?v=${vid}&list=${playlistId}`,
      });
    }

    if (items.length > 0) {
      return res.json({
        playlistId,
        playlistTitle,
        count: items.length,
        items,
      });
    }
    return res.status(404).json({ error: 'No playable videos found in playlist' });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to resolve playlist', details: err.message });
  }
};

exports.getState = async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!getDBStatus()) {
    return res.json({ synced: false, settings: null, items: [] });
  }

  try {
    const [settings, items] = await Promise.all([
      UserSettings.findOne({ workspaceId }).lean(),
      StudyItem.find({ workspaceId }).sort({ queueOrder: 1, lastWatchedAt: -1 }).lean(),
    ]);

    return res.json({ synced: true, settings, items });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load state', details: err.message });
  }
};

exports.upsertItem = async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  const {
    videoId,
    sourceType,
    sourceUrl,
    playlistId,
    playlistTitle,
    title,
    author,
    thumbnail,
    duration,
    lastPosition,
    inQueue,
    queueOrder,
  } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  // Never persist device-only local IndexedDB blobs to cloud MongoDB
  if (sourceType === 'local' || String(videoId).startsWith('local:')) {
    return res.json({ synced: false, skipped: 'local-only' });
  }

  if (!getDBStatus()) {
    return res.json({ synced: false });
  }

  try {
    const update = {
      ...(sourceType !== undefined && { sourceType }),
      ...(sourceUrl !== undefined && { sourceUrl }),
      ...(playlistId !== undefined && { playlistId }),
      ...(playlistTitle !== undefined && { playlistTitle }),
      ...(title !== undefined && { title }),
      ...(author !== undefined && { author }),
      ...(thumbnail !== undefined && { thumbnail }),
      ...(duration !== undefined && { duration }),
      ...(lastPosition !== undefined && { lastPosition }),
      ...(inQueue !== undefined && { inQueue }),
      ...(queueOrder !== undefined && { queueOrder }),
      lastWatchedAt: new Date(),
    };

    const item = await StudyItem.findOneAndUpdate(
      { workspaceId, videoId },
      { $set: update, $setOnInsert: { workspaceId, videoId } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ synced: true, item });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save item', details: err.message });
  }
};

exports.saveProgress = async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  const { videoId, lastPosition, duration, title, thumbnail, sourceType, sourceUrl } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  if (sourceType === 'local' || String(videoId).startsWith('local:')) {
    return res.json({ synced: false, skipped: 'local-only' });
  }

  if (!getDBStatus()) {
    return res.json({ synced: false });
  }

  try {
    const update = {
      lastPosition: Math.max(0, Number(lastPosition) || 0),
      lastWatchedAt: new Date(),
    };
    if (duration && duration > 0) update.duration = Number(duration);
    if (title) update.title = title;
    if (thumbnail) update.thumbnail = thumbnail;
    if (sourceType) update.sourceType = sourceType;
    if (sourceUrl) update.sourceUrl = sourceUrl;

    await StudyItem.findOneAndUpdate(
      { workspaceId, videoId },
      { $set: update, $setOnInsert: { workspaceId, videoId, inQueue: false } },
      { upsert: true }
    );

    return res.json({ synced: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save progress', details: err.message });
  }
};

exports.deleteItem = async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  const { videoId } = req.params;
  const hardDelete = req.query.hard === 'true';

  if (!getDBStatus()) {
    return res.json({ synced: false });
  }

  try {
    if (hardDelete) {
      await StudyItem.deleteOne({ workspaceId, videoId });
    } else {
      await StudyItem.updateOne({ workspaceId, videoId }, { $set: { inQueue: false } });
    }
    return res.json({ synced: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove item', details: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!getDBStatus()) {
    return res.json({ synced: false });
  }

  try {
    const allowedFields = [
      'seekInterval',
      'playbackSpeed',
      'doubleTapToSkip',
      'doubleTapWindow',
      'autoPlayNext',
      'audioOnlyMode',
      'wakeLockPreferred',
      'activeMode',
      'activeVideoId',
      'sidecarUrl',
      'sidecarApiKey',
      'fallbackConverterUrl',
      'playlists',
    ];
    const update = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
      }
    }

    const settings = await UserSettings.findOneAndUpdate(
      { workspaceId },
      { $set: update, $setOnInsert: { workspaceId } },
      { upsert: true, new: true }
    ).lean();

    return res.json({ synced: true, settings });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to save settings', details: err.message });
  }
};
