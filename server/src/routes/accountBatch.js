const express = require('express');
const router = express.Router();
const accountImportController = require('../controllers/accountImportController');
const { auth, requireRole } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

router.post('/', auth, requireRole('super_admin'), adminScope.loadAdminScope, accountImportController.importAccounts);

module.exports = router;
