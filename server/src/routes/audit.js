const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');
const scopedQueryController = require('../controllers/scopedQueryController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { auditRules, batchAuditRules } = require('../middleware/validator');

router.get('/pending', auth, requireAdmin, adminScope.loadAdminScope, scopedQueryController.pendingReservations);
router.post('/:id/approve', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromParam('id'), auditRules, auditController.approve);
router.post('/:id/reject', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromParam('id'), auditRules, auditController.reject);
router.post('/batch', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationBatchFromBody('ids'), batchAuditRules, auditController.batchAudit);
router.get('/counselor/pending', auth, requireAdmin, adminScope.loadAdminScope, scopedQueryController.pendingReservations);

module.exports = router;
