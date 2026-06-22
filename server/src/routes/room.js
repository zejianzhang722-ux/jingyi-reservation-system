const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { optionalAuth, auth } = require('../middleware/auth');
const { roomIdRules, timelineRules } = require('../middleware/validator');

router.get('/', optionalAuth, roomController.list);
router.get('/type/:type', optionalAuth, roomController.listByType);
router.get('/building/:building', optionalAuth, roomController.listByBuilding);
router.post('/compare', auth, roomController.compare);
router.get('/announcements', optionalAuth, roomController.listAnnouncements);
router.get('/stats', optionalAuth, roomController.stats);
router.get('/:id', optionalAuth, roomIdRules, roomController.detail);
router.get('/:id/seats', optionalAuth, roomIdRules, roomController.seats);
router.get('/:id/timeline', optionalAuth, timelineRules, roomController.timeline);

module.exports = router;
