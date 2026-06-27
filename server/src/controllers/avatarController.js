const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');

const uploadAvatar = async function(req, res) {
  try {
    const secureFile = req.secureFile || req.file;
    if (!secureFile || !secureFile.url) {
      return response.error(res, '请上传头像图片', 400);
    }

    const avatarUrl = secureFile.url;
    const [result] = await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, req.user.id]);
    if (result && result.affectedRows === 0) {
      return response.error(res, '用户不存在或头像未更新', 404);
    }

    return response.success(res, {
      avatar: avatarUrl,
      avatarUrl: avatarUrl,
      url: avatarUrl,
      filename: secureFile.filename || '',
      mime: secureFile.mimetype || '',
      width: secureFile.width || 0,
      height: secureFile.height || 0,
      size: secureFile.size || 0
    }, '头像更新成功');
  } catch (err) {
    logger.error('上传头像异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { uploadAvatar };
