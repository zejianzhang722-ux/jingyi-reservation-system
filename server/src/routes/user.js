const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const scopedQueryController = require('../controllers/scopedQueryController');
const secureUploadService = require('../services/secureUploadService');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { updateProfileRules, bindStudentRules } = require('../middleware/validator');
const response = require('../utils/response');

function studentOnly(req, res, next) {
  if (!req.user || req.user.role !== 'student') {
    return response.error(res, '管理员账号不能访问学生个人资料', 403);
  }
  next();
}

router.get('/list', auth, requireAdmin, adminScope.loadAdminScope, scopedQueryController.users);
router.get('/profile', auth, studentOnly, userController.getProfile);
router.put('/profile', auth, studentOnly, updateProfileRules, userController.updateProfile);
router.post(
  '/avatar',
  auth,
  studentOnly,
  secureUploadService.imageUpload('avatar', 'avatar'),
  userController.uploadAvatar
);
router.get('/credit', auth, studentOnly, userController.getCredit);
router.get('/stats', auth, studentOnly, userController.getStats);
router.post('/bind', auth, studentOnly, bindStudentRules, userController.bindStudent);

module.exports = router;
