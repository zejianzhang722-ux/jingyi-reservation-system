const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');
const devAvatarStore = require('../services/devAvatarStore');

const calculateCreditScore = async function(userId, fallbackScore) {
  const [logsAsc] = await db.query('SELECT * FROM credits_log WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 200', [userId]);
  logsAsc.sort(function(a, b) {
    const timeA = new Date(a.created_at || 0).getTime();
    const timeB = new Date(b.created_at || 0).getTime();
    if (timeA !== timeB) return timeA - timeB;
    const changeA = Number(a.score_change) || 0;
    const changeB = Number(b.score_change) || 0;
    if ((changeA < 0) !== (changeB < 0)) return changeA < 0 ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });
  let runningScore = Number(config.credit.initialScore) || 100;
  const scoreAfterById = {};
  logsAsc.forEach(function(log) {
    runningScore += Number(log.score_change) || 0;
    scoreAfterById[log.id] = runningScore;
  });
  if (logsAsc.length === 0) {
    runningScore = Number(fallbackScore);
    if (isNaN(runningScore)) runningScore = Number(config.credit.initialScore) || 100;
  }
  return { score: runningScore, logsAsc: logsAsc, scoreAfterById: scoreAfterById };
};

const getProfile = async function(req, res) {
  try {
    const [users] = await db.query(
      'SELECT id, openid, nickname, avatar, phone, email, student_id, student_no, real_name, real_name as name, college, major, class_name, building_id, room_number, role, credit_score, status, card_no, gender, grade, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (users.length === 0) return response.error(res, '用户不存在', 404);
    users[0] = devAvatarStore.applyAvatar(users[0]);
    const credit = await calculateCreditScore(req.user.id, users[0].credit_score);
    users[0].credit_score = credit.score;
    users[0].creditScore = credit.score;
    return response.success(res, users[0]);
  } catch (err) { logger.error('获取用户信息异常:', err); return response.error(res, err.message); }
};

const updateProfile = async function(req, res) {
  try {
    const { nickname, name, realName, phone, email, avatar, college, major, className, buildingId, roomNumber, cardNo, gender, grade } = req.body;
    const updates = [];
    const params = [];
    const profileName = realName !== undefined ? realName : name;
    if (nickname !== undefined) { updates.push('nickname = ?'); params.push(nickname); }
    if (profileName !== undefined) { updates.push('real_name = ?'); params.push(profileName); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone || null); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (college !== undefined) { updates.push('college = ?'); params.push(college); }
    if (major !== undefined) { updates.push('major = ?'); params.push(major); }
    if (className !== undefined) { updates.push('class_name = ?'); params.push(className); }
    if (buildingId !== undefined) { updates.push('building_id = ?'); params.push(buildingId); }
    if (roomNumber !== undefined) { updates.push('room_number = ?'); params.push(roomNumber); }
    if (cardNo !== undefined) { updates.push('card_no = ?'); params.push(cardNo); }
    if (gender !== undefined) { updates.push('gender = ?'); params.push(gender); }
    if (grade !== undefined) { updates.push('grade = ?'); params.push(grade); }
    if (updates.length === 0) return response.error(res, '没有需要更新的字段', 400);
    params.push(req.user.id);
    await db.query('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', params);
    if (avatar !== undefined) devAvatarStore.saveAvatar(req.user, avatar);
    return response.success(res, null, '更新成功');
  } catch (err) { logger.error('更新用户信息异常:', err); return response.error(res, err.message); }
};

const getCredit = async function(req, res) {
  try {
    const [users] = await db.query('SELECT credit_score, status FROM users WHERE id = ?', [req.user.id]);
    if (users.length === 0) return response.error(res, '用户不存在', 404);
    const credit = await calculateCreditScore(req.user.id, users[0].credit_score);
    const logsAsc = credit.logsAsc;
    const scoreAfterById = credit.scoreAfterById;
    const creditScore = credit.score;
    const logs = logsAsc.slice(-20).sort(function(a, b) {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeA !== timeB) return timeB - timeA;
      const changeA = Number(a.score_change) || 0;
      const changeB = Number(b.score_change) || 0;
      if ((changeA > 0) !== (changeB > 0)) return changeA > 0 ? -1 : 1;
      return Number(b.id) - Number(a.id);
    });
    const records = logs.map(function(log) { return { id: log.id, type: log.type, reason: log.description || '信用分变动', description: log.description || '信用分变动', change: Number(log.score_change) || 0, scoreAfter: Number(scoreAfterById[log.id]) || 0, score_after: Number(scoreAfterById[log.id]) || 0, createdAt: log.created_at, created_at: log.created_at }; });
    return response.success(res, { creditScore: creditScore, score: creditScore, status: users[0].status, recentLogs: records, records: records });
  } catch (err) { logger.error('获取信用分异常:', err); return response.error(res, err.message); }
};

const getStats = async function(req, res) {
  try {
    const [totalResult] = await db.query('SELECT COUNT(*) as total FROM reservations WHERE user_id = ?', [req.user.id]);
    const [activeResult] = await db.query("SELECT COUNT(*) as active FROM reservations WHERE user_id = ? AND status IN ('approved', 'pending', 'counselor_pending')", [req.user.id]);
    const [noshowResult] = await db.query("SELECT COUNT(*) as noshow FROM reservations WHERE user_id = ? AND status = 'noshow'", [req.user.id]);
    const [completedResult] = await db.query("SELECT COUNT(*) as completed FROM reservations WHERE user_id = ? AND status = 'completed'", [req.user.id]);
    const [recentReservations] = await db.query('SELECT r.*, rm.name as room_name, rm.type as room_type FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 10', [req.user.id]);
    return response.success(res, { totalReservations: totalResult[0].total, activeReservations: activeResult[0].active, noshowCount: noshowResult[0].noshow, completedCount: completedResult[0].completed, recentReservations: recentReservations });
  } catch (err) { logger.error('获取用户统计异常:', err); return response.error(res, err.message); }
};

const bindStudent = async function(req, res) {
  try {
    const { studentId, realName } = req.body;
    const [existing] = await db.query('SELECT id FROM users WHERE student_id = ? AND id != ?', [studentId, req.user.id]);
    if (existing.length > 0) return response.error(res, '该学号已被绑定', 400);
    await db.query('UPDATE users SET student_id = ?, real_name = ? WHERE id = ?', [studentId, realName, req.user.id]);
    return response.success(res, null, '绑定成功');
  } catch (err) { logger.error('绑定学号异常:', err); return response.error(res, err.message); }
};

const uploadAvatar = async function(req, res) {
  try {
    const secureFile = req.secureFile || req.file;
    if (!secureFile || !secureFile.url) return response.error(res, '请上传头像图片', 400);
    const avatarUrl = secureFile.url;
    const [result] = await db.query('UPDATE users SET avatar = ? WHERE id = ?', [avatarUrl, req.user.id]);
    if (result && result.affectedRows === 0) return response.error(res, '用户不存在，头像未保存', 404);
    const [users] = await db.query('SELECT id, openid, student_id, student_no, avatar FROM users WHERE id = ?', [req.user.id]);
    const user = users && users[0] ? users[0] : req.user;
    devAvatarStore.saveAvatar(Object.assign({}, req.user, user), avatarUrl);
    const savedAvatar = devAvatarStore.getAvatar(user) || (user && user.avatar) || avatarUrl;
    return response.success(res, { avatar: savedAvatar, avatarUrl: savedAvatar, url: savedAvatar, filename: secureFile.filename, mime: secureFile.mimetype, width: secureFile.width, height: secureFile.height, size: secureFile.size }, '头像更新成功');
  } catch (err) { logger.error('上传头像异常:', err); return response.error(res, err.message); }
};

module.exports = { getProfile, updateProfile, getCredit, getStats, bindStudent, uploadAvatar };
