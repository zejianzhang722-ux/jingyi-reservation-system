const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const opsRoutes = require('./ops');

router.use('/auth', require('./auth'));
router.use('/user', require('./user'));
router.use('/room', require('./room'));
router.use('/reservation', require('./reservation'));
router.use('/groups', require('./groups'));
router.use('/audit', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./audit'));
router.use('/checkin', require('./checkin'));
router.use('/reading-room', require('./readingRoom'));
router.use('/poster', require('./poster'));
router.use('/credit', auth, roleAuth.requireRole('admin', 'super_admin'), require('./credit'));
router.use('/stats', auth, roleAuth.requireRole('admin', 'super_admin'), require('./stats'));
router.use('/notification', require('./notification'));
router.use('/admin', auth, roleAuth.requireRole('admin', 'super_admin'), require('./admin'));
router.use('/rules', require('./rules'));
router.use('/feedback', require('./feedback'));
router.use('/ops', opsRoutes);

// 兼容现有部署探针；详细状态和指标统一放在 /ops 下。
router.get('/health', opsRoutes.live);
router.get('/ready', opsRoutes.ready);

module.exports = router;
