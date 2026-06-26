const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const metricsService = require('./metricsService');
const auditHash = require('../utils/auditHash');

const ADMIN_ROLES = new Set(['admin', 'super_admin', 'counselor']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEY_PATTERN = /(password|passwd|secret|token|authorization|cookie|session|openid|session_key|credential|private[_-]?key)/i;
const MAX_METADATA_BYTES = 12000;
const AUDIT_APPEND_LOCK = 'jingyi_audit_chain_append';

const truncate = function(value, max) {
  const text = String(value === undefined || value === null ? '' : value);
  return text.length > max ? text.slice(0, max) : text;
};

const sanitize = function(value, depth) {
  const level = Number(depth || 0);
  if (level > 5) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return truncate(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 30).map(function(item) { return sanitize(item, level + 1); });
  }
  if (typeof value === 'object') {
    const result = {};
    Object.keys(value).slice(0, 80).forEach(function(key) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(value[key], level + 1);
    });
    return result;
  }
  return truncate(value, 500);
};

const boundedMetadata = function(value) {
  const sanitized = sanitize(value, 0) || {};
  const text = JSON.stringify(sanitized);
  if (Buffer.byteLength(text, 'utf8') <= MAX_METADATA_BYTES) return sanitized;
  return {
    truncated: true,
    preview: truncate(text, MAX_METADATA_BYTES - 100)
  };
};

const dbTimestamp = function(date) {
  const source = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return source.toISOString().slice(0, 19).replace('T', ' ');
};

const hashIp = function(value) {
  const ip = String(value || '').trim();
  if (!ip) return '';
  const salt = process.env.AUDIT_IP_HASH_SALT || 'development-only-audit-ip-hash-salt';
  return crypto.createHash('sha256').update(salt + ':' + ip).digest('hex');
};

const outcomeForStatus = function(statusCode) {
  const status = Number(statusCode || 0);
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'client_error';
  return 'success';
};

const normalizePath = function(req) {
  const base = req && req.baseUrl ? req.baseUrl : '';
  const route = req && req.route && req.route.path ? req.route.path : '';
  const fallback = req && (req.path || req.originalUrl || req.url) ? (req.path || req.originalUrl || req.url) : '/';
  return truncate((base + route) || String(fallback).split('?')[0], 255);
};

const actionForRequest = function(req) {
  const method = truncate(req && req.method ? req.method.toUpperCase() : 'UNKNOWN', 10);
  const path = normalizePath(req)
    .replace(/^\/api\/v\d+\//, '')
    .replace(/[^A-Za-z0-9/:._-]/g, '_')
    .replace(/\/:/g, '_')
    .replace(/\//g, '.');
  return truncate('http.' + method.toLowerCase() + '.' + path, 100);
};

const targetForRequest = function(req) {
  const path = normalizePath(req).replace(/^\/api\/v\d+\//, '');
  const segments = path.split('/').filter(Boolean);
  const first = segments[0] === 'admin' && segments[1] ? segments[1] : (segments[0] || 'system');
  const rawId = req && req.params ? (req.params.id || req.params.reservationId || req.params.roomId || null) : null;
  const numeric = rawId !== null && rawId !== undefined && /^\d+$/.test(String(rawId)) ? Number(rawId) : null;
  return { table: truncate(first, 50), id: numeric };
};

const requestMetadata = function(req) {
  return boundedMetadata({
    params: req && req.params ? req.params : {},
    query: req && req.query ? req.query : {},
    body: req && req.body ? req.body : {},
    contentType: req && req.headers ? req.headers['content-type'] || '' : '',
    contentLength: req && req.headers ? req.headers['content-length'] || '' : ''
  });
};

const normalizeEvent = function(event) {
  const item = event || {};
  const createdAt = auditHash.normalizeCreatedAt(item.createdAt || dbTimestamp());
  return {
    operator_id: item.operatorId === undefined || item.operatorId === null ? null : Number(item.operatorId),
    request_id: truncate(item.requestId || crypto.randomUUID(), 64),
    actor_role: truncate(item.actorRole || 'system', 32),
    action: truncate(item.action || 'unknown', 100),
    target_table: truncate(item.targetTable || '', 50),
    target_id: item.targetId === undefined || item.targetId === null ? null : Number(item.targetId),
    description: truncate(item.description || '', 500),
    method: truncate(item.method || '', 10),
    path: truncate(item.path || '', 255),
    status_code: Number(item.statusCode || 0),
    outcome: item.outcome || outcomeForStatus(item.statusCode),
    ip_hash: truncate(item.ipHash || hashIp(item.ip), 64),
    user_agent: truncate(item.userAgent || '', 255),
    metadata: boundedMetadata(item.metadata || {}),
    created_at: createdAt
  };
};

const appendMock = function(event) {
  const tables = require('../config/mock-db').__tables;
  if (!tables.operation_logs) tables.operation_logs = [];
  const normalized = normalizeEvent(event);
  const hashedRows = tables.operation_logs.filter(function(row) { return !!row.entry_hash; });
  const previous = hashedRows.length ? hashedRows[hashedRows.length - 1] : null;
  normalized.id = tables.operation_logs.reduce(function(max, row) { return Math.max(max, Number(row.id || 0)); }, 0) + 1;
  normalized.prev_hash = previous ? previous.entry_hash : null;
  normalized.entry_hash = auditHash.computeEntryHash(normalized.prev_hash, normalized);
  tables.operation_logs.push(normalized);
  return Object.assign({}, normalized);
};

const appendMysql = async function(event) {
  const connection = await db.getConnection();
  db.assertTransactional(connection);
  const normalized = normalizeEvent(event);
  let locked = false;
  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?,5) AS acquired', [AUDIT_APPEND_LOCK]);
    locked = Number(lockRows[0] && lockRows[0].acquired) === 1;
    if (!locked) {
      const err = new Error('无法获取审计哈希链写入锁');
      err.code = 'AUDIT_APPEND_LOCK_TIMEOUT';
      throw err;
    }
    await connection.beginTransaction();
    const [previousRows] = await connection.query(
      'SELECT id, entry_hash FROM operation_logs WHERE entry_hash IS NOT NULL ORDER BY id DESC LIMIT 1 FOR UPDATE'
    );
    normalized.prev_hash = previousRows.length ? previousRows[0].entry_hash : null;
    normalized.entry_hash = auditHash.computeEntryHash(normalized.prev_hash, normalized);
    const [result] = await connection.execute(
      'INSERT INTO operation_logs (' +
      'operator_id,request_id,actor_role,action,target_table,target_id,description,method,path,status_code,outcome,ip_hash,user_agent,metadata,prev_hash,entry_hash,created_at' +
      ') VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [
        normalized.operator_id,
        normalized.request_id,
        normalized.actor_role,
        normalized.action,
        normalized.target_table,
        normalized.target_id,
        normalized.description,
        normalized.method,
        normalized.path,
        normalized.status_code,
        normalized.outcome,
        normalized.ip_hash,
        normalized.user_agent,
        JSON.stringify(normalized.metadata),
        normalized.prev_hash,
        normalized.entry_hash,
        normalized.created_at
      ]
    );
    await connection.commit();
    normalized.id = result.insertId;
    return normalized;
  } catch (err) {
    try { await connection.rollback(); } catch (rollbackErr) {}
    throw err;
  } finally {
    if (locked) {
      try { await connection.execute('SELECT RELEASE_LOCK(?)', [AUDIT_APPEND_LOCK]); } catch (releaseErr) {}
    }
    connection.release();
  }
};

const record = async function(event) {
  try {
    return db.isMock() ? appendMock(event) : await appendMysql(event);
  } catch (err) {
    metricsService.recordAuditFailure();
    logger.error('audit_trail_write_failed', {
      requestId: event && event.requestId,
      action: event && event.action,
      error: err && err.message,
      code: err && err.code
    });
    throw err;
  }
};

const shouldAuditRequest = function(req) {
  const method = String(req && req.method || '').toUpperCase();
  const role = req && req.user && req.user.role;
  const path = String(req && (req.originalUrl || req.url) || '');
  return MUTATING_METHODS.has(method) && ADMIN_ROLES.has(role) && !path.startsWith('/api/v1/ops');
};

const eventFromRequest = function(req, res) {
  const target = targetForRequest(req);
  return {
    operatorId: req.user && req.user.id,
    requestId: req.requestId,
    actorRole: req.user && req.user.role,
    action: actionForRequest(req),
    targetTable: target.table,
    targetId: target.id,
    description: truncate(String(req.method || '') + ' ' + normalizePath(req), 500),
    method: req.method,
    path: normalizePath(req),
    statusCode: res.statusCode,
    outcome: outcomeForStatus(res.statusCode),
    ip: req.ip || (req.socket && req.socket.remoteAddress) || '',
    userAgent: req.headers && req.headers['user-agent'],
    metadata: requestMetadata(req)
  };
};

const verifyRows = function(rows) {
  const allRows = (rows || []).slice().sort(function(a, b) { return Number(a.id) - Number(b.id); });
  const ordered = allRows.filter(function(row) { return !!row.entry_hash; });
  const problems = [];
  let previous = null;
  ordered.forEach(function(row, index) {
    const expected = auditHash.computeEntryHash(row.prev_hash, row);
    if (row.entry_hash !== expected) problems.push({ id: row.id, issue: 'entry_hash_mismatch' });
    if (index > 0 && row.prev_hash !== previous.entry_hash) {
      problems.push({ id: row.id, issue: 'chain_link_mismatch', expectedPrev: previous.entry_hash, actualPrev: row.prev_hash });
    }
    previous = row;
  });
  return {
    valid: problems.length === 0,
    checked: ordered.length,
    unhashed: allRows.length - ordered.length,
    firstId: ordered.length ? ordered[0].id : null,
    lastId: ordered.length ? ordered[ordered.length - 1].id : null,
    problems
  };
};

const verifyRecent = async function(limit) {
  const requested = Number(limit || 200);
  const safeLimit = Math.min(2000, Math.max(1, Math.floor(Number.isFinite(requested) ? requested : 200)));
  let rows;
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    rows = (tables.operation_logs || []).slice(-safeLimit);
  } else {
    const [result] = await db.query(
      'SELECT * FROM operation_logs ORDER BY id DESC LIMIT ' + safeLimit
    );
    rows = result.reverse();
  }
  return verifyRows(rows);
};

module.exports = {
  ADMIN_ROLES,
  MUTATING_METHODS,
  SENSITIVE_KEY_PATTERN,
  MAX_METADATA_BYTES,
  AUDIT_APPEND_LOCK,
  sanitize,
  boundedMetadata,
  dbTimestamp,
  hashIp,
  outcomeForStatus,
  normalizePath,
  actionForRequest,
  targetForRequest,
  requestMetadata,
  normalizeEvent,
  appendMock,
  appendMysql,
  record,
  shouldAuditRequest,
  eventFromRequest,
  verifyRows,
  verifyRecent
};
