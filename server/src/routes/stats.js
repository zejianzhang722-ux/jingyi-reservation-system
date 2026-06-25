const express = require('express');
const router = express.Router();
const statsController = require('../controllers/scopedStatsController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

router.use(auth, requireAdmin, adminScope.loadAdminScope);
router.get('/dashboard', statsController.dashboard);
router.get('/reservations', statsController.reservationStats);
router.get('/usage-rate', statsController.usageRate);
router.get('/peak-hours', statsController.peakHours);
router.get('/noshow', statsController.noshowStats);
router.get('/users', statsController.userStats);
router.get('/export', statsController.exportData);

module.exports = router;
