const express = require('express');
const router = express.Router();
const studyController = require('../controllers/studyController');

router.get('/health', studyController.getHealth);
router.get('/metadata', studyController.getYouTubeMetadata);
router.get('/state', studyController.getState);
router.post('/items', studyController.upsertItem);
router.post('/progress', studyController.saveProgress);
router.delete('/items/:videoId', studyController.deleteItem);
router.put('/settings', studyController.updateSettings);

module.exports = router;
