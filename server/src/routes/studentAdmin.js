const express = require('express');
const router = express.Router();
const studentAdminController = require('../controllers/studentAdminController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

router.put('/:id/credit', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.adjustCredit);
router.put('/:id/status', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.updateStatus);

module.exports = router;
