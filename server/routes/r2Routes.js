const express = require('express');
const router = express.Router();
const r2Controller = require('../controllers/r2Controller');
const { requireAuth } = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/status', r2Controller.getStatus);
router.post('/upload-url', r2Controller.getUploadUrl);
router.get('/stream-url', r2Controller.getStreamUrl);
router.delete('/object', r2Controller.deleteObject);

module.exports = router;
