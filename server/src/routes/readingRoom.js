const express = require('express');
const router = express.Router();
const readingRoomController = require('../controllers/readingRoomController');
const { auth } = require('../middleware/auth');

router.post('/enter', auth, readingRoomController.enter);
router.post('/leave', auth, readingRoomController.leave);
router.get('/current', auth, readingRoomController.current);
router.get('/history', auth, readingRoomController.history);

module.exports = router;
