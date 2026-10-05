const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const opsRoutes = require('./ops');

router.use('/auth', require('./auth'));
router.use('/user', require('./user'));
router.use('/room', require('./room'));
router.use('/reservation', require('./reservation'));
// FOLLOWUP(并非本批次产物)：下一行 `/groups` 属「组团预约」在途工作（此前已存在于工作区但未提交）。
// 本次 Batch0+Batch1 为注册 /admin/delegations 而提交本文件时，该行被一并带入，非本次改造内容。
router.use('/groups', require('./groups'));
router.use('/audit', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./audit'));
router.use('/checkin', require('./checkin'));
router.use('/verification', require('./verification'));
router.use('/reading-room', require('./readingRoom'));
router.use('/poster', require('./poster'));
router.use('/credit', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./credit'));
router.use('/stats', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./stats'));
router.use('/notification', require('./notification'));
// 临时授权 + 岗位交接（R-06）。放在 /admin 之前，避免被 /admin 路由层先行匹配。
router.use('/admin/delegations', require('./adminDelegation'));
router.use('/admin', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./admin'));
router.use('/student-ops', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./studentAdmin'));
router.use('/account-batch', auth, roleAuth.requireRole('admin', 'super_admin', 'counselor'), require('./accountBatch'));
router.use('/rules', require('./rules'));
router.use('/feedback', require('./feedback'));
router.use('/ops', opsRoutes);

// 兼容现有部署探针；详细状态和指标统一放在 /ops 下。
router.get('/health', opsRoutes.live);
router.get('/ready', opsRoutes.ready);

module.exports = router;
