const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { normalizeAdminScope } = require('../utils/adminScope');

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

function normalizeAccountType(accountType, role) {
  const value = String(accountType || '').trim().toLowerCase();
  if (!value) return normalizeRole(role) === 'student' ? 'student' : 'manager';
  if (value === 'manager' || value === 'admin' || value === '管理账号') return 'manager';
  if (value === 'student' || value === '宿生账号') return 'student';
  return null;
}

function normalizeScopeType(value) {
  const normalized = String(value || '').trim();
  if (['global', '全院', '全书院'].includes(normalized)) return 'global';
  if (['building', '指定楼栋', '具体楼栋', '楼栋'].includes(normalized)) return 'building';
  return normalized || null;
}

function canManageRole(operatorRole, targetRole) {
  const allowed = allowedRolesByOperator[normalizeRole(operatorRole)] || [];
  return allowed.indexOf(normalizeRole(targetRole)) !== -1;
}

function normalizeRow(raw) {
  const role = normalizeRole(raw.role || raw['角色'] || 'student');
  return {
    accountType: normalizeAccountType(raw.accountType || raw['账号类型'], role),
    username: String(raw.username || raw.account || raw.studentNo || raw['账号'] || raw['学号'] || '').trim(),
    password: String(raw.password || raw.cardNo || raw['密码'] || raw['一卡通卡号'] || '').trim(),
    realName: String(raw.realName || raw.name || raw['真实姓名'] || raw['姓名'] || '').trim(),
    role,
    scopeType: normalizeScopeType(raw.scopeType || raw.dataScope || raw.managementScope || raw['管理范围'] || raw['数据范围']),
    buildingId: raw.buildingId || raw['楼栋ID'] || null,
    buildingName: String(raw.buildingName || raw['楼栋'] || raw['楼栋名称'] || '').trim(),
    phone: raw.phone || raw['手机号'] || raw['电话'] || ''
  };
}

function createBuildingLookup(buildings) {
  const lookup = new Map();
  buildings.forEach(function(building) {
    lookup.set(String(building.id), building);
    if (building.name) lookup.set(String(building.name).trim().toLowerCase(), building);
    if (building.code) lookup.set(String(building.code).trim().toLowerCase(), building);
  });
  return lookup;
}

function resolveBuilding(row, buildingLookup, required) {
  const reference = row.buildingId || row.buildingName;
  if (!reference) {
    if (required) throw new Error('请选择一个具体楼栋');
    return null;
  }
  const building = buildingLookup.get(String(reference).trim().toLowerCase());
  if (!building) throw new Error('楼栋“' + reference + '”不存在');
  return Number(building.id);
}

async function createStudent(row, req, buildingLookup) {
  const [existing] = await db.query('SELECT id FROM users WHERE student_id = ? OR student_no = ?', [row.username, row.username]);
  if (existing.length) throw new Error('学号已存在');
  const buildingId = req.adminScope && !req.adminScope.isGlobal
    ? req.adminScope.buildingId
    : resolveBuilding(row, buildingLookup, false);
  const initialScore = (config.credit && config.credit.initialScore) || 100;
  const [result] = await db.query(
    'INSERT INTO users (student_id, student_no, card_no, real_name, name, role, building_id, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [row.username, row.username, row.password, row.realName, row.realName, 'student', buildingId || null, initialScore, 'active']
  );
  return { id: 'student-' + result.insertId };
}

async function createAdmin(row, req, buildingLookup) {
  const [existing] = await db.query('SELECT id FROM admins WHERE username = ?', [row.username]);
  if (existing.length) throw new Error('用户名已存在');
  let buildingId = null;
  if (row.role === 'admin' && row.scopeType === 'building') {
    buildingId = resolveBuilding(row, buildingLookup, true);
  }
  const scope = normalizeAdminScope(row.role, row.scopeType, buildingId);
  if (!scope) throw new Error('导生管理员必须选择全院或一个具体楼栋');
  const hashedPassword = await bcrypt.hash(row.password, 10);
  const [result] = await db.query(
    'INSERT INTO admins (username, password, real_name, role, building_id, scope_type, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
    [row.username, hashedPassword, row.realName, row.role, scope.buildingId, scope.scopeType, row.phone || '', 'active']
  );
  return { id: 'admin-' + result.insertId };
}

const importAccounts = async function(req, res) {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) return response.error(res, '导入数据不能为空', 400);

    const operatorRole = normalizeRole(req.user && req.user.role);
    const [buildings] = await db.query('SELECT id, name, code FROM buildings');
    const buildingLookup = createBuildingLookup(buildings);
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
        if (!row.accountType) throw new Error('账号类型无效');
        if ((row.accountType === 'student' && row.role !== 'student') || (row.accountType === 'manager' && row.role === 'student')) {
          throw new Error('账号类型与角色不匹配');
        }
        if (!canManageRole(operatorRole, row.role)) throw new Error('无权导入该角色');
        const created = row.accountType === 'student'
          ? await createStudent(row, req, buildingLookup)
          : await createAdmin(row, req, buildingLookup);
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
