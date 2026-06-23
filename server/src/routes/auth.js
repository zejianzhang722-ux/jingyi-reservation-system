const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const tokenController = require('../controllers/tokenController');
const { wechatLoginRules, adminLoginRules } = require('../middleware/validator');
const { authLimiter, studentLoginAccountLimiter, studentLoginIpLimiter, refreshLimiter } = require('../middleware/rateLimit');
const { auth } = require('../middleware/auth');

router.post('/login/wechat', authLimiter, wechatLoginRules, authController.wechatLogin);
router.post('/login/admin', authLimiter, adminLoginRules, authController.adminMiniappLogin);
router.post('/login/student', studentLoginIpLimiter, studentLoginAccountLimiter, authController.studentLogin);
router.post('/login/admin-miniapp', authLimiter, adminLoginRules, authController.adminMiniappLogin);
router.post('/refresh', refreshLimiter, tokenController.refresh);
router.post('/logout', auth, authController.logout);

module.exports = router;
