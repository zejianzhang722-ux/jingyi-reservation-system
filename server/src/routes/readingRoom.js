const express = require('express');
const router = express.Router();
const readingRoomController = require('../controllers/readingRoomController');
const { auth } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');

const ADMIN_ROLES = ['super_admin', 'superadmin', 'admin', 'counselor'];

/**
 * 仅当请求者是管理员时才装载数据域（req.adminScope），学生直接放行。
 *
 * 为什么不能无条件挂 adminScope.loadAdminScope：该中间件对非管理员角色会直接返回
 * 403「管理员身份无效」，若无条件挂载会让「学生查看自己阅览记录」的既有调用路径全断。
 * 也不能换成 requireAdmin——同样是放行不了学生。
 * 控制器以「req.adminScope 是否存在」区分两种可见范围，缺省即最小权限（只看自己）。
 */
const loadScopeIfAdmin = function(req, res, next) {
  if (req.user && ADMIN_ROLES.indexOf(req.user.role) !== -1) {
    return adminScope.loadAdminScope(req, res, next);
  }
  return next();
};

router.post('/enter', auth, readingRoomController.enter);
router.post('/leave', auth, readingRoomController.leave);
router.get('/current', auth, readingRoomController.current);
router.get('/history', auth, loadScopeIfAdmin, readingRoomController.history);

module.exports = router;
