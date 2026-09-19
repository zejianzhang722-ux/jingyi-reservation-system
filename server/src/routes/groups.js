const express = require('express');
const router = express.Router();
const reservationGroupController = require('../controllers/reservationGroupController');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { reservationLimiter } = require('../middleware/rateLimit');

// 路由顺序约束（改动时务必保持）：
// 所有带固定后缀的路径必须声明在 '/:id' 之前，否则 'mine'、'pending'
// 会被当作 id 解析，命中 detail 后返回 400「组团ID无效」。
// 因此 GET '/:id' 必须放在最后。

router.post('/', auth, reservationLimiter, reservationGroupController.create);
router.get('/mine', auth, reservationGroupController.mine);
router.get('/pending', auth, requireAdmin, adminScope.loadAdminScope, reservationGroupController.pending);

router.post('/:id/join', auth, reservationLimiter, reservationGroupController.join);
router.post('/:id/leave', auth, reservationGroupController.leave);
router.delete('/:id', auth, reservationGroupController.dissolve);
router.put('/:id/approve', auth, requireAdmin, adminScope.loadAdminScope, reservationGroupController.approve);
router.put('/:id/reject', auth, requireAdmin, adminScope.loadAdminScope, reservationGroupController.reject);

// 必须最后声明
router.get('/:id', auth, reservationGroupController.detail);

module.exports = router;
