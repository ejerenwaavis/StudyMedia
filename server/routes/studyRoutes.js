const express = require('express');
const router = express.Router();
const studyController = require('../controllers/studyController');
const { requireAuth } = require('../middleware/requireAuth');

// Public health & media metadata/playlist resolution
router.get('/health', studyController.getHealth);
router.get('/metadata', studyController.getMediaMetadata);
router.get('/playlist', studyController.getYouTubePlaylist);

// Authenticated, user-scoped endpoints
router.get('/playlists', requireAuth, studyController.getPlaylists);
router.put('/playlists/sync', requireAuth, studyController.syncPlaylists);
router.get('/state', requireAuth, studyController.getState);
router.post('/items', requireAuth, studyController.upsertItem);
router.post('/progress', requireAuth, studyController.saveProgress);
router.delete('/items/:videoId', requireAuth, studyController.deleteItem);
router.put('/settings', requireAuth, studyController.updateSettings);

module.exports = router;
