const crypto = require('crypto');
const Playlist = require('../models/Playlist');
const { getDBStatus } = require('../config/db');
const {
  isR2Configured,
  createPresignedUploadUrl,
  createPresignedStreamUrl,
  deleteR2Object,
} = require('../services/r2Client');

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB safety cap

function sanitizeFileName(name) {
  const base = String(name || 'lecture.mp4')
    .split(/[/\\]/)
    .pop()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
  return base || 'lecture.mp4';
}

function isValidR2Key(key) {
  return typeof key === 'string' && /^users\/[a-f0-9]{24}\/[a-zA-Z0-9._-]+$/.test(key);
}

exports.getStatus = (req, res) => {
  res.json({ configured: isR2Configured() });
};

exports.getUploadUrl = async (req, res) => {
  if (!isR2Configured()) {
    return res.status(503).json({ error: 'Cloudflare R2 Cloud Vault is not configured on the server.' });
  }

  const { fileName, contentType, sizeBytes } = req.body || {};
  const cleanType = String(contentType || 'video/mp4').trim().toLowerCase();

  if (
    !cleanType.startsWith('video/') &&
    !cleanType.startsWith('audio/') &&
    cleanType !== 'application/octet-stream'
  ) {
    return res.status(400).json({ error: 'Only video and audio media files can be uploaded to Cloud Vault.' });
  }

  if (sizeBytes && Number(sizeBytes) > MAX_UPLOAD_BYTES) {
    return res.status(413).json({ error: 'File exceeds the 2 GB Cloud Vault upload limit.' });
  }

  const sanitized = sanitizeFileName(fileName);
  const r2Key = `users/${req.user.id}/${crypto.randomUUID()}-${sanitized}`;

  try {
    const uploadUrl = await createPresignedUploadUrl({
      key: r2Key,
      contentType: cleanType,
    });
    return res.json({
      uploadUrl,
      r2Key,
      expiresIn: 900,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate upload URL', details: err.message });
  }
};

exports.getStreamUrl = async (req, res) => {
  if (!isR2Configured()) {
    return res.status(503).json({ error: 'Cloudflare R2 Cloud Vault is not configured on the server.' });
  }

  const key = String(req.query.key || '').trim();
  if (!isValidR2Key(key)) {
    return res.status(400).json({ error: 'Invalid R2 object key.' });
  }

  const isOwner = key.startsWith(`users/${req.user.id}/`);
  const isAdmin = req.user.role === 'admin';
  let hasSharedAccess = false;

  if (!isOwner && !isAdmin) {
    if (getDBStatus()) {
      const sharedPlaylist = await Playlist.findOne({
        isSharedWithFriends: true,
        'items.r2Key': key,
      })
        .select('_id')
        .lean();
      hasSharedAccess = Boolean(sharedPlaylist);
    }
  }

  if (!isOwner && !isAdmin && !hasSharedAccess) {
    return res.status(403).json({ error: 'Access denied to this Cloud Vault object.' });
  }

  try {
    const streamUrl = await createPresignedStreamUrl({ key });
    return res.json({
      streamUrl,
      r2Key: key,
      expiresIn: 14400,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate stream URL', details: err.message });
  }
};

exports.deleteObject = async (req, res) => {
  if (!isR2Configured()) {
    return res.status(503).json({ error: 'Cloudflare R2 Cloud Vault is not configured on the server.' });
  }

  const key = String(req.query.key || req.body?.key || '').trim();
  if (!isValidR2Key(key)) {
    return res.status(400).json({ error: 'Invalid R2 object key.' });
  }

  const isOwner = key.startsWith(`users/${req.user.id}/`);
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Only the owner or an admin can delete this Cloud Vault file.' });
  }

  try {
    await deleteR2Object({ key });

    // Cleanly strip the deleted r2Key from any playlists referencing it
    if (getDBStatus()) {
      await Playlist.updateMany(
        { 'items.r2Key': key },
        {
          $set: { 'items.$[elem].r2Key': null },
        },
        {
          arrayFilters: [{ 'elem.r2Key': key }],
        }
      ).catch(() => {});
    }

    return res.json({ ok: true, deletedKey: key });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete object from R2', details: err.message });
  }
};
