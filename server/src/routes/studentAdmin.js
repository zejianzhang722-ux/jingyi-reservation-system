const express = require('express');
const router = express.Router();
const studentAdminController = require('../controllers/studentAdminController');
const { auth, requireRole } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

router.put('/:id/credit', auth, requireRole('super_admin'), adminScope.loadAdminScope, studentAdminController.adjustCredit);
router.put('/:id/status', auth, requireRole('super_admin'), adminScope.loadAdminScope, studentAdminController.updateStatus);

module.exports = router;
