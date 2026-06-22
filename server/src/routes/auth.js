const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { wechatLoginRules, adminLoginRules } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimit');
const { auth } = require('../middleware/auth');

router.post('/login/wechat', authLimiter, wechatLoginRules, authController.wechatLogin);
router.post('/login/admin', authLimiter, adminLoginRules, authController.adminLogin);
router.post('/login/student', authLimiter, authController.studentLogin);
router.post('/login/admin-miniapp', authLimiter, authController.adminMiniappLogin);
router.post('/refresh', authController.refreshToken);
router.post('/logout', auth, authController.logout);

module.exports = router;
