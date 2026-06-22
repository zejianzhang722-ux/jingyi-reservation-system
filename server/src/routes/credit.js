const express = require('express');
const router = express.Router();
const creditController = require('../controllers/creditController');
const { auth, requireAdmin } = require('../middleware/auth');
const { violationRules, paginationRules } = require('../middleware/validator');

router.get('/violations', auth, paginationRules, creditController.violationList);
router.post('/violation', auth, requireAdmin, violationRules, creditController.createViolation);
router.get('/blacklist', auth, requireAdmin, creditController.blacklist);
router.put('/blacklist/:userId', auth, requireAdmin, creditController.updateBlacklist);

module.exports = router;
