const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const scopedQueryController = require('../controllers/scopedQueryController');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { auditRules, batchAuditRules } = require('../middleware/validator');

router.get('/pending', auth, requireRole('admin', 'counselor', 'super_admin'), adminScope.loadAdminScope, scopedQueryController.pendingAuditList);
router.post('/:id/approve', auth, requireRole('admin', 'counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.reservationFromParam('id'), auditRules, auditController.approve);
router.post('/:id/reject', auth, requireRole('admin', 'counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.reservationFromParam('id'), auditRules, auditController.reject);
router.post('/batch', auth, requireRole('admin', 'counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.reservationBatchFromBody('ids'), batchAuditRules, auditController.batchAudit);
router.get('/counselor/pending', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, scopedQueryController.pendingAuditList);

module.exports = router;
