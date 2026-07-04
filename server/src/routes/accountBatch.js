const express = require('express');
const router = express.Router();
const accountImportController = require('../controllers/accountImportController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

router.post('/', auth, requireAdmin, adminScope.loadAdminScope, accountImportController.importAccounts);

module.exports = router;
