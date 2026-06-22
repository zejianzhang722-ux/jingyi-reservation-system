const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');
const { paginationRules } = require('../middleware/validator');

router.get('/', auth, paginationRules, notificationController.list);
router.put('/:id/read', auth, notificationController.markRead);
router.put('/read-all', auth, notificationController.markAllRead);
router.get('/unread-count', auth, notificationController.unreadCount);

module.exports = router;
