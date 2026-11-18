const StudyItem = require('../models/StudyItem');
const UserSettings = require('../models/UserSettings');
const { getDBStatus } = require('../config/db');

function getWorkspaceId(req) {
  return (req.query.workspaceId || req.body?.workspaceId || 'default').trim() || 'default';
}

exports.getHealth = (req, res) => {
  res.json({
    ok: true,
    service: 'StudyMedia API',
    dbConnected: getDBStatus(),
    timestamp: new Date().toISOString(),
  });
};

exports.getYouTubeMetadata = async (req, res) => {
  const { url, videoId } = req.query;
  const targetUrl = url || (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : null);

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
  const { videoId, playlistId, title, author, thumbnail, duration, lastPosition, inQueue, queueOrder } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
  }

  if (!getDBStatus()) {
    return res.json({ synced: false });
  }

  try {
    const update = {
      ...(playlistId !== undefined && { playlistId }),
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
  const { videoId, lastPosition, duration, title, thumbnail } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'videoId is required' });
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
      'audioOnlyMode',
      'wakeLockPreferred',
      'activeMode',
      'activeVideoId',
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
