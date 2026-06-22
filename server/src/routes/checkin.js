const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');
const { auth, requireAdmin } = require('../middleware/auth');
const { checkinRules } = require('../middleware/validator');
const { checkinLimiter } = require('../middleware/rateLimit');
const { reservationFromBody, reservationFromParam } = require('../middleware/reservationAccess');

router.post('/', auth, checkinLimiter, checkinRules, reservationFromBody, checkinController.checkin);
router.post('/checkout', auth, reservationFromBody, checkinController.checkout);
router.get('/status/:reservationId', auth, reservationFromParam('reservationId'), checkinController.getStatus);
router.post('/manual', auth, requireAdmin, checkinController.manualCheckin);
router.get('/current/:roomId', auth, requireAdmin, checkinController.currentCheckins);
router.post('/patrol', auth, requireAdmin, checkinController.patrol);

module.exports = router;
