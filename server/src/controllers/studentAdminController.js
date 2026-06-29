const path = require('path');
const zlib = require('zlib');
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

const looksLikeHeader = function(parts) {
  const first = clean(parts[0]);
  const second = clean(parts[1]);
  return /学号|student/i.test(first) || /姓名|name/i.test(second);
};

const parseDelimitedLine = function(line) {
  if (line.indexOf('\t') >= 0) return line.split('\t');
  const parts = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      parts.push(current); current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
};

const rowToStudent = function(parts) {
  return normalizeStudentPayload({
    studentNo: parts[0], realName: parts[1], cardNo: parts[2], phone: parts[3], college: parts[4], major: parts[5], grade: parts[6], className: parts[7], buildingId: parts[8], roomNumber: parts[9]
  });
};

const parseImportText = function(text) {
  return String(text || '').split(/\r?\n/).map(function(line) { return clean(line); }).filter(Boolean).map(parseDelimitedLine).filter(function(parts, index) { return !(index === 0 && looksLikeHeader(parts)); }).map(rowToStudent);
};

const decodeXml = function(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
};

const attrs = function(text) {
  const result = {};
  String(text || '').replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, function(_, key, value) { result[key] = decodeXml(value); return ''; });
  return result;
};

const columnIndex = function(cellRef) {
  const letters = String(cellRef || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  let index = 0;
  for (let i = 0; i < letters.length; i++) index = index * 26 + (letters.charCodeAt(i) - 64);
  return Math.max(0, index - 1);
};

const parseZipEntries = function(buffer) {
  const sig = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === sig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无法识别xlsx文件结构');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = {};
  let offset = centralOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('xlsx目录结构无效');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('xlsx本地文件头无效');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries[name] = method === 0 ? raw : (method === 8 ? zlib.inflateRawSync(raw) : null);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
};

const entryText = function(entries, name) {
  if (!entries[name]) return '';
  return entries[name].toString('utf8');
};

const parseSharedStrings = function(xml) {
  const strings = [];
  String(xml || '').replace(/<si[\s\S]*?<\/si>/g, function(si) {
    const parts = [];
    si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, function(_, value) { parts.push(decodeXml(value)); return ''; });
    strings.push(parts.join(''));
    return '';
  });
  return strings;
};

const firstWorksheetPath = function(entries) {
  const workbook = entryText(entries, 'xl/workbook.xml');
  const relsXml = entryText(entries, 'xl/_rels/workbook.xml.rels');
  const rels = {};
  relsXml.replace(/<Relationship\b([^>]*)\/>/g, function(_, attrText) {
    const a = attrs(attrText);
    if (a.Id && a.Target) rels[a.Id] = a.Target.indexOf('xl/') === 0 ? a.Target : 'xl/' + a.Target.replace(/^\//, '');
    return '';
  });
  let firstRel = '';
  workbook.replace(/<sheet\b([^>]*)\/>/g, function(_, attrText) {
    if (!firstRel) {
      const a = attrs(attrText);
      firstRel = a['r:id'] || '';
    }
    return '';
  });
  if (firstRel && rels[firstRel]) return rels[firstRel].replace(/\/\.[^/]+\//g, '/');
  const candidates = Object.keys(entries).filter(function(name) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(name); }).sort();
  return candidates[0] || '';
};

const parseWorksheetRows = function(xml, sharedStrings) {
  const rows = [];
  String(xml || '').replace(/<c\b([^>]*)>([\s\S]*?)<\/c>/g, function(_, attrText, cellXml) {
    const a = attrs(attrText);
    const ref = a.r || '';
    const rowIndex = parseInt(ref.replace(/[^0-9]/g, ''), 10) - 1;
    const colIndex = columnIndex(ref);
    if (!Number.isFinite(rowIndex) || rowIndex < 0 || colIndex < 0) return '';
    let value = '';
    const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
    if (a.t === 's' && vMatch) value = sharedStrings[Number(vMatch[1])] || '';
    else if (a.t === 'inlineStr') {
      const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      value = tMatch ? decodeXml(tMatch[1]) : '';
    } else if (vMatch) value = decodeXml(vMatch[1]);
    if (!rows[rowIndex]) rows[rowIndex] = [];
    rows[rowIndex][colIndex] = clean(value);
    return '';
  });
  return rows.filter(function(row) { return row && row.some(function(cell) { return clean(cell); }); });
};

const parseXlsxBuffer = function(buffer) {
  const entries = parseZipEntries(buffer);
  const worksheetPath = firstWorksheetPath(entries);
  if (!worksheetPath || !entries[worksheetPath]) throw new Error('未找到xlsx工作表');
  const sharedStrings = parseSharedStrings(entryText(entries, 'xl/sharedStrings.xml'));
  const rows = parseWorksheetRows(entryText(entries, worksheetPath), sharedStrings);
  return rows.filter(function(row, index) { return !(index === 0 && looksLikeHeader(row)); }).map(rowToStudent);
};

const importNormalizedRows = async function(req, rows) {
  if (!rows.length) { const err = new Error('未读取到宿生数据'); err.httpStatus = 400; throw err; }
  if (rows.length > 200) { const err = new Error('单次最多导入200名宿生'); err.httpStatus = 400; throw err; }
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
  return result;
};

const importStudents = async function(req, res) {
  try {
    const rows = Array.isArray(req.body && req.body.students) ? req.body.students.map(normalizeStudentPayload) : parseImportText(req.body && req.body.text);
    const result = await importNormalizedRows(req, rows);
    return response.success(res, result, '批量导入完成');
  } catch (err) {
    logger.error('批量导入宿生失败:', err);
    return response.error(res, err.message || '批量导入失败', err.httpStatus || 500);
  }
};

const importStudentsFile = async function(req, res) {
  try {
    if (!req.file || !Buffer.isBuffer(req.file.buffer)) return response.error(res, '请选择要导入的Excel文件', 400);
    const original = String(req.file.originalname || '').toLowerCase();
    const ext = path.extname(original);
    if (!['.xlsx', '.csv', '.txt', '.xls'].includes(ext)) return response.error(res, '仅支持xlsx、xls、csv或txt文件', 400);
    const rows = ext === '.xlsx' ? parseXlsxBuffer(req.file.buffer) : parseImportText(req.file.buffer.toString('utf8').replace(/<[^>]+>/g, '\t'));
    const result = await importNormalizedRows(req, rows);
    return response.success(res, result, '文件导入完成');
  } catch (err) {
    logger.error('文件导入宿生失败:', err);
    return response.error(res, err.message || '文件导入失败', err.httpStatus || 500);
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

module.exports = { createStudent, importStudents, importStudentsFile, updateStudent, updateStudentStatus, parseImportText, parseXlsxBuffer };
