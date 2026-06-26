const crypto = require('crypto');

const canonicalize = function(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce(function(result, key) {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
};

const stableStringify = function(value) {
  return JSON.stringify(canonicalize(value));
};

const normalizeCreatedAt = function(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const text = String(value).trim().replace('T', ' ').replace(/Z$/, '');
  return text.slice(0, 19);
};

const normalizeMetadata = function(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (err) { return { raw: value }; }
  }
  return value;
};

const hashPayload = function(row) {
  return {
    operatorId: row.operator_id === undefined ? (row.operatorId || null) : (row.operator_id || null),
    requestId: row.request_id === undefined ? (row.requestId || null) : (row.request_id || null),
    actorRole: row.actor_role === undefined ? (row.actorRole || '') : (row.actor_role || ''),
    action: row.action || '',
    targetTable: row.target_table === undefined ? (row.targetTable || '') : (row.target_table || ''),
    targetId: row.target_id === undefined ? (row.targetId || null) : (row.target_id || null),
    description: row.description || '',
    method: row.method || '',
    path: row.path || '',
    statusCode: Number(row.status_code === undefined ? (row.statusCode || 0) : (row.status_code || 0)),
    outcome: row.outcome || '',
    ipHash: row.ip_hash === undefined ? (row.ipHash || '') : (row.ip_hash || ''),
    userAgent: row.user_agent === undefined ? (row.userAgent || '') : (row.user_agent || ''),
    metadata: normalizeMetadata(row.metadata),
    createdAt: normalizeCreatedAt(row.created_at === undefined ? row.createdAt : row.created_at)
  };
};

const computeEntryHash = function(previousHash, row) {
  const previous = String(previousHash || '');
  return crypto.createHash('sha256').update(previous + '\n' + stableStringify(hashPayload(row))).digest('hex');
};

module.exports = {
  canonicalize,
  stableStringify,
  normalizeCreatedAt,
  normalizeMetadata,
  hashPayload,
  computeEntryHash
};
