const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const dataReadinessService = require('../services/dataReadinessService');

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

router.get('/ready', async function(req, res) {
  const isProduction = process.env.NODE_ENV === 'production';
  const timestamp = new Date().toISOString();
  try {
    const readiness = await dataReadinessService.checkDataReadiness();
    if (!readiness.ready) {
      return res.status(503).json({
        code: 503,
        message: '服务依赖或数据库结构尚未就绪',
        data: isProduction ? { status: 'not_ready', timestamp } : readiness
      });
    }

    const publicData = { status: 'ready', timestamp };
    if (!isProduction) publicData.details = readiness;
    return res.json({ code: 200, message: 'success', data: publicData });
  } catch (err) {
    return res.status(503).json({
      code: 503,
      message: isProduction ? '服务依赖尚未就绪' : (err.message || '服务依赖尚未就绪'),
      data: isProduction ? { status: 'not_ready', timestamp } : (err.details || null)
    });
  }
});

module.exports = router;
