const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkinController');
const supplementController = require('../controllers/supplementController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { checkinRules, supplementApplyRules, supplementReviewRules } = require('../middleware/validator');
const { checkinLimiter } = require('../middleware/rateLimit');
const { reservationFromBody, reservationFromParam } = require('../middleware/reservationAccess');

// 动态二维码由预约人出示、工作人员扫描。学生本人不能调用工作人员签到接口。
router.post('/', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromBody('reservationId'), checkinLimiter, checkinRules, checkinController.checkin);
router.post('/checkout', auth, reservationFromBody, checkinController.checkout);
router.get('/status/:reservationId', auth, reservationFromParam('reservationId'), checkinController.getStatus);
router.post('/manual', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromBody('reservationId'), checkinController.manualCheckin);
router.get('/current/:roomId', auth, requireAdmin, adminScope.loadAdminScope, adminScope.roomFromParam('roomId'), checkinController.currentCheckins);
router.post('/patrol', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromBody('reservationId'), checkinController.patrol);

// 补签申请→审核（R-08）：提交（管理员）/ 列表 / 审核。
router.post('/supplement', auth, requireAdmin, adminScope.loadAdminScope, adminScope.reservationFromBody('reservationId'), supplementApplyRules, supplementController.create);
router.get('/supplement', auth, requireAdmin, adminScope.loadAdminScope, supplementController.list);
router.post('/supplement/:id/review', auth, requireAdmin, adminScope.loadAdminScope, supplementReviewRules, supplementController.review);

module.exports = router;
