const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
var roleAuth = require('../middleware/roleAuth');

router.use('/auth', require('./auth'));
router.use('/user', require('./user'));
router.use('/room', require('./room'));
router.use('/reservation', require('./reservation'));
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

router.get('/health', function(req, res) {
  res.json({ code: 200, message: 'success', data: { status: 'ok', timestamp: new Date().toISOString() } });
});

module.exports = router;
