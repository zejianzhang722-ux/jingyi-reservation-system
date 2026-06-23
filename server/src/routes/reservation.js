const express = require('express');
const router = express.Router();
const reservationController = require('../controllers/reservationController');
const reservationCreateController = require('../controllers/reservationCreateController');
const reservationMutationController = require('../controllers/reservationMutationController');
const reservationApprovalController = require('../controllers/reservationApprovalController');
const checkinCredentialController = require('../controllers/checkinCredentialController');
const { auth, requireAdmin } = require('../middleware/auth');
const { createReservationRules, reservationIdRules, waitlistRules, paginationRules, auditRules } = require('../middleware/validator');
const { reservationLimiter } = require('../middleware/rateLimit');

router.post('/', auth, reservationLimiter, createReservationRules, reservationCreateController.create);
router.get('/', auth, paginationRules, reservationController.list);
router.get('/pending', auth, requireAdmin, reservationApprovalController.pending);
router.get('/pending-count', auth, requireAdmin, reservationApprovalController.pendingCount);
router.put('/:id/approve', auth, requireAdmin, auditRules, reservationApprovalController.approve);
router.put('/:id/reject', auth, requireAdmin, auditRules, reservationApprovalController.reject);
router.get('/:id', auth, reservationIdRules, reservationController.detail);
router.delete('/:id', auth, reservationIdRules, reservationController.cancel);
router.put('/:id', auth, reservationIdRules, reservationMutationController.update);
router.get('/:id/qrcode', auth, reservationIdRules, checkinCredentialController.issue);
router.post('/:id/rebook', auth, reservationIdRules, reservationMutationController.rebook);
router.post('/check-conflict', auth, reservationController.checkConflict);
router.post('/waitlist', auth, reservationLimiter, waitlistRules, reservationController.joinWaitlist);
router.delete('/:id/waitlist', auth, reservationIdRules, reservationController.leaveWaitlist);

module.exports = router;
