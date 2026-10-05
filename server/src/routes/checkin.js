const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');
const supplementController = require('../controllers/supplementController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { checkinRules, supplementApplyRules, supplementReviewRules } = require('../middleware/validator');
const { checkinLimiter } = require('../middleware/rateLimit');
const { reservationFromBody, reservationFromParam } = require('../middleware/reservationAccess');
const optionalAdminReservationScope = require('../middleware/optionalAdminReservationScope');
const optionalAdminReservationBodyScope = require('../middleware/optionalAdminReservationBodyScope');

// 动态二维码由预约人出示、工作人员扫描。学生本人不能调用工作人员签到接口。
router.post('/', auth, requireAdmin, adminScope.loadAdminScope, adminScope.requireCapability('checkin'), adminScope.reservationFromBody('reservationId'), checkinLimiter, checkinRules, checkinController.checkin);
router.post('/checkout', auth, optionalAdminReservationBodyScope('reservationId'), reservationFromBody, checkinController.checkout);
router.get('/status/:reservationId', auth, optionalAdminReservationScope('reservationId'), reservationFromParam('reservationId'), checkinController.getStatus);
router.post('/manual', auth, requireAdmin, adminScope.loadAdminScope, adminScope.requireCapability('checkin'), adminScope.reservationFromBody('reservationId'), checkinController.manualCheckin);
// 管理员数据域内的全部在场签到列表（不限定房间）。必须放在 /current/:roomId 之前，避免被其抢匹配。
router.get('/current', auth, requireAdmin, adminScope.loadAdminScope, checkinController.currentCheckinsAll);
router.get('/current/:roomId', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('roomId'), checkinController.currentCheckins);
router.post('/patrol', auth, requireAdmin, adminScope.loadAdminScope, adminScope.requireCapability('checkin'), adminScope.reservationFromBody('reservationId'), checkinController.patrol);

// 补签申请→审核（R-08）：提交（管理员）/ 列表 / 审核。
router.post('/supplement', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromBody('reservationId'), supplementApplyRules, supplementController.create);
router.get('/supplement', auth, requireAdmin, adminScope.loadAdminScope, supplementController.list);
router.post('/supplement/:id/review', auth, requireAdmin, adminScope.loadAdminScope, supplementReviewRules, supplementController.review);

module.exports = router;
