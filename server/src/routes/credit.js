const express = require('express');
const router = express.Router();
const creditController = require('../controllers/creditController');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { violationRules, paginationRules } = require('../middleware/validator');

// R-14：违规列表为 PII 出口，需按管理员数据域分级脱敏。
// 在 auth 之后装载数据域（loadAdminScope），使 req.adminScope 就绪；
// 非管理员（学生）在 /credit 挂载层已被 requireRole 拦截（403），不会因新增中间件而放行或 500。
router.get('/violations', auth, adminScope.loadAdminScope, paginationRules, creditController.violationList);
router.post('/violation', auth, requireAdmin, violationRules, creditController.createViolation);
router.get('/blacklist', auth, requireRole('counselor', 'super_admin'), creditController.blacklist);
router.put('/blacklist/:userId', auth, requireRole('counselor', 'super_admin'), creditController.updateBlacklist);

module.exports = router;
