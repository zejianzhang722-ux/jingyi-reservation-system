const fs = require('fs')
const path = require('path')

const baseUrl = String(process.env.PERF_BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '')
const studentToken = String(process.env.PERF_STUDENT_TOKEN || '')
const adminToken = String(process.env.PERF_ADMIN_TOKEN || '')
const p95LimitMs = Math.max(100, Number(process.env.PERF_HTTP_P95_LIMIT_MS || 1500))

function percentile(values, ratio) {
  const sorted = values.slice().sort(function(a, b) { return a - b })
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

async function runRequest(definition) {
  const headers = { Accept: 'application/json' }
  if (definition.token) headers.Authorization = 'Bearer ' + definition.token
  if (definition.body) headers['Content-Type'] = 'application/json'
  const started = process.hrtime.bigint()
  try {
    const response = await fetch(baseUrl + definition.path, {
      method: definition.method || 'GET',
      headers,
      body: definition.body ? JSON.stringify(definition.body) : undefined
    })
    await response.arrayBuffer()
    return {
      name: definition.name,
      status: response.status,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      ok: response.status >= 200 && response.status < 400
    }
  } catch (err) {
    return {
      name: definition.name,
      status: 0,
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      ok: false,
      error: err.message
    }
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const definitions = [
    { name: 'room-list', path: '/room' },
    { name: 'room-stats', path: '/room/stats' },
    { name: 'room-timeline', path: '/room/1/timeline?date=' + today },
    { name: 'announcements', path: '/room/announcements' }
  ]
  if (studentToken) {
    definitions.push({ name: 'reservation-list', path: '/reservation?page=1&pageSize=10', token: studentToken })
    definitions.push({ name: 'reservation-detail', path: '/reservation/1', token: studentToken })
    definitions.push({ name: 'checkin-status', path: '/checkin/status/1', token: studentToken })
    definitions.push({ name: 'notification-count', path: '/notification/unread-count', token: studentToken })
  }
  if (adminToken) {
    definitions.push({ name: 'pending-count', path: '/reservation/pending-count', token: adminToken })
    definitions.push({ name: 'pending-list', path: '/reservation/pending', token: adminToken })
    definitions.push({ name: 'stats-dashboard', path: '/stats/dashboard', token: adminToken })
    definitions.push({ name: 'stats-peak-hours', path: '/stats/peak-hours', token: adminToken })
  }

  const tasks = []
  for (let round = 0; round < 4; round += 1) {
    definitions.forEach(function(definition) { tasks.push(runRequest(definition)) })
  }
  const started = Date.now()
  const results = await Promise.all(tasks)
  const elapsedMs = Date.now() - started
  const durations = results.map(function(item) { return item.durationMs })
  const failures = results.filter(function(item) { return !item.ok })
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    requests: results.length,
    failures: failures.length,
    errorRate: results.length ? failures.length / results.length : 0,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    maxMs: Math.max.apply(null, durations),
    approximateRequestsPerSecond: elapsedMs ? results.length / (elapsedMs / 1000) : 0,
    p95LimitMs,
    failureSamples: failures.slice(0, 10)
  }
  if (process.env.PERF_HTTP_REPORT_FILE) {
    fs.mkdirSync(path.dirname(process.env.PERF_HTTP_REPORT_FILE), { recursive: true })
    fs.writeFileSync(process.env.PERF_HTTP_REPORT_FILE, JSON.stringify(report, null, 2))
  }
  console.log(JSON.stringify(report, null, 2))
  if (failures.length) throw new Error('HTTP performance smoke had failed requests')
  if (report.p95Ms > p95LimitMs) throw new Error('HTTP p95 exceeded ' + p95LimitMs + 'ms')
  console.log('http-performance-smoke passed')
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
