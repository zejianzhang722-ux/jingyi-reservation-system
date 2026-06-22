const express = require('express');
const router = express.Router();
const reservationController = require('../controllers/reservationController');
const { auth } = require('../middleware/auth');
const { createReservationRules, reservationIdRules, waitlistRules, paginationRules } = require('../middleware/validator');
const { reservationLimiter } = require('../middleware/rateLimit');

router.post('/', auth, reservationLimiter, createReservationRules, reservationController.create);
router.get('/', auth, paginationRules, reservationController.list);
router.get('/pending', auth, reservationController.pending);
router.get('/pending-count', auth, reservationController.pendingCount);
router.put('/:id/approve', auth, reservationController.approve);
router.put('/:id/reject', auth, reservationController.reject);
router.get('/:id', auth, reservationIdRules, reservationController.detail);
router.delete('/:id', auth, reservationIdRules, reservationController.cancel);
router.put('/:id', auth, reservationIdRules, reservationController.update);
router.get('/:id/qrcode', auth, reservationIdRules, reservationController.qrcode);
router.post('/:id/rebook', auth, reservationIdRules, reservationController.rebook);
router.post('/check-conflict', auth, reservationController.checkConflict);
router.post('/waitlist', auth, reservationLimiter, waitlistRules, reservationController.joinWaitlist);
router.delete('/:id/waitlist', auth, reservationIdRules, reservationController.leaveWaitlist);

module.exports = router;
