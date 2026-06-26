const STARTED_AT = Date.now();
const DURATION_BUCKETS_SECONDS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DATABASE_BUCKETS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
const MAX_ROUTE_SERIES = 100;
const MAX_DATABASE_OPERATIONS = 20;

const createDatabaseState = function() {
  return {
    total: 0,
    errors: 0,
    slow: 0,
    durationSecondsSum: 0,
    durationSecondsMax: 0,
    operations: {},
    durationBuckets: DATABASE_BUCKETS_SECONDS.map(function(le) { return { le, count: 0 }; })
  };
};

const state = {
  activeRequests: 0,
  totalRequests: 0,
  errorResponses: 0,
  durationSecondsSum: 0,
  durationSecondsMax: 0,
  statusClasses: {},
  methods: {},
  routes: new Map(),
  durationBuckets: DURATION_BUCKETS_SECONDS.map(function(le) { return { le, count: 0 }; }),
  database: createDatabaseState(),
  auditWriteFailures: 0,
  operationalAlerts: { warning: 0, critical: 0 }
};

const escapeLabel = function(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
};

const normalizePath = function(value) {
  const path = String(value || '/').split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':uuid')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
  return path.length > 180 ? path.slice(0, 180) : path;
};

const routeKey = function(req) {
  if (req && req.route && req.route.path) {
    return normalizePath(String(req.baseUrl || '') + String(req.route.path));
  }
  return normalizePath(req && (req.path || req.originalUrl));
};

const incrementObject = function(object, key) {
  const normalized = String(key || 'unknown');
  object[normalized] = Number(object[normalized] || 0) + 1;
};

const beginRequest = function() {
  state.activeRequests += 1;
  let completed = false;
  return function(req, statusCode, durationMs) {
    if (completed) return;
    completed = true;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
    state.totalRequests += 1;

    const status = Number(statusCode || 0);
    const statusClass = status >= 100 ? Math.floor(status / 100) + 'xx' : 'unknown';
    incrementObject(state.statusClasses, statusClass);
    incrementObject(state.methods, req && req.method);
    if (status >= 500) state.errorResponses += 1;

    const durationSeconds = Math.max(0, Number(durationMs || 0) / 1000);
    state.durationSecondsSum += durationSeconds;
    state.durationSecondsMax = Math.max(state.durationSecondsMax, durationSeconds);
    state.durationBuckets.forEach(function(bucket) {
      if (durationSeconds <= bucket.le) bucket.count += 1;
    });

    const key = (req && req.method ? req.method : 'UNKNOWN') + ' ' + routeKey(req);
    if (state.routes.has(key)) {
      state.routes.set(key, state.routes.get(key) + 1);
    } else if (state.routes.size < MAX_ROUTE_SERIES) {
      state.routes.set(key, 1);
    } else {
      state.routes.set('OTHER', Number(state.routes.get('OTHER') || 0) + 1);
    }
  };
};

const recordDatabaseQuery = function(operation, durationMs, options) {
  const settings = options || {};
  const durationSeconds = Math.max(0, Number(durationMs || 0) / 1000);
  state.database.total += 1;
  if (settings.error) state.database.errors += 1;
  if (settings.slow) state.database.slow += 1;
  state.database.durationSecondsSum += durationSeconds;
  state.database.durationSecondsMax = Math.max(state.database.durationSecondsMax, durationSeconds);
  state.database.durationBuckets.forEach(function(bucket) {
    if (durationSeconds <= bucket.le) bucket.count += 1;
  });
  const normalized = String(operation || 'other').toUpperCase().slice(0, 20);
  if (Object.prototype.hasOwnProperty.call(state.database.operations, normalized)) {
    state.database.operations[normalized] += 1;
  } else if (Object.keys(state.database.operations).length < MAX_DATABASE_OPERATIONS) {
    state.database.operations[normalized] = 1;
  } else {
    state.database.operations.OTHER = Number(state.database.operations.OTHER || 0) + 1;
  }
};

const recordAuditFailure = function() {
  state.auditWriteFailures += 1;
};

const recordOperationalAlert = function(severity) {
  const normalized = severity === 'critical' ? 'critical' : 'warning';
  state.operationalAlerts[normalized] += 1;
};

const snapshot = function() {
  const memory = process.memoryUsage();
  return {
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    activeRequests: state.activeRequests,
    totalRequests: state.totalRequests,
    errorResponses: state.errorResponses,
    errorRate: state.totalRequests ? state.errorResponses / state.totalRequests : 0,
    durationSecondsSum: state.durationSecondsSum,
    durationSecondsMax: state.durationSecondsMax,
    durationBuckets: state.durationBuckets.map(function(bucket) { return { le: bucket.le, count: bucket.count }; }),
    statusClasses: Object.assign({}, state.statusClasses),
    methods: Object.assign({}, state.methods),
    routes: Array.from(state.routes.entries()).map(function(entry) { return { route: entry[0], count: entry[1] }; }),
    database: {
      total: state.database.total,
      errors: state.database.errors,
      slow: state.database.slow,
      errorRate: state.database.total ? state.database.errors / state.database.total : 0,
      durationSecondsSum: state.database.durationSecondsSum,
      durationSecondsMax: state.database.durationSecondsMax,
      durationBuckets: state.database.durationBuckets.map(function(bucket) { return { le: bucket.le, count: bucket.count }; }),
      operations: Object.assign({}, state.database.operations)
    },
    auditWriteFailures: state.auditWriteFailures,
    operationalAlerts: Object.assign({}, state.operationalAlerts),
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external
    }
  };
};

const metricLine = function(name, labels, value) {
  const keys = Object.keys(labels || {});
  const labelText = keys.length
    ? '{' + keys.map(function(key) { return key + '="' + escapeLabel(labels[key]) + '"'; }).join(',') + '}'
    : '';
  return name + labelText + ' ' + Number(value || 0);
};

const toPrometheus = function(extra) {
  const snap = snapshot();
  const lines = [
    '# HELP jingyi_process_uptime_seconds Process uptime in seconds.',
    '# TYPE jingyi_process_uptime_seconds gauge',
    metricLine('jingyi_process_uptime_seconds', {}, snap.uptimeSeconds),
    '# HELP jingyi_process_resident_memory_bytes Resident memory size.',
    '# TYPE jingyi_process_resident_memory_bytes gauge',
    metricLine('jingyi_process_resident_memory_bytes', {}, snap.memory.rssBytes),
    '# HELP jingyi_http_requests_active Current active HTTP requests.',
    '# TYPE jingyi_http_requests_active gauge',
    metricLine('jingyi_http_requests_active', {}, snap.activeRequests),
    '# HELP jingyi_http_requests_total Total HTTP requests by status class.',
    '# TYPE jingyi_http_requests_total counter'
  ];

  Object.keys(snap.statusClasses).sort().forEach(function(statusClass) {
    lines.push(metricLine('jingyi_http_requests_total', { status_class: statusClass }, snap.statusClasses[statusClass]));
  });
  Object.keys(snap.methods).sort().forEach(function(method) {
    lines.push(metricLine('jingyi_http_requests_by_method_total', { method }, snap.methods[method]));
  });
  snap.routes.forEach(function(item) {
    lines.push(metricLine('jingyi_http_requests_by_route_total', { route: item.route }, item.count));
  });

  lines.push('# HELP jingyi_http_request_duration_seconds HTTP request duration histogram.');
  lines.push('# TYPE jingyi_http_request_duration_seconds histogram');
  snap.durationBuckets.forEach(function(bucket) {
    lines.push(metricLine('jingyi_http_request_duration_seconds_bucket', { le: bucket.le }, bucket.count));
  });
  lines.push(metricLine('jingyi_http_request_duration_seconds_bucket', { le: '+Inf' }, snap.totalRequests));
  lines.push(metricLine('jingyi_http_request_duration_seconds_sum', {}, snap.durationSecondsSum));
  lines.push(metricLine('jingyi_http_request_duration_seconds_count', {}, snap.totalRequests));

  lines.push('# HELP jingyi_database_queries_total Database queries by operation.');
  lines.push('# TYPE jingyi_database_queries_total counter');
  Object.keys(snap.database.operations).sort().forEach(function(operation) {
    lines.push(metricLine('jingyi_database_queries_total', { operation }, snap.database.operations[operation]));
  });
  lines.push('# HELP jingyi_database_query_errors_total Database query failures.');
  lines.push('# TYPE jingyi_database_query_errors_total counter');
  lines.push(metricLine('jingyi_database_query_errors_total', {}, snap.database.errors));
  lines.push('# HELP jingyi_database_slow_queries_total Queries exceeding the configured threshold.');
  lines.push('# TYPE jingyi_database_slow_queries_total counter');
  lines.push(metricLine('jingyi_database_slow_queries_total', {}, snap.database.slow));
  lines.push('# HELP jingyi_database_query_duration_seconds Database query duration histogram.');
  lines.push('# TYPE jingyi_database_query_duration_seconds histogram');
  snap.database.durationBuckets.forEach(function(bucket) {
    lines.push(metricLine('jingyi_database_query_duration_seconds_bucket', { le: bucket.le }, bucket.count));
  });
  lines.push(metricLine('jingyi_database_query_duration_seconds_bucket', { le: '+Inf' }, snap.database.total));
  lines.push(metricLine('jingyi_database_query_duration_seconds_sum', {}, snap.database.durationSecondsSum));
  lines.push(metricLine('jingyi_database_query_duration_seconds_count', {}, snap.database.total));

  lines.push('# HELP jingyi_audit_write_failures_total Audit persistence failures.');
  lines.push('# TYPE jingyi_audit_write_failures_total counter');
  lines.push(metricLine('jingyi_audit_write_failures_total', {}, snap.auditWriteFailures));
  lines.push('# HELP jingyi_operational_alerts_total Operational alerts emitted.');
  lines.push('# TYPE jingyi_operational_alerts_total counter');
  lines.push(metricLine('jingyi_operational_alerts_total', { severity: 'warning' }, snap.operationalAlerts.warning));
  lines.push(metricLine('jingyi_operational_alerts_total', { severity: 'critical' }, snap.operationalAlerts.critical));

  const gauges = (extra && extra.gauges) || [];
  gauges.forEach(function(gauge) {
    if (gauge.help) lines.push('# HELP ' + gauge.name + ' ' + gauge.help);
    lines.push('# TYPE ' + gauge.name + ' gauge');
    lines.push(metricLine(gauge.name, gauge.labels || {}, gauge.value));
  });
  return lines.join('\n') + '\n';
};

const resetForTests = function() {
  state.activeRequests = 0;
  state.totalRequests = 0;
  state.errorResponses = 0;
  state.durationSecondsSum = 0;
  state.durationSecondsMax = 0;
  state.statusClasses = {};
  state.methods = {};
  state.routes = new Map();
  state.durationBuckets = DURATION_BUCKETS_SECONDS.map(function(le) { return { le, count: 0 }; });
  state.database = createDatabaseState();
  state.auditWriteFailures = 0;
  state.operationalAlerts = { warning: 0, critical: 0 };
};

module.exports = {
  DURATION_BUCKETS_SECONDS,
  DATABASE_BUCKETS_SECONDS,
  MAX_ROUTE_SERIES,
  MAX_DATABASE_OPERATIONS,
  normalizePath,
  routeKey,
  beginRequest,
  recordDatabaseQuery,
  recordAuditFailure,
  recordOperationalAlert,
  snapshot,
  toPrometheus,
  resetForTests
};
