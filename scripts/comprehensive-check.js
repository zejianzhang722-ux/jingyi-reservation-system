const fs = require('node:fs');
const path = require('node:path');
const { runIsolatedCheck } = require('./run-isolated-check');
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.runlogs', 'comprehensive-' + new Date().toISOString().replace(/[:.]/g, '-'));
const external = {
  'mysql-backup-recovery-check.js': 'Requires an isolated real MySQL test environment',
  'mysql-notification-outbox-check.js': 'Requires an isolated real MySQL test environment',
  'mysql-observability-audit-check.js': 'Requires an isolated real MySQL test environment',
  'mysql-performance-index-check.js': 'Requires an isolated real MySQL test environment',
  'mysql-reservation-concurrency-check.js': 'Requires an isolated real MySQL test environment',
  'reservation-migration-precheck.js': 'Requires an isolated real MySQL test environment',
  'production-data-readiness-check.js': 'Requires a real production-like MySQL and Redis test environment',
  'redis-runtime-integration-check.js': 'Requires an isolated real Redis test environment',
  'room-entry-runtime-check.cjs': 'Requires a logged-in WeChat DevTools automation session',
  'timeline-layout-runtime-check.cjs': 'Requires a logged-in WeChat DevTools automation session'
};
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  const files = ['scripts', 'server/tests'].flatMap(dir => fs.readdirSync(path.join(root, dir))
    .filter(name => /check\.(js|mjs|cjs)$/.test(name) && !['comprehensive-check.js', 'run-isolated-check.js'].includes(name))
    .map(name => dir + '/' + name)).concat('scripts/http-performance-smoke.js').sort();
  const filter = process.argv.slice(2);
  for (const file of files.filter(file => !filter.length || filter.some(term => file.includes(term)))) {
    const name = path.basename(file);
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    let result;
    if (external[name]) result = { file, status: 'unverified', reason: external[name] };
    else {
      console.log('RUN ' + file);
      const server = /process\.env\.(BASE_URL|ADMIN_API_BASE_URL|PERF_BASE_URL)/.test(source) && !/manages its own isolated|spawn\(|require\([^)]*src\/app/.test(source);
      try {
        const executed = await runIsolatedCheck(file, { server, timeout: 90000 });
        fs.writeFileSync(path.join(outputDir, name + '.log'), executed.output);
        const skipped = /^(?:\s*SKIP(?:PED)?\b|[^\n]*未配置[^\n]*跳过)/im.test(executed.output);
        const partial = /^\s*PARTIAL:/m.test(executed.output);
        result = { file, status: executed.code ? 'failed' : skipped ? 'unverified' : partial ? 'partial' : 'passed', exitCode: executed.code,
          detail: executed.output.slice(-2200) };
      } catch (error) { result = { file, status: 'failed', detail: error.message }; }
    }
    results.push(result);
    fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(result.status.toUpperCase() + ' ' + file + (result.status === 'failed' ? '\n' + result.detail.slice(-800) : ''));
  }
  const counts = results.reduce((map, item) => { map[item.status] = (map[item.status] || 0) + 1; return map; }, {});
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ counts, results }, null, 2));
  console.log(JSON.stringify({ counts, outputDir }));
  process.exitCode = counts.failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
