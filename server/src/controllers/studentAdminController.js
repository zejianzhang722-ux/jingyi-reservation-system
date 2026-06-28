const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const config = require('../config');

const clean = function(value) {
  return String(value || '').trim();
};

const createStudent = async function(req, res) {
  try {
    const body = req.body || {};
    const studentNo = clean(body.studentNo || body.student_no || body.studentId || body.student_id);
    const realName = clean(body.realName || body.real_name || body.name);
    const cardNo = clean(body.cardNo || body.card_no);
    const phone = clean(body.phone);
    const college = clean(body.college);
    const major = clean(body.major);
    const grade = clean(body.grade);
    const className = clean(body.className || body.class_name);
    const roomNumber = clean(body.roomNumber || body.room_number);
    let buildingId = clean(body.buildingId || body.building_id);

    if (!/^\d{9,10}$/.test(studentNo)) {
      return response.error(res, '学号应为9-10位数字', 400);
    }
    if (!realName) {
      return response.error(res, '请输入宿生姓名', 400);
    }
    if (!/^\d{6}$/.test(cardNo)) {
      return response.error(res, '一卡通号应为6位数字', 400);
    }
    if (phone && !/^1\d{10}$/.test(phone)) {
      return response.error(res, '手机号格式不正确', 400);
    }

    if (req.adminScope && !req.adminScope.isGlobal) {
      buildingId = req.adminScope.buildingId || '';
    }
    const normalizedBuildingId = buildingId ? parseInt(buildingId, 10) : null;

    const [existing] = await db.query(
      'SELECT id FROM users WHERE role = ? AND (student_no = ? OR student_id = ? OR card_no = ?) LIMIT 1',
      ['student', studentNo, studentNo, cardNo]
    );
    if (existing.length > 0) {
      return response.error(res, '该学号或一卡通号已存在', 409);
    }

    const initialScore = Number(config.credit && config.credit.initialScore) || 100;
    const [result] = await db.query(
      'INSERT INTO users (student_no, student_id, card_no, name, real_name, phone, college, major, grade, class_name, building_id, room_number, role, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [studentNo, studentNo, cardNo, realName, realName, phone || null, college || null, major || null, grade || null, className || null, normalizedBuildingId, roomNumber || null, 'student', initialScore, 'active']
    );

    return response.success(res, {
      id: result.insertId,
      student_no: studentNo,
      student_id: studentNo,
      name: realName,
      real_name: realName,
      card_no: cardNo,
      phone: phone,
      college: college,
      major: major,
      grade: grade,
      class_name: className,
      building_id: normalizedBuildingId,
      room_number: roomNumber,
      role: 'student',
      credit_score: initialScore,
      status: 'active'
    }, '宿生已添加');
  } catch (err) {
    logger.error('管理员手动添加宿生失败:', err);
    return response.error(res, err.message || '添加宿生失败', 500);
  }
};

module.exports = { createStudent };
