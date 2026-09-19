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
// GET 挂 paginationRules（pageSize<=100，前端导出按 100/页循环拉取）；
// 写操作挂 requireAdmin + loadAdminScope，并由 enforceBodyBuilding 把非全院管理员
// 强制限定在其所属楼栋。
router.get('/positions', auth, requireAdmin, adminScope.loadAdminScope, paginationRules, posterPositionController.list);
router.post('/positions', auth, requireAdmin, adminScope.loadAdminScope, adminScope.enforceBodyBuilding({ field: 'buildingId' }), posterPositionController.create);
router.put('/positions/:id', auth, requireAdmin, adminScope.loadAdminScope, adminScope.enforceBodyBuilding({ field: 'buildingId' }), posterPositionController.update);
router.delete('/positions/:id', auth, requireAdmin, adminScope.loadAdminScope, posterPositionController.remove);
router.post('/:id/approve', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.approve);
router.post('/:id/reject', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.reject);
router.post('/:id/clean', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.clean);
router.post('/:id/violation', auth, requireRole('counselor', 'super_admin'), adminScope.loadAdminScope, adminScope.posterFromParam('id'), posterController.violation);

module.exports = router;
