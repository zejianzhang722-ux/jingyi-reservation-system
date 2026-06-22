const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');
const { auth, requireAdmin } = require('../middleware/auth');
const { checkinRules } = require('../middleware/validator');
const { checkinLimiter } = require('../middleware/rateLimit');

router.post('/', auth, checkinLimiter, checkinRules, checkinController.checkin);
router.post('/checkout', auth, checkinController.checkout);
router.get('/status/:reservationId', auth, checkinController.getStatus);
router.post('/manual', auth, requireAdmin, checkinController.manualCheckin);
router.get('/current/:roomId', auth, checkinController.currentCheckins);
router.post('/patrol', auth, requireAdmin, checkinController.patrol);

module.exports = router;
