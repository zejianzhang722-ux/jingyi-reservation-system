const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const bcrypt = require('bcryptjs');
const config = require('../config');

const ADMIN_ROLES = ['super_admin', 'admin', 'counselor'];
const STUDENT_ROLE = 'student';

const allowedRolesByOperator = {
  super_admin: ['super_admin', 'admin', 'counselor', 'student'],
  counselor: [],
  admin: []
};

function normalizeAdminScope(role, scopeType, buildingId) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'super_admin' || normalizedRole === 'counselor') return { scopeType: 'global', buildingId: null };
  if (normalizedRole !== 'admin') return { scopeType: null, buildingId: buildingId || null };
  if (scopeType === 'global') return { scopeType: 'global', buildingId: null };
  const id = Number(buildingId);
  if (scopeType === 'building' && Number.isInteger(id) && id > 0) return { scopeType: 'building', buildingId: id };
  return null;
}

function normalizeRole(role) {
  return role === 'superadmin' ? 'super_admin' : role;
}

function allowedRolesFor(operatorRole) {
  return allowedRolesByOperator[normalizeRole(operatorRole)] || [];
}

function canManageRole(operatorRole, targetRole) {
  return allowedRolesFor(operatorRole).indexOf(normalizeRole(targetRole || 'admin')) !== -1;
}

function parseAccountId(raw) {
  const value = String(raw || '');
  const match = value.match(/^(admin|student)-(\d+)$/);
  if (match) {
    return { source: match[1], id: Number(match[2]) };
  }
  return { source: 'admin', id: Number(value) };
}

function accountId(source, id) {
  return source + '-' + id;
}

function normalizeAdminStatus(status) {
  if (status === 'inactive') return 'disabled';
  return status || 'active';
}

function normalizeStudentStatus(status) {
  if (status === 'disabled' || status === 'inactive') return 'banned';
  return status || 'active';
}

function rowMatchesKeyword(row, keyword) {
  if (!keyword) return true;
  const text = [row.username, row.realName, row.name, row.studentId, row.studentNo, row.phone]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return text.indexOf(keyword.toLowerCase()) !== -1;
}

function rowMatchesStatus(row, status) {
  if (!status) return true;
  if (status === 'disabled' || status === 'inactive') {
    return row.status === 'disabled' || row.status === 'banned' || row.status === 'restricted';
  }
  return row.status === status;
}

function rowMatchesScope(row, adminScope) {
  if (!adminScope || adminScope.isGlobal) return true;
  return Number(row.buildingId || 0) === Number(adminScope.buildingId);
}

function paginateRows(rows, page, pageSize) {
  const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
  const normalizedPageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const offset = (normalizedPage - 1) * normalizedPageSize;
  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: rows.length,
    list: rows.slice(offset, offset + normalizedPageSize)
  };
}

async function getAdminRows() {
  const [admins] = await db.query(
    'SELECT a.id, a.username, a.real_name, a.role, a.building_id, a.scope_type, a.phone, a.status, a.last_login_at, a.created_at, b.name AS building_name FROM admins a LEFT JOIN buildings b ON a.building_id = b.id ORDER BY a.id ASC'
  );
  return admins.map(function(row) {
    const role = normalizeRole(row.role);
    const isGlobal = role === 'super_admin' || role === 'counselor' || row.scope_type === 'global';
    return {
      id: accountId('admin', row.id),
      rawId: row.id,
      accountType: 'manager',
      username: row.username,
      realName: row.real_name || row.username || '',
      name: row.real_name || row.username || '',
      role: role,
      buildingId: row.building_id,
      buildingName: row.building_name || '',
      scopeType: row.scope_type,
      scopeLabel: isGlobal ? '全院' : (row.building_name || '待设置'),
      phone: row.phone || '',
      email: '',
      status: row.status || 'active',
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at
    };
  });
}

async function getStudentRows() {
  const [students] = await db.query(
    'SELECT u.id, u.student_id, u.student_no, u.card_no, u.name, u.real_name, u.building_id, u.phone, u.status, u.credit_score, u.created_at, b.name AS building_name FROM users u LEFT JOIN buildings b ON u.building_id = b.id ORDER BY u.created_at DESC'
  );
  return students.map(function(row) {
    const studentNo = row.student_no || row.student_id || '';
    return {
      id: accountId('student', row.id),
      rawId: row.id,
      accountType: 'student',
      username: studentNo,
      studentId: row.student_id || studentNo,
      studentNo: studentNo,
      realName: row.real_name || row.name || '',
      name: row.real_name || row.name || '',
      role: 'student',
      buildingId: row.building_id,
      buildingName: row.building_name || '',
      phone: row.phone || '',
      status: row.status || 'active',
      creditScore: row.credit_score,
      createdAt: row.created_at
    };
  });
}

const getAccounts = async function(req, res) {
  try {
    const { page = 1, pageSize = 20, role, status, keyword } = req.query;
    const requestedAccountType = req.query.accountType || 'manager';
    const operatorRole = normalizeRole(req.user && req.user.role);
    if (operatorRole !== 'super_admin') return response.error(res, '仅超级管理员可管理账号', 403);
    const allowedRoles = allowedRolesFor(operatorRole);
    const requestedRole = role ? normalizeRole(role) : null;

    if (requestedAccountType !== 'manager' && requestedAccountType !== 'student') {
      return response.error(res, '账号类型无效', 400);
    }

    if (requestedRole && allowedRoles.indexOf(requestedRole) === -1) {
      return response.paginate(res, [], 0, page, pageSize);
    }

    let rows = [];
    const shouldLoadAdmins = requestedAccountType === 'manager' && (!requestedRole
      ? allowedRoles.some(function(r) { return ADMIN_ROLES.indexOf(r) !== -1; })
      : ADMIN_ROLES.indexOf(requestedRole) !== -1);
    const shouldLoadStudents = requestedAccountType === 'student' && (!requestedRole || requestedRole === STUDENT_ROLE) && allowedRoles.indexOf(STUDENT_ROLE) !== -1;

    if (shouldLoadAdmins) rows = rows.concat(await getAdminRows());
    if (shouldLoadStudents) rows = rows.concat(await getStudentRows());

    rows = rows.filter(function(row) {
      return (!requestedRole || row.role === requestedRole) &&
        rowMatchesStatus(row, status) &&
        rowMatchesKeyword(row, String(keyword || '').trim()) &&
        rowMatchesScope(row, req.adminScope);
    });

    rows.sort(function(a, b) {
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    const result = paginateRows(rows, page, pageSize);
    return response.paginate(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) {
    logger.error('获取统一账号列表异常:', err);
    return response.error(res, err.message);
  }
};

const createAccount = async function(req, res) {
  try {
    const accountType = req.body.accountType;
    if (accountType !== 'student' && accountType !== 'manager') {
      return response.error(res, '请选择正确的账号类型', 400);
    }
    const role = normalizeRole(req.body.role || (accountType === 'student' ? 'student' : 'admin'));
    if ((accountType === 'student' && role !== 'student') || (accountType === 'manager' && role === 'student')) {
      return response.error(res, '账号类型与角色不匹配', 400);
    }
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '').trim();
    const realName = String(req.body.realName || req.body.name || '').trim();
    const operatorRole = normalizeRole(req.user && req.user.role);

    if (!username || !password) {
      return response.error(res, '用户名和密码不能为空', 400);
    }
    if (!canManageRole(operatorRole, role)) {
      return response.error(res, '您没有权限添加该角色的账号', 403);
    }

    if (role === 'student') {
      const studentNo = username;
      const [existingStudents] = await db.query('SELECT id FROM users WHERE student_id = ? OR student_no = ?', [studentNo, studentNo]);
      if (existingStudents.length > 0) return response.error(res, '该学号已存在', 400);
      const buildingId = req.adminScope && !req.adminScope.isGlobal ? req.adminScope.buildingId : (req.body.buildingId || null);
      const initialScore = (config.credit && config.credit.initialScore) || 100;
      const [result] = await db.query(
        'INSERT INTO users (student_id, student_no, card_no, real_name, name, role, building_id, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
        [studentNo, studentNo, password, realName, realName, 'student', buildingId, initialScore, 'active']
      );
      await logOperation(req.user.id, 'create_student_account', 'users', result.insertId, '创建宿生账号: ' + studentNo);
      return response.success(res, { id: accountId('student', result.insertId), accountType: 'student' }, '创建成功');
    }

    const [existingAdmins] = await db.query('SELECT id FROM admins WHERE username = ?', [username]);
    if (existingAdmins.length > 0) return response.error(res, '用户名已存在', 400);
    const scope = normalizeAdminScope(role, req.body.scopeType, req.body.buildingId);
    if (!scope) return response.error(res, '导生管理员必须选择全院或一个具体楼栋', 400);
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO admins (username, password, real_name, role, building_id, scope_type, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [username, hashedPassword, realName, role, scope.buildingId, scope.scopeType, req.body.phone || '', 'active']
    );
    await logOperation(req.user.id, 'create_admin_account', 'admins', result.insertId, '创建管理员账号: ' + username);
    return response.success(res, { id: accountId('admin', result.insertId), accountType: 'manager' }, '创建成功');
  } catch (err) {
    logger.error('创建统一账号异常:', err);
    return response.error(res, err.message);
  }
};

const updateAccount = async function(req, res) {
  try {
    const account = parseAccountId(req.params.id);
    if (!Number.isInteger(account.id) || account.id <= 0) return response.error(res, '账号编号无效', 400);

    if (account.source === 'student') {
      const [students] = await db.query('SELECT id, role, building_id FROM users WHERE id = ?', [account.id]);
      if (!students.length) return response.error(res, '宿生账号不存在', 404);
      if (!canManageRole(req.user.role, 'student')) return response.error(res, '权限不足', 403);
      if (req.adminScope && !req.adminScope.isGlobal && Number(students[0].building_id || 0) !== Number(req.adminScope.buildingId)) {
        return response.error(res, '无权操作其他楼栋宿生账号', 403);
      }
      if (req.body.role && normalizeRole(req.body.role) !== 'student') {
        return response.error(res, '不能在此接口转换宿生账号类型', 400);
      }
      const updates = [];
      const params = [];
      const realName = req.body.realName !== undefined ? req.body.realName : req.body.name;
      if (realName !== undefined) {
        updates.push('real_name = ?', 'name = ?');
        params.push(realName, realName);
      }
      if (req.body.password) { updates.push('card_no = ?'); params.push(req.body.password); }
      if (req.body.status !== undefined) { updates.push('status = ?'); params.push(normalizeStudentStatus(req.body.status)); }
      if (req.body.buildingId !== undefined) { updates.push('building_id = ?'); params.push(req.body.buildingId || null); }
      if (!updates.length) return response.error(res, '没有需要更新的字段', 400);
      params.push(account.id);
      await db.query('UPDATE users SET ' + updates.join(', ') + ' WHERE id = ?', params);
      await logOperation(req.user.id, 'update_student_account', 'users', account.id, '更新宿生账号');
      return response.success(res, null, '更新成功');
    }

    if (normalizeRole(req.user.role) !== 'super_admin') return response.error(res, '仅超级管理员可修改管理账号', 403);
    const [admins] = await db.query('SELECT id, role, building_id, scope_type FROM admins WHERE id = ?', [account.id]);
    if (!admins.length) return response.error(res, '管理员账号不存在', 404);
    const isCurrentAdmin = Number(req.user.id) === Number(account.id);
    const disablingSelf = isCurrentAdmin && req.body.status !== undefined && normalizeAdminStatus(req.body.status) !== 'active';
    if (disablingSelf) return response.error(res, '不能停用当前登录账号', 409);
    const currentRole = normalizeRole(admins[0].role);
    const nextRole = req.body.role ? normalizeRole(req.body.role) : currentRole;
    const scope = normalizeAdminScope(nextRole, req.body.scopeType !== undefined ? req.body.scopeType : admins[0].scope_type, req.body.buildingId !== undefined ? req.body.buildingId : admins[0].building_id);
    if (!scope) return response.error(res, '导生管理员必须选择全院或一个具体楼栋', 400);
    if (!canManageRole(req.user.role, currentRole) || !canManageRole(req.user.role, nextRole)) return response.error(res, '权限不足', 403);
    if (req.adminScope && !req.adminScope.isGlobal && Number(admins[0].building_id || 0) !== Number(req.adminScope.buildingId)) {
      return response.error(res, '无权操作其他楼栋管理员账号', 403);
    }

    const updates = [];
    const params = [];
    const realName = req.body.realName !== undefined ? req.body.realName : req.body.name;
    if (realName !== undefined) { updates.push('real_name = ?'); params.push(realName); }
    if (req.body.role !== undefined) { updates.push('role = ?'); params.push(nextRole); }
    if (req.body.status !== undefined) { updates.push('status = ?'); params.push(normalizeAdminStatus(req.body.status)); }
    updates.push('building_id = ?'); params.push(scope.buildingId);
    updates.push('scope_type = ?'); params.push(scope.scopeType);
    if (req.body.phone !== undefined) { updates.push('phone = ?'); params.push(req.body.phone || ''); }
    if (req.body.password) {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);
      updates.push('password = ?');
      params.push(hashedPassword);
    }
    if (!updates.length) return response.error(res, '没有需要更新的字段', 400);
    params.push(account.id);
    await db.query('UPDATE admins SET ' + updates.join(', ') + ' WHERE id = ?', params);
    await logOperation(req.user.id, 'update_admin_account', 'admins', account.id, '更新管理员账号');
    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新统一账号异常:', err);
    return response.error(res, err.message);
  }
};

const deleteAccount = async function(req, res) {
  try {
    const account = parseAccountId(req.params.id);
    if (!Number.isInteger(account.id) || account.id <= 0) return response.error(res, '账号编号无效', 400);

    if (account.source === 'student') {
      const [students] = await db.query('SELECT id, building_id FROM users WHERE id = ?', [account.id]);
      if (!students.length) return response.error(res, '宿生账号不存在', 404);
      if (!canManageRole(req.user.role, 'student')) return response.error(res, '权限不足', 403);
      if (req.adminScope && !req.adminScope.isGlobal && Number(students[0].building_id || 0) !== Number(req.adminScope.buildingId)) {
        return response.error(res, '无权操作其他楼栋宿生账号', 403);
      }
      await db.query("UPDATE users SET status = 'banned' WHERE id = ?", [account.id]);
      await logOperation(req.user.id, 'delete_student_account', 'users', account.id, '禁用宿生账号');
      return response.success(res, null, '删除成功');
    }

    const [admins] = await db.query('SELECT role, building_id FROM admins WHERE id = ?', [account.id]);
    if (!admins.length) return response.error(res, '管理员账号不存在', 404);
    if (Number(req.user.id) === Number(account.id)) return response.error(res, '不能停用当前登录账号', 409);
    const targetRole = normalizeRole(admins[0].role);
    if (targetRole === 'super_admin') return response.error(res, '不能删除超级管理员账号', 403);
    if (!canManageRole(req.user.role, targetRole)) return response.error(res, '权限不足', 403);
    await db.query("UPDATE admins SET status = 'disabled' WHERE id = ?", [account.id]);
    await logOperation(req.user.id, 'delete_admin_account', 'admins', account.id, '禁用管理员账号');
    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除统一账号异常:', err);
    return response.error(res, err.message);
  }
};

const getManagers = async function(req, res) {
  try {
    const { page = 1, pageSize = 20, role, status, keyword } = req.query;
    let rows = await getAdminRows();
    rows = rows.filter(function(row) {
      return (!role || row.role === normalizeRole(role)) &&
        rowMatchesStatus(row, status) &&
        rowMatchesKeyword(row, String(keyword || '').trim());
    });
    rows.sort(function(a, b) { return Number(a.rawId) - Number(b.rawId); });
    const result = paginateRows(rows, page, pageSize);
    return response.paginate(res, result.list, result.total, result.page, result.pageSize);
  } catch (err) {
    logger.error('获取管理员列表异常:', err);
    return response.error(res, err.message);
  }
};

async function logOperation(operatorId, action, targetTable, targetId, description) {
  try {
    await db.query(
      'INSERT INTO operation_logs (operator_id, action, target_table, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [operatorId, action, targetTable, targetId, description]
    );
  } catch (err) {
    logger.error('记录账号操作日志异常:', err);
  }
}

module.exports = {
  getAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getManagers
};
