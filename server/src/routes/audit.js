const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const { auth, requireAdmin } = require('../middleware/auth');
const { auditRules, batchAuditRules } = require('../middleware/validator');

router.get('/pending', auth, requireAdmin, auditController.pendingList);
router.post('/:id/approve', auth, requireAdmin, auditRules, auditController.approve);
router.post('/:id/reject', auth, requireAdmin, auditRules, auditController.reject);
router.post('/batch', auth, requireAdmin, batchAuditRules, auditController.batchAudit);
router.get('/counselor/pending', auth, requireAdmin, auditController.counselorPending);

module.exports = router;
