const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');
const { auth, requireAdmin } = require('../middleware/auth');
const { checkinRules } = require('../middleware/validator');
const { checkinLimiter } = require('../middleware/rateLimit');
const { reservationFromBody, reservationFromParam } = require('../middleware/reservationAccess');

// 动态二维码由预约人出示、工作人员扫描。若允许学生本人调用该接口，
// 学生可从二维码接口取得原始凭证后绕过现场工作人员自行签到。
router.post('/', auth, requireAdmin, checkinLimiter, checkinRules, checkinController.checkin);
router.post('/checkout', auth, reservationFromBody, checkinController.checkout);
router.get('/status/:reservationId', auth, reservationFromParam('reservationId'), checkinController.getStatus);
router.post('/manual', auth, requireAdmin, checkinController.manualCheckin);
router.get('/current/:roomId', auth, requireAdmin, checkinController.currentCheckins);
router.post('/patrol', auth, requireAdmin, checkinController.patrol);

module.exports = router;
