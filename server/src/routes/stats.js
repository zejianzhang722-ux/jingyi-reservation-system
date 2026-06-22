const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { auth, requireAdmin } = require('../middleware/auth');

router.get('/dashboard', auth, requireAdmin, statsController.dashboard);
router.get('/reservations', auth, requireAdmin, statsController.reservationStats);
router.get('/usage-rate', auth, requireAdmin, statsController.usageRate);
router.get('/peak-hours', auth, requireAdmin, statsController.peakHours);
router.get('/noshow', auth, requireAdmin, statsController.noshowStats);
router.get('/users', auth, requireAdmin, statsController.userStats);
router.get('/export', auth, requireAdmin, statsController.exportData);

module.exports = router;
