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

    if (!username || !password) {
      return response.error(res, '用户名和密码不能为空', 400);
    }

    const currentRole = req.user.role;
    const allowedRoles = {
      super_admin: ['super_admin', 'admin', 'counselor', 'student'],
      counselor: ['admin', 'student'],
      admin: ['student']
    };
    const allowed = allowedRoles[currentRole] || [];
    if (!allowed.includes(role || 'admin')) {
      return response.error(res, '您没有权限添加该角色的账号', 403);
    }

    const [existing] = await db.query('SELECT id FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) {
      return response.error(res, '用户名已存在', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO admins (username, password, real_name, role, status, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [username, hashedPassword, realName || '', role || 'admin', 'active']
    );

    await logOperation(req.user.id, 'create_account', 'admins', result.insertId, '创建账号: ' + username);

    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) {
    logger.error('创建账号异常:', err);
    return response.error(res, err.message);
  }
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
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      params.push(hashedPassword);
    }

    if (updates.length === 0) {
      return response.error(res, '没有需要更新的字段', 400);
    }

    params.push(accountId);
    await db.query('UPDATE admins SET ' + updates.join(', ') + ' WHERE id = ?', params);

    await logOperation(req.user.id, 'update_account', 'admins', accountId, '更新账号');

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新账号异常:', err);
    return response.error(res, err.message);
  }
};

const deleteAccount = async function(req, res) {
  try {
    const accountId = req.params.id;

    const [rows] = await db.query('SELECT role FROM admins WHERE id = ?', [accountId]);
    if (rows.length === 0) {
      return response.error(res, '账号不存在', 404);
    }
    if (rows[0].role === 'super_admin') {
      return response.error(res, '不能删除超级管理员账号', 403);
    }

    await db.query("UPDATE admins SET status = 'disabled' WHERE id = ?", [accountId]);

    await logOperation(req.user.id, 'delete_account', 'admins', accountId, '删除账号');

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除账号异常:', err);
    return response.error(res, err.message);
  }
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
    if (keyword) {
      countSql += ' AND (r.name LIKE ? OR r.description LIKE ?)';
      listSql += ' AND (r.name LIKE ? OR r.description LIKE ?)';
      params.push('%' + keyword + '%', '%' + keyword + '%');
    }

    const countParams = params.slice();
    const [countResult] = await db.query(countSql, countParams);

    listSql += ' ORDER BY r.building_id, r.floor, r.name LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [rooms] = await db.query(listSql, params);

    return response.paginate(res, rooms, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取功能房列表异常:', err);
    return response.error(res, err.message);
  }
};

const getRoomDetail = async function(req, res) {
  try {
    const roomId = req.params.id;

    const [rooms] = await db.query(
      'SELECT r.*, b.name as building_name FROM rooms r LEFT JOIN buildings b ON r.building_id = b.id WHERE r.id = ?',
      [roomId]
    );
    if (rooms.length === 0) {
      return response.error(res, '功能房不存在', 404);
    }

    return response.success(res, rooms[0]);
  } catch (err) {
    logger.error('获取功能房详情异常:', err);
    return response.error(res, err.message);
  }
};

const getBuildings = async function(req, res) {
  try {
    const { page = 1, pageSize = 100 } = req.query;
    const offset = (page - 1) * pageSize;

    const [countResult] = await db.query('SELECT COUNT(*) as total FROM buildings');

    const [buildings] = await db.query(
      'SELECT * FROM buildings ORDER BY id LIMIT ? OFFSET ?',
      [parseInt(pageSize), parseInt(offset)]
    );

    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      var [roomCountRes] = await db.query(
        'SELECT COUNT(*) as room_count FROM rooms WHERE building_id = ? AND status = "open"',
        [b.id]
      );
      b.room_count = roomCountRes[0].room_count;
    }

    return response.paginate(res, buildings, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取楼栋列表异常:', err);
    return response.error(res, err.message);
  }
};

const createRoom = async function(req, res) {
  try {
    const { name, type, buildingId, floor, location, area, capacity, openStartTime, openEndTime, maxDuration, needAudit, needCounselorAudit, description, facilities, imageUrl } = req.body;

    const [result] = await db.query(
      'INSERT INTO rooms (name, type, building_id, floor, location, area, capacity, open_start_time, open_end_time, max_duration, need_audit, need_counselor_audit, description, facilities, image_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [name, type, buildingId, floor || null, location || '', area || null, capacity || null, openStartTime || null, openEndTime || null, maxDuration || 240, needAudit ? 1 : 0, needCounselorAudit ? 1 : 0, description || '', facilities || '', imageUrl || '', 'open']
    );

    await logOperation(req.user.id, 'create_room', 'rooms', result.insertId, '创建功能房: ' + name);

    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) {
    logger.error('创建功能房异常:', err);
    return response.error(res, err.message);
  }
};

const updateRoom = async function(req, res) {
  try {
    const roomId = req.params.id;
    const fields = req.body;

    const updates = [];
    const params = [];
    const fieldMap = {
      name: 'name', type: 'type', buildingId: 'building_id', floor: 'floor',
      location: 'location', area: 'area', capacity: 'capacity',
      openStartTime: 'open_start_time', openEndTime: 'open_end_time',
      maxDuration: 'max_duration', needAudit: 'need_audit',
      needCounselorAudit: 'need_counselor_audit', description: 'description',
      facilities: 'facilities', imageUrl: 'image_url', status: 'status'
    };

    for (const [key, value] of Object.entries(fields)) {
      if (fieldMap[key]) {
        updates.push(fieldMap[key] + ' = ?');
        params.push(value);
      }
    }

    if (updates.length === 0) {
      return response.error(res, '没有需要更新的字段', 400);
    }

    params.push(roomId);
    await db.query('UPDATE rooms SET ' + updates.join(', ') + ' WHERE id = ?', params);

    await logOperation(req.user.id, 'update_room', 'rooms', roomId, '更新功能房');

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新功能房异常:', err);
    return response.error(res, err.message);
  }
};

const deleteRoom = async function(req, res) {
  try {
    const roomId = req.params.id;

    await db.query('UPDATE rooms SET status = ? WHERE id = ?', ['closed', roomId]);

    await logOperation(req.user.id, 'delete_room', 'rooms', roomId, '删除功能房');

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除功能房异常:', err);
    return response.error(res, err.message);
  }
};

const getSeatsByRoom = async function(req, res) {
  try {
    const roomId = req.params.id;
    const [rows] = await db.query('SELECT id, room_id, seat_number, row_num, col_num, status, has_power FROM seats WHERE room_id = ? ORDER BY id ASC', [roomId]);
    return response.success(res, rows);
  } catch (err) {
    logger.error('获取座位列表异常:', err);
    return response.error(res, err.message);
  }
};

const batchCreateSeats = async function(req, res) {
  try {
    const { roomId, count, startNumber, rowSize } = req.body;

    const values = [];
    for (let i = 0; i < count; i++) {
      const seatNumber = (startNumber || 1) + i;
      const rowNum = Math.floor(i / (rowSize || 10)) + 1;
      const colNum = (i % (rowSize || 10)) + 1;
      values.push([roomId, seatNumber, rowNum, colNum, 'available']);
    }

    const placeholders = values.map(function() { return '(?, ?, ?, ?, ?)'; }).join(',');
    const flatValues = values.flat();

    await db.query(
      'INSERT INTO seats (room_id, seat_number, row_num, col_num, status) VALUES ' + placeholders,
      flatValues
    );

    await db.query('UPDATE rooms SET capacity = ? WHERE id = ?', [count, roomId]);

    await logOperation(req.user.id, 'batch_create_seats', 'seats', roomId, '批量创建座位: ' + count + '个');

    return response.success(res, null, '批量创建座位成功');
  } catch (err) {
    logger.error('批量创建座位异常:', err);
    return response.error(res, err.message);
  }
};

const updateSeat = async function(req, res) {
  try {
    const seatId = req.params.id;
    const { status, seatNumber, rowNum, colNum } = req.body;

    const updates = [];
    const params = [];

    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (seatNumber !== undefined) { updates.push('seat_number = ?'); params.push(seatNumber); }
    if (rowNum !== undefined) { updates.push('row_num = ?'); params.push(rowNum); }
    if (colNum !== undefined) { updates.push('col_num = ?'); params.push(colNum); }

    if (updates.length === 0) {
      return response.error(res, '没有需要更新的字段', 400);
    }

    params.push(seatId);
    await db.query('UPDATE seats SET ' + updates.join(', ') + ' WHERE id = ?', params);

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新座位异常:', err);
    return response.error(res, err.message);
  }
};

const deleteSeat = async function(req, res) {
  try {
    await db.query("UPDATE seats SET status = 'disabled' WHERE id = ?", [req.params.id]);

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除座位异常:', err);
    return response.error(res, err.message);
  }
};

const getConfig = async function(req, res) {
  try {
    const [configs] = await db.query('SELECT * FROM system_config ORDER BY id');

    const configMap = {};
    configs.forEach(function(c) {
      configMap[c.config_key] = c.config_value;
    });

    return response.success(res, configMap);
  } catch (err) {
    logger.error('获取系统配置异常:', err);
    return response.error(res, err.message);
  }
};

const updateConfig = async function(req, res) {
  try {
    const configs = req.body;

    for (const [key, value] of Object.entries(configs)) {
      await db.query(
        'INSERT INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE config_value = ?, updated_at = NOW()',
        [key, JSON.stringify(value), JSON.stringify(value)]
      );
    }

    await logOperation(req.user.id, 'update_config', 'system_config', null, '更新系统配置');

    return response.success(res, null, '配置更新成功');
  } catch (err) {
    logger.error('更新系统配置异常:', err);
    return response.error(res, err.message);
  }
};

const createBuilding = async function(req, res) {
  try {
    const { name, code, address, floors, description, status } = req.body;

    const [result] = await db.query(
      'INSERT INTO buildings (name, code, address, floors, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [name, code || '', address || '', floors || 0, description || '', status || 'active']
    );

    await logOperation(req.user.id, 'create_building', 'buildings', result.insertId, '创建楼栋: ' + name);

    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) {
    logger.error('创建楼栋异常:', err);
    return response.error(res, err.message);
  }
};

const updateBuilding = async function(req, res) {
  try {
    const { name, code, address, floors, description, status } = req.body;
    const buildingId = req.params.id;

    await db.query(
      'UPDATE buildings SET name = ?, code = ?, address = ?, floors = ?, description = ?, status = ? WHERE id = ?',
      [name, code || '', address || '', floors || 0, description || '', status || 'active', buildingId]
    );

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新楼栋异常:', err);
    return response.error(res, err.message);
  }
};

const deleteBuilding = async function(req, res) {
  try {
    await db.query('DELETE FROM buildings WHERE id = ?', [req.params.id]);

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除楼栋异常:', err);
    return response.error(res, err.message);
  }
};

const createManager = async function(req, res) {
  try {
    const { username, password, realName, role, buildingId, phone } = req.body;

    const [existing] = await db.query('SELECT id FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) {
      return response.error(res, '用户名已存在', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      'INSERT INTO admins (username, password, real_name, role, building_id, phone, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
      [username, hashedPassword, realName || '', role || 'admin', buildingId || null, phone || '', 'active']
    );

    await logOperation(req.user.id, 'create_manager', 'admins', result.insertId, '创建管理员: ' + username);

    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) {
    logger.error('创建管理员异常:', err);
    return response.error(res, err.message);
  }
};

const updateManager = async function(req, res) {
  try {
    const managerId = req.params.id;
    const { realName, role, buildingId, phone, status, password } = req.body;

    const updates = [];
    const params = [];

    if (realName !== undefined) { updates.push('real_name = ?'); params.push(realName); }
    if (role !== undefined) { updates.push('role = ?'); params.push(role); }
    if (buildingId !== undefined) { updates.push('building_id = ?'); params.push(buildingId); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.push('password = ?');
      params.push(hashedPassword);
    }

    if (updates.length === 0) {
      return response.error(res, '没有需要更新的字段', 400);
    }

    params.push(managerId);
    await db.query('UPDATE admins SET ' + updates.join(', ') + ' WHERE id = ?', params);

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新管理员异常:', err);
    return response.error(res, err.message);
  }
};

const deleteManager = async function(req, res) {
  try {
    await db.query("UPDATE admins SET status = 'disabled' WHERE id = ?", [req.params.id]);

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除管理员异常:', err);
    return response.error(res, err.message);
  }
};

const operationLogs = async function(req, res) {
  try {
    const { page = 1, pageSize = 20, operatorId, action } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = 'SELECT o.*, a.username, a.real_name FROM operation_logs o LEFT JOIN admins a ON o.operator_id = a.id WHERE 1=1';
    const params = [];

    if (operatorId) { sql += ' AND o.operator_id = ?'; params.push(operatorId); }
    if (action) { sql += ' AND o.action = ?'; params.push(action); }

    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [logs] = await db.query(sql, params);

    const [countResult] = await db.query('SELECT COUNT(*) as total FROM operation_logs WHERE 1=1');

    return response.paginate(res, logs, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取操作日志异常:', err);
    return response.error(res, err.message);
  }
};

const getAnnouncements = async function(req, res) {
  try {
    const { page = 1, pageSize = 20 } = req.query;
    const offset = (page - 1) * pageSize;
    const [countResult] = await db.query('SELECT COUNT(*) as total FROM announcements');
    const [rows] = await db.query('SELECT a.*, b.real_name as creator_name FROM announcements a LEFT JOIN admins b ON a.created_by = b.id ORDER BY a.is_top DESC, a.created_at DESC LIMIT ? OFFSET ?', [parseInt(pageSize), parseInt(offset)]);
    return response.paginate(res, rows, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取公告列表异常:', err);
    return response.error(res, err.message);
  }
};

const createAnnouncement = async function(req, res) {
  try {
    const { title, content, type, isTop } = req.body;

    const [result] = await db.query(
      'INSERT INTO announcements (title, content, type, is_top, created_by, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [title, content, type || 'notice', isTop ? 1 : 0, req.user.id]
    );

    return response.success(res, { id: result.insertId }, '创建成功');
  } catch (err) {
    logger.error('创建公告异常:', err);
    return response.error(res, err.message);
  }
};

const updateAnnouncement = async function(req, res) {
  try {
    const announcementId = req.params.id;
    const { title, content, type, isTop, status } = req.body;

    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (content !== undefined) { updates.push('content = ?'); params.push(content); }
    if (type !== undefined) { updates.push('type = ?'); params.push(type); }
    if (isTop !== undefined) { updates.push('is_top = ?'); params.push(isTop ? 1 : 0); }
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }

    if (updates.length === 0) {
      return response.error(res, '没有需要更新的字段', 400);
    }

    params.push(announcementId);
    await db.query('UPDATE announcements SET ' + updates.join(', ') + ' WHERE id = ?', params);

    return response.success(res, null, '更新成功');
  } catch (err) {
    logger.error('更新公告异常:', err);
    return response.error(res, err.message);
  }
};

const deleteAnnouncement = async function(req, res) {
  try {
    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);

    return response.success(res, null, '删除成功');
  } catch (err) {
    logger.error('删除公告异常:', err);
    return response.error(res, err.message);
  }
};

const archiveSemester = async function(req, res) {
  try {
    const { semesterName } = req.body;

    const [reservationCount] = await db.query('SELECT COUNT(*) as count FROM reservations');
    const [checkinCount] = await db.query('SELECT COUNT(*) as count FROM checkins');

    await db.query(
      'INSERT INTO system_config (config_key, config_value, created_at) VALUES (?, ?, NOW())',
      ['archive_' + semesterName, JSON.stringify({ reservations: reservationCount[0].count, checkins: checkinCount[0].count, archivedAt: new Date().toISOString() })]
    );

    await logOperation(req.user.id, 'archive_semester', 'system', null, '学期归档: ' + semesterName);

    return response.success(res, null, '归档成功');
  } catch (err) {
    logger.error('学期归档异常:', err);
    return response.error(res, err.message);
  }
};

const backupData = async function(req, res) {
  try {
    const tables = ['buildings', 'rooms', 'seats', 'users', 'reservations', 'checkins', 'credits_log', 'violations', 'posters', 'reading_room_logs', 'notifications', 'admins', 'announcements', 'system_config'];
    const backup = {};

    for (const table of tables) {
      const [rows] = await db.query('SELECT * FROM ' + table);
      backup[table] = rows;
    }

    await logOperation(req.user.id, 'backup_data', 'system', null, '数据备份');

    return response.success(res, { tables: tables, timestamp: new Date().toISOString() }, '备份成功');
  } catch (err) {
    logger.error('数据备份异常:', err);
    return response.error(res, err.message);
  }
};

const uploadFile = async function(req, res) {
  try {
    if (!req.file) {
      return response.error(res, '请选择文件', 400);
    }

    const fileUrl = '/uploads/' + req.file.filename;

    return response.success(res, { url: fileUrl, filename: req.file.filename, size: req.file.size }, '上传成功');
  } catch (err) {
    logger.error('文件上传异常:', err);
    return response.error(res, err.message);
  }
};

const logOperation = async function(operatorId, action, targetTable, targetId, description) {
  try {
    await db.query(
      'INSERT INTO operation_logs (operator_id, action, target_table, target_id, description, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [operatorId, action, targetTable, targetId, description]
    );
  } catch (err) {
    logger.error('记录操作日志异常:', err);
  }
};

module.exports = {
  getAccounts, createAccount, updateAccount, deleteAccount,
  getRooms, getRoomDetail, getSeatsByRoom,
  createRoom, updateRoom, deleteRoom,
  batchCreateSeats, updateSeat, deleteSeat,
  getConfig, updateConfig,
  getBuildings,
  createBuilding, updateBuilding, deleteBuilding,
  createManager, updateManager, deleteManager,
  operationLogs,
  createAnnouncement, updateAnnouncement, deleteAnnouncement,
  getAnnouncements,
  archiveSemester, backupData,
  uploadFile
};
