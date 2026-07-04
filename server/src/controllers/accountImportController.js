const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const bcrypt = require('bcryptjs');
const config = require('../config');

const roleMap = {
  superadmin: 'super_admin',
  '超级管理员': 'super_admin',
  '导生管理员': 'admin',
  '系统管理员': 'admin',
  '书院辅导员': 'counselor',
  '辅导员': 'counselor',
  '宿生': 'student'
};

const allowedRolesByOperator = {
  super_admin: ['super_admin', 'admin', 'counselor', 'student'],
  counselor: ['admin', 'student'],
  admin: ['student']
};

function normalizeRole(role) {
  return roleMap[role] || role || 'student';
}

function canManageRole(operatorRole, targetRole) {
  const allowed = allowedRolesByOperator[normalizeRole(operatorRole)] || [];
  return allowed.indexOf(normalizeRole(targetRole)) !== -1;
}

function normalizeRow(raw) {
  return {
    username: String(raw.username || raw.account || raw.studentNo || raw['账号'] || raw['学号'] || '').trim(),
    password: String(raw.password || raw.cardNo || raw['密码'] || raw['一卡通卡号'] || '').trim(),
    realName: String(raw.realName || raw.name || raw['真实姓名'] || raw['姓名'] || '').trim(),
    role: normalizeRole(raw.role || raw['角色'] || 'student'),
    buildingId: raw.buildingId || raw['楼栋ID'] || null,
    phone: raw.phone || raw['手机号'] || ''
  };
}

async function createStudent(row, req) {
  const [existing] = await db.query('SELECT id FROM users WHERE student_id = ? OR student_no = ?', [row.username, row.username]);
  if (existing.length) throw new Error('学号已存在');
  const buildingId = req.adminScope && !req.adminScope.isGlobal ? req.adminScope.buildingId : row.buildingId;
  const initialScore = (config.credit && config.credit.initialScore) || 100;
  const [result] = await db.query(
    'INSERT INTO users (student_id, student_no, card_no, real_name, name, role, building_id, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [row.username, row.username, row.password, row.realName, row.realName, 'student', buildingId || null, initialScore, 'active']
  );
  return { id: 'student-' + result.insertId };
}

async function createAdmin(row, req) {
  const [existing] = await db.query('SELECT id FROM admins WHERE username = ?', [row.username]);
  if (existing.length) throw new Error('用户名已存在');
  const buildingId = req.adminScope && !req.adminScope.isGlobal ? req.adminScope.buildingId : row.buildingId;
  const hashedPassword = await bcrypt.hash(row.password, 10);
  const [result] = await db.query(
    'INSERT INTO admins (username, password, real_name, role, building_id, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
    [row.username, hashedPassword, row.realName, row.role, buildingId || null, row.phone || '', 'active']
  );
  return { id: 'admin-' + result.insertId };
}

const importAccounts = async function(req, res) {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return response.error(res, '导入数据不能为空', 400);

    const operatorRole = normalizeRole(req.user && req.user.role);
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2;
      const row = normalizeRow(rows[i]);
      try {
        if (!row.username) throw new Error('账号不能为空');
        if (!row.password) throw new Error('密码不能为空');
        if (!row.realName) throw new Error('真实姓名不能为空');
        if (!canManageRole(operatorRole, row.role)) throw new Error('无权导入该角色');
        const created = row.role === 'student' ? await createStudent(row, req) : await createAdmin(row, req);
        successCount++;
        results.push({ rowNumber, status: 'success', id: created.id, username: row.username });
      } catch (err) {
        failCount++;
        results.push({ rowNumber, status: 'failed', username: row.username, reason: err.message });
      }
    }

    return response.success(res, { successCount, failCount, results }, '导入完成');
  } catch (err) {
    logger.error('批量导入账号异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { importAccounts };
