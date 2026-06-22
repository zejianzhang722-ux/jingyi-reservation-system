const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const config = require('../config');
const userController = require('../controllers/userController');
const { auth } = require('../middleware/auth');
const { updateProfileRules, bindStudentRules } = require('../middleware/validator');
const response = require('../utils/response');

function studentOnly(req, res, next) {
  if (!req.user || req.user.role !== 'student') {
    return response.error(res, '管理员账号不能访问学生个人资料', 403);
  }
  next();
}

const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.join(__dirname, '..', '..', config.upload.dir));
  },
  filename: function(req, file, cb) {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, 'avatar-' + req.user.id + '-' + Date.now() + ext);
  }
});
const upload = multer({
  storage: storage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: function(req, file, cb) {
    if (!/^image\//.test(file.mimetype || '')) {
      cb(new Error('头像必须是图片文件'));
      return;
    }
    cb(null, true);
  }
});

router.get('/list', auth, userController.list);
router.get('/profile', auth, studentOnly, userController.getProfile);
router.put('/profile', auth, studentOnly, updateProfileRules, userController.updateProfile);
router.post('/avatar', auth, studentOnly, upload.single('avatar'), userController.uploadAvatar);
router.get('/credit', auth, studentOnly, userController.getCredit);
router.get('/stats', auth, studentOnly, userController.getStats);
router.post('/bind', auth, studentOnly, bindStudentRules, userController.bindStudent);

module.exports = router;
