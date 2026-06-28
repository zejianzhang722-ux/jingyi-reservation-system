const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const bcrypt = require('bcryptjs');

const getAccounts = async function(req, res) {
  try {
    const { page = 1, pageSize = 20, role, status } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = 'SELECT id, username, real_name, role, building_id, phone, status, created_at FROM admins WHERE 1=1';
    const params = [];

    if (role) { sql += ' AND role = ?'; params.push(role); }
    if (status) { sql += ' AND status = ?'; params.push(status); }

    const countSql = sql.replace('SELECT id, username, real_name, role, building_id, phone, status, created_at', 'SELECT COUNT(*) as total');
    const [countResult] = await db.query(countSql, params);

    sql += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [rows] = await db.query(sql, params);

    const list = rows.map(function(row) {
      return {
        id: row.id,
        username: row.username,
        realName: row.real_name,
        role: row.role,
        buildingId: row.building_id,
        phone: row.phone,
        status: row.status,
        createdAt: row.created_at
      };
    });

    return response.paginate(res, list, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取账号列表异常:', err);
    return response.error(res, err.message);
  }
};

const createAccount = async function(req, res) {
  try {
    const { username, password, realName, role } = req.body;
    if (!username || !password) return response.error(res, '用户名和密码不能为空', 400);
    const currentRole = req.user.role;
    const allowedRoles = { super_admin: ['super_admin', 'admin', 'counselor', 'student'], counselor: ['admin', 'student'], admin: ['student'] };
    const allowed = allowedRoles[currentRole] || [];
    if (!allowed.includes(role || 'admin')) return response.error(res, '您没有权限添加该角色的账号', 403);
    const [existing] = await db.query('SELECT id FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) return response.error(res, '用户名已存在', 400);
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query('INSERT INTO admins (username, password, real_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [username, hashedPassword, realName || '', role || 'admin', 'active']);
    await logOperation(req.user.id, 'create_account', 'admins', result.insertId, '创建账号: ' + username);
    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) { logger.error('创建账号异常:', err); return response.error(res, err.message); }
};

const updateAccount = async function(req, res) {
  try {
    const accountId = req.params.id;
    const { realName, role, password, status } = req.body;
    const updates = [];
    const params = [];
    if (realName !== undefined) { updates.push('real_name = ?'); params.push(realName); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (password) { const hashedPassword = await bcrypt.hash(password, 10); updates.push('password = ?'); params.push(hashedPassword); }
    if (updates.length === 0) return response.error(res, '没有需要更新的字段', 400);
    params.push(accountId);
    await db.query('UPDATE admins SET ' + updates.join(', ') + ' WHERE id = ?', params);
    await logOperation(req.user.id, 'update_account', 'admins', accountId, '更新账号');
    return response.success(res, null, '更新成功');
  } catch (err) { logger.error('更新账号异常:', err); return response.error(res, err.message); }
};

const deleteAccount = async function(req, res) {
  try {
    const accountId = req.params.id;
    const [rows] = await db.query('SELECT role FROM admins WHERE id = ?', [accountId]);
    if (rows.length === 0) return response.error(res, '账号不存在', 404);
    if (rows[0].role === 'super_admin') return response.error(res, '不能删除超级管理员账号', 403);
    await db.query("UPDATE admins SET status = 'disabled' WHERE id = ?", [accountId]);
    await logOperation(req.user.id, 'delete_account', 'admins', accountId, '删除账号');
    return response.success(res, null, '删除成功');
  } catch (err) { logger.error('删除账号异常:', err); return response.error(res, err.message); }
};

const getRooms = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, type, buildingId, status, keyword } = req.query;
    const offset = (page - 1) * pageSize;
    let countSql = 'SELECT COUNT(*) as total FROM rooms r WHERE 1=1';
    let listSql = 'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE 1=1';
    const params = [];
    if (type) { countSql += ' AND r.type = ?'; listSql += ' AND r.type = ?'; params.push(type); }
    if (buildingId) { countSql += ' AND r.building_id = ?'; listSql += ' AND r.building_id = ?'; params.push(buildingId); }
    if (status) { countSql += ' AND r.status = ?'; listSql += ' AND r.status = ?'; params.push(status); }
    if (keyword) { countSql += ' AND (r.name LIKE ? OR r.description LIKE ?)'; listSql += ' AND (r.name LIKE ? OR r.description LIKE ?)'; params.push('%' + keyword + '%', '%' + keyword + '%'); }
    const countParams = params.slice();
    const [countResult] = await db.query(countSql, countParams);
    listSql += ' ORDER BY r.building_id, r.floor, r.name LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));
    const [rooms] = await db.query(listSql, params);
    return response.paginate(res, rooms, countResult[0].total, page, pageSize);
  } catch (err) { logger.error('获取功能房列表异常:', err); return response.error(res, err.message); }
};

const getRoomDetail = async function(req, res) {
  try {
    const roomId = req.params.id;
    const [rooms] = await db.query('SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE r.id = ?', [roomId]);
    if (rooms.length === 0) return response.error(res, '功能房不存在', 404);
    return response.success(res, rooms[0]);
  } catch (err) { logger.error('获取功能房详情异常:', err); return response.error(res, err.message); }
};

const getBuildings = async function(req, res) {
  try {
    const { page = 1, pageSize = 100 } = req.query;
    const offset = (page - 1) * pageSize;
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM buildings');
    const [buildings] = await db.query('SELECT * FROM buildings ORDER BY id LIMIT ? OFFSET ?', [parseInt(pageSize), parseInt(offset)]);
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      var [roomCountRes] = await db.query('SELECT COUNT(*) as room_count FROM rooms WHERE building_id = ? AND status = "open"', [b.id]);
      b.room_count = roomCountRes[0].room_count;
    }
    return response.paginate(res, buildings, countResult[0].total, page, pageSize);
  } catch (err) { logger.error('获取楼栋列表异常:', err); return response.error(res, err.message); }
};

const createRoom = async function(req, res) {
  try {
    const { name, type, buildingId, floor, location, area, capacity, openStartTime, openEndTime, maxDuration, needAudit, needCounselorAudit, description, facilities, imageUrl, status } = req.body;
    const roomStatus = ['open', 'closed', 'maintenance'].includes(status) ? status : 'open';
    const [result] = await db.query(
      'INSERT INTO rooms (name, type, building_id, floor, location, area, capacity, open_start_time, open_end_time, max_duration, need_audit, need_counselor_audit, description, facilities, image_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [name, type, buildingId, floor || null, location || '', area || null, capacity || null, openStartTime || null, openEndTime || null, maxDuration || 240, needAudit ? 1 : 0, needCounselorAudit ? 1 : 0, description || '', facilities || '', imageUrl || '', roomStatus]
    );
    await logOperation(req.user.id, 'create_room', 'rooms', result.insertId, '创建功能房: ' + name);
    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) { logger.error('创建功能房异常:', err); return response.error(res, err.message); }
};

const updateRoom = async function(req, res) {
  try {
    const roomId = req.params.id;
    const fields = req.body;
    const updates = [];
    const params = [];
    const fieldMap = { name: 'name', type: 'type', buildingId: 'building_id', floor: 'floor', location: 'location', area: 'area', capacity: 'capacity', openStartTime: 'open_start_time', openEndTime: 'open_end_time', maxDuration: 'max_duration', needAudit: 'need_audit', needCounselorAudit: 'need_counselor_audit', description: 'description', facilities: 'facilities', imageUrl: 'image_url', status: 'status' };
    for (const [key, value] of Object.entries(fields)) { if (fieldMap[key]) { updates.push(fieldMap[key] + ' = ?'); params.push(value); } }
    if (updates.length === 0) return response.error(res, '没有需要更新的字段', 400);
    params.push(roomId);
    await db.query('UPDATE rooms SET ' + updates.join(', ') + ' WHERE id = ?', params);
    await logOperation(req.user.id, 'update_room', 'rooms', roomId, '更新功能房');
    return response.success(res, null, '更新成功');
  } catch (err) { logger.error('更新功能房异常:', err); return response.error(res, err.message); }
};

const deleteRoom = async function(req, res) { try { const roomId = req.params.id; await db.query('UPDATE rooms SET status = ? WHERE id = ?', ['closed', roomId]); await logOperation(req.user.id, 'delete_room', 'rooms', roomId, '删除功能房'); return response.success(res, null, '删除成功'); } catch (err) { logger.error('删除功能房异常:', err); return response.error(res, err.message); } };

const getSeatsByRoom = async function(req, res) { try { const roomId = req.params.id; const [rows] = await db.query('SELECT id, room_id, seat_number, row_num, col_num, status, has_power FROM seats WHERE room_id = ? ORDER BY id ASC', [roomId]); return response.success(res, rows); } catch (err) { logger.error('获取座位列表异常:', err); return response.error(res, err.message); } };

const batchCreateSeats = async function(req, res) { try { const { roomId, count, startNumber, rowSize } = req.body; const values = []; for (let i = 0; i < count; i++) { const seatNumber = (startNumber || 1) + i; const rowNum = Math.floor(i / (rowSize || 10)) + 1; const colNum = (i % (rowSize || 10)) + 1; values.push([roomId, seatNumber, rowNum, colNum, 'available']); } const placeholders = values.map(function() { return '(?, ?, ?, ?, ?)'; }).join(','); const flatValues = values.flat(); await db.query('INSERT INTO seats (room_id, seat_number, row_num, col_num, status) VALUES ' + placeholders, flatValues); await db.query('UPDATE rooms SET capacity = ? WHERE id = ?', [count, roomId]); await logOperation(req.user.id, 'batch_create_seats', 'seats', roomId, '批量创建座位'); return response.success(res, null, '创建成功'); } catch (err) { logger.error('批量创建座位异常:', err); return response.error(res, err.message); } };

const updateSeat = async function(req, res) { try { const seatId = req.params.id; const { seatNumber, status, hasPower } = req.body; const updates = []; const params = []; if (seatNumber !== undefined) { updates.push('seat_number = ?'); params.push(seatNumber); } if (status !== undefined) { updates.push('status = ?'); params.push(status); } if (hasPower !== undefined) { updates.push('has_power = ?'); params.push(hasPower ? 1 : 0); } if (updates.length === 0) return response.error(res, '没有需要更新的字段', 400); params.push(seatId); await db.query('UPDATE seats SET ' + updates.join(', ') + ' WHERE id = ?', params); await logOperation(req.user.id, 'update_seat', 'seats', seatId, '更新座位'); return response.success(res, null, '更新成功'); } catch (err) { logger.error('更新座位异常:', err); return response.error(res, err.message); } };
const deleteSeat = async function(req, res) { try { const seatId = req.params.id; await db.query('DELETE FROM seats WHERE id = ?', [seatId]); await logOperation(req.user.id, 'delete_seat', 'seats', seatId, '删除座位'); return response.success(res, null, '删除成功'); } catch (err) { logger.error('删除座位异常:', err); return response.error(res, err.message); } };

const getConfig = async function(req, res) { try { return response.success(res, {}); } catch (err) { return response.error(res, err.message); } };
const updateConfig = async function(req, res) { try { return response.success(res, null, '更新成功'); } catch (err) { return response.error(res, err.message); } };
const createBuilding = async function(req, res) { try { const { name, code, address, floors } = req.body; const [result] = await db.query('INSERT INTO buildings (name, code, address, floors, created_at) VALUES (?, ?, ?, ?, NOW())', [name, code, address || '', floors || 1]); return response.success(res, { id: result.insertId }, '创建成功'); } catch (err) { return response.error(res, err.message); } };
const updateBuilding = async function(req, res) { try { return response.success(res, null, '更新成功'); } catch (err) { return response.error(res, err.message); } };
const deleteBuilding = async function(req, res) { try { return response.success(res, null, '删除成功'); } catch (err) { return response.error(res, err.message); } };
const createManager = async function(req, res) { try { return createAccount(req, res); } catch (err) { return response.error(res, err.message); } };
const updateManager = async function(req, res) { try { return updateAccount(req, res); } catch (err) { return response.error(res, err.message); } };
const deleteManager = async function(req, res) { try { return deleteAccount(req, res); } catch (err) { return response.error(res, err.message); } };
const operationLogs = async function(req, res) { try { return response.success(res, []); } catch (err) { return response.error(res, err.message); } };
const getAnnouncements = async function(req, res) { try { const [rows] = await db.query('SELECT * FROM announcements ORDER BY is_top DESC, created_at DESC'); return response.success(res, rows); } catch (err) { logger.error('获取公告异常:', err); return response.error(res, err.message); } };
const createAnnouncement = async function(req, res) { try { const { title, content, type, isTop, target } = req.body; const [result] = await db.query('INSERT INTO announcements (title, content, type, is_top, target, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [title, content, type || 'normal', isTop ? 1 : 0, target || 'all']); return response.success(res, { id: result.insertId }, '发布成功'); } catch (err) { logger.error('发布公告异常:', err); return response.error(res, err.message); } };
const updateAnnouncement = async function(req, res) { try { const id = req.params.id; const { title, content, type, isTop, target } = req.body; await db.query('UPDATE announcements SET title = COALESCE(?, title), content = COALESCE(?, content), type = COALESCE(?, type), is_top = COALESCE(?, is_top), target = COALESCE(?, target) WHERE id = ?', [title, content, type, isTop === undefined ? null : (isTop ? 1 : 0), target, id]); return response.success(res, null, '更新成功'); } catch (err) { logger.error('更新公告异常:', err); return response.error(res, err.message); } };
const deleteAnnouncement = async function(req, res) { try { await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]); return response.success(res, null, '删除成功'); } catch (err) { logger.error('删除公告异常:', err); return response.error(res, err.message); } };
const archiveSemester = async function(req, res) { try { return response.success(res, null, '归档成功'); } catch (err) { return response.error(res, err.message); } };
const uploadFile = async function(req, res) { try { const secureFile = req.secureFile || req.file; if (!secureFile || !secureFile.url) return response.error(res, '请上传文件', 400); return response.success(res, { url: secureFile.url, filename: secureFile.filename }, '上传成功'); } catch (err) { return response.error(res, err.message); } };

const logOperation = async function(adminId, action, targetType, targetId, description) { try { await db.query('INSERT INTO operation_logs (admin_id, action, target_type, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())', [adminId, action, targetType, targetId, description]); } catch(e) {} };

module.exports = { getAccounts, createAccount, updateAccount, deleteAccount, getRooms, getRoomDetail, getSeatsByRoom, batchCreateSeats, createRoom, updateRoom, deleteRoom, updateSeat, deleteSeat, getConfig, updateConfig, getBuildings, createBuilding, updateBuilding, deleteBuilding, createManager, updateManager, deleteManager, operationLogs, getAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement, archiveSemester, uploadFile };
