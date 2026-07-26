const express = require('express');
const router = express.Router();
const creditController = require('../controllers/creditController');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');
const { violationRules, paginationRules } = require('../middleware/validator');

router.get('/violations', auth, paginationRules, creditController.violationList);
router.post('/violation', auth, requireAdmin, violationRules, creditController.createViolation);
router.get('/blacklist', auth, requireRole('counselor', 'super_admin'), creditController.blacklist);
router.put('/blacklist/:userId', auth, requireRole('counselor', 'super_admin'), creditController.updateBlacklist);

module.exports = router;
