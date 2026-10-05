const express = require('express');
const router = express.Router();
const posterController = require('../controllers/posterController');
const scopedQueryController = require('../controllers/scopedQueryController');
const posterPositionController = require('../controllers/posterPositionController');
const { auth, requireAdmin, requireRole } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const optionalAdminScope = require('../middleware/optionalAdminScope');
const { posterRules, paginationRules } = require('../middleware/validator');

router.post('/', auth, posterRules, posterController.create);
router.get('/', auth, optionalAdminScope, scopedQueryController.posters);

// ── 张贴位置管理（poster_positions）────────────────────────────────────────────
// 独立资源路径 /poster/positions，与海报申请 /poster 彻底分离，避免历史上
// 「位置增删改误伤海报申请数据」的问题再次发生。
// 张贴位置属于全院级基础配置，与后台菜单保持一致，仅超级管理员可查看和维护；
// GET 保留 paginationRules（pageSize<=100，前端导出按 100/页循环拉取）。
router.get('/positions', auth, requireRole('super_admin'), adminScope.loadAdminScope, paginationRules, posterPositionController.list);
router.post('/positions', auth, requireRole('super_admin'), adminScope.loadAdminScope, posterPositionController.create);
router.put('/positions/:id', auth, requireRole('super_admin'), adminScope.loadAdminScope, posterPositionController.update);
router.delete('/positions/:id', auth, requireRole('super_admin'), adminScope.loadAdminScope, posterPositionController.remove);
router.post('/:id/approve', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.approve);
router.post('/:id/reject', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.reject);
router.post('/:id/clean', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.clean);
router.post('/:id/violation', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.violation);

module.exports = router;
