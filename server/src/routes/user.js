const express = require('express');
const multer = require('multer');
const router = express.Router();
const userController = require('../controllers/userController');
const avatarController = require('../controllers/avatarController');
const scopedQueryController = require('../controllers/scopedQueryController');
const studentAdminController = require('../controllers/studentAdminController');
const secureUploadService = require('../services/secureUploadService');
const { auth, requireAdmin } = require('../middleware/auth');
const adminScope = require('../middleware/adminScope');
const { updateProfileRules, bindStudentRules } = require('../middleware/validator');
const response = require('../utils/response');

const importUpload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 2 * 1024 * 1024 } });

function studentOnly(req, res, next) {
  if (!req.user || req.user.role !== 'student') return response.error(res, '管理员账号不能访问学生个人资料', 403);
  next();
}

function importFileUpload(req, res, next) {
  importUpload.single('file')(req, res, function(err) {
    if (err) return response.error(res, err.code === 'LIMIT_FILE_SIZE' ? '导入文件不能超过2MB' : '导入文件上传失败', err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    next();
  });
}

router.get('/list', auth, requireAdmin, adminScope.loadAdminScope, scopedQueryController.users);
router.post('/list', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.createStudent);
router.post('/list/import', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.importStudents);
router.post('/list/import-file', auth, requireAdmin, adminScope.loadAdminScope, importFileUpload, studentAdminController.importStudentsFile);
router.put('/list/:id', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.updateStudent);
router.put('/list/:id/status', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.updateStudentStatus);
router.post('/create', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.createStudent);
router.post('/create/import', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.importStudents);
router.post('/create/import-file', auth, requireAdmin, adminScope.loadAdminScope, importFileUpload, studentAdminController.importStudentsFile);
router.put('/create/:id', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.updateStudent);
router.put('/create/:id/status', auth, requireAdmin, adminScope.loadAdminScope, studentAdminController.updateStudentStatus);
router.get('/profile', auth, studentOnly, userController.getProfile);
router.put('/profile', auth, studentOnly, updateProfileRules, userController.updateProfile);
router.post('/avatar', auth, studentOnly, secureUploadService.imageUpload('avatar', 'avatar'), avatarController.uploadAvatar);
router.get('/credit', auth, studentOnly, userController.getCredit);
router.get('/stats', auth, studentOnly, userController.getStats);
router.post('/bind', auth, studentOnly, bindStudentRules, userController.bindStudent);

module.exports = router;
