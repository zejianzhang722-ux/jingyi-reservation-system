const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tokenController = require('../controllers/tokenController');
const { wechatLoginRules, adminLoginRules } = require('../middleware/validator');
const { authLimiter } = require('../middleware/rateLimit');
const { auth } = require('../middleware/auth');

router.post('/login/wechat', authLimiter, wechatLoginRules, authController.wechatLogin);
// Web 管理后台与管理员小程序复用同一套已验证的管理员登录实现，
// 避免两份认证逻辑继续漂移。
router.post('/login/admin', authLimiter, adminLoginRules, authController.adminMiniappLogin);
router.post('/login/student', authLimiter, authController.studentLogin);
router.post('/login/admin-miniapp', authLimiter, adminLoginRules, authController.adminMiniappLogin);
router.post('/refresh', authLimiter, tokenController.refresh);
router.post('/logout', auth, authController.logout);

module.exports = router;
