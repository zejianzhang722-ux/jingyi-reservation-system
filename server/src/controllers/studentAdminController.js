const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');

const clean = function(value) { return String(value || '').trim(); };

const normalizeStudentPayload = function(body) {
  body = body || {};
  return {
    studentNo: clean(body.studentNo || body.student_no || body.studentId || body.student_id),
    realName: clean(body.realName || body.real_name || body.name),
    cardNo: clean(body.cardNo || body.card_no),
    phone: clean(body.phone),
    college: clean(body.college),
    major: clean(body.major),
    grade: clean(body.grade),
    className: clean(body.className || body.class_name),
    roomNumber: clean(body.roomNumber || body.room_number),
    buildingId: clean(body.buildingId || body.building_id)
  };
};

const validateStudentPayload = function(data, mode) {
  if (!/^\d{9,10}$/.test(data.studentNo)) return '学号应为9-10位数字';
  if (!data.realName) return '请输入宿生姓名';
  if (mode === 'create' || data.cardNo) {
    if (!/^\d{6}$/.test(data.cardNo)) return '一卡通号应为6位数字';
  }
  if (data.phone && !/^1\d{10}$/.test(data.phone)) return '手机号格式不正确';
  return '';
};

const applyAdminScopeBuilding = function(req, data) {
  if (req.adminScope && !req.adminScope.isGlobal) return req.adminScope.buildingId || null;
  return data.buildingId ? parseInt(data.buildingId, 10) : null;
};

const getStudentForScope = async function(req, studentId) {
  let scopeSql = '';
  const params = [studentId, 'student'];
  if (req.adminScope && !req.adminScope.isGlobal) {
    scopeSql = ' AND building_id = ?';
    params.push(req.adminScope.buildingId);
  }
  const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND role = ?' + scopeSql, params);
  return rows[0] || null;
};

const insertStudent = async function(req, data) {
  const normalizedBuildingId = applyAdminScopeBuilding(req, data);
  const initialScore = Number(config.credit && config.credit.initialScore) || 100;
  const [result] = await db.query(
    'INSERT INTO users (student_no, student_id, card_no, name, real_name, phone, college, major, grade, class_name, building_id, room_number, role, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [data.studentNo, data.studentNo, data.cardNo, data.realName, data.realName, data.phone || null, data.college || null, data.major || null, data.grade || null, data.className || null, normalizedBuildingId, data.roomNumber || null, 'student', initialScore, 'active']
  );
  return result.insertId;
};

const createStudent = async function(req, res) {
  try {
    const data = normalizeStudentPayload(req.body);
    const validateError = validateStudentPayload(data, 'create');
    if (validateError) return response.error(res, validateError, 400);
    const [existing] = await db.query('SELECT id FROM users WHERE role = ? AND (student_no = ? OR student_id = ? OR card_no = ?) LIMIT 1', ['student', data.studentNo, data.studentNo, data.cardNo]);
    if (existing.length > 0) return response.error(res, '该学号或一卡通号已存在', 409);
    const id = await insertStudent(req, data);
    return response.success(res, { id: id, student_no: data.studentNo, student_id: data.studentNo, name: data.realName, real_name: data.realName, card_no: data.cardNo, phone: data.phone, college: data.college, major: data.major, grade: data.grade, class_name: data.className, building_id: applyAdminScopeBuilding(req, data), room_number: data.roomNumber, role: 'student', credit_score: Number(config.credit && config.credit.initialScore) || 100, status: 'active' }, '宿生已添加');
  } catch (err) {
    logger.error('管理员手动添加宿生失败:', err);
    return response.error(res, err.message || '添加宿生失败', 500);
  }
};

const parseImportText = function(text) {
  return String(text || '').split(/\r?\n/).map(function(line) { return clean(line); }).filter(Boolean).map(function(line) {
    const parts = line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',');
    return normalizeStudentPayload({
      studentNo: parts[0], realName: parts[1], cardNo: parts[2], phone: parts[3], college: parts[4], major: parts[5], grade: parts[6], className: parts[7], buildingId: parts[8], roomNumber: parts[9]
    });
  });
};

const importStudents = async function(req, res) {
  try {
    const rows = Array.isArray(req.body && req.body.students) ? req.body.students.map(normalizeStudentPayload) : parseImportText(req.body && req.body.text);
    if (!rows.length) return response.error(res, '请粘贴宿生数据', 400);
    if (rows.length > 200) return response.error(res, '单次最多导入200名宿生', 400);

    const result = { created: 0, skipped: 0, errors: [] };
    const seenStudent = {};
    const seenCard = {};
    for (let i = 0; i < rows.length; i++) {
      const data = rows[i];
      const line = i + 1;
      const validateError = validateStudentPayload(data, 'create');
      if (validateError) { result.skipped++; result.errors.push('第' + line + '行：' + validateError); continue; }
      if (seenStudent[data.studentNo] || seenCard[data.cardNo]) { result.skipped++; result.errors.push('第' + line + '行：导入数据内部重复'); continue; }
      seenStudent[data.studentNo] = true;
      seenCard[data.cardNo] = true;
      const [existing] = await db.query('SELECT id FROM users WHERE role = ? AND (student_no = ? OR student_id = ? OR card_no = ?) LIMIT 1', ['student', data.studentNo, data.studentNo, data.cardNo]);
      if (existing.length > 0) { result.skipped++; result.errors.push('第' + line + '行：学号或一卡通号已存在'); continue; }
      await insertStudent(req, data);
      result.created++;
    }
    return response.success(res, result, '批量导入完成');
  } catch (err) {
    logger.error('批量导入宿生失败:', err);
    return response.error(res, err.message || '批量导入失败', 500);
  }
};

const updateStudent = async function(req, res) {
  try {
    const studentId = req.params.id;
    const data = normalizeStudentPayload(req.body);
    const validateError = validateStudentPayload(data, 'update');
    if (validateError) return response.error(res, validateError, 400);
    const current = await getStudentForScope(req, studentId);
    if (!current) return response.error(res, '宿生不存在或无权编辑', 404);
    const [duplicate] = await db.query('SELECT id FROM users WHERE role = ? AND id != ? AND (student_no = ? OR student_id = ? OR card_no = ?) LIMIT 1', ['student', studentId, data.studentNo, data.studentNo, data.cardNo]);
    if (duplicate.length > 0) return response.error(res, '该学号或一卡通号已被其他宿生使用', 409);
    const normalizedBuildingId = applyAdminScopeBuilding(req, data);
    await db.query(
      'UPDATE users SET student_no = ?, student_id = ?, card_no = ?, name = ?, real_name = ?, phone = ?, college = ?, major = ?, grade = ?, class_name = ?, building_id = ?, room_number = ? WHERE id = ?',
      [data.studentNo, data.studentNo, data.cardNo, data.realName, data.realName, data.phone || null, data.college || null, data.major || null, data.grade || null, data.className || null, normalizedBuildingId, data.roomNumber || null, studentId]
    );
    return response.success(res, null, '宿生信息已更新');
  } catch (err) {
    logger.error('管理员编辑宿生失败:', err);
    return response.error(res, err.message || '编辑宿生失败', 500);
  }
};

const updateStudentStatus = async function(req, res) {
  try {
    const studentId = req.params.id;
    const status = clean(req.body && req.body.status);
    if (!['active', 'banned'].includes(status)) return response.error(res, '宿生状态无效', 400);
    const current = await getStudentForScope(req, studentId);
    if (!current) return response.error(res, '宿生不存在或无权操作', 404);
    await db.query('UPDATE users SET status = ? WHERE id = ? AND role = ?', [status, studentId, 'student']);
    return response.success(res, null, status === 'banned' ? '宿生已封禁' : '宿生已解封');
  } catch (err) {
    logger.error('管理员修改宿生状态失败:', err);
    return response.error(res, err.message || '修改宿生状态失败', 500);
  }
};

module.exports = { createStudent, importStudents, updateStudent, updateStudentStatus };
