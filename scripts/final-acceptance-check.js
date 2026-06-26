const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const requiredFiles = [
  'README.md',
  'docs/engineering-roadmap.md',
  'docs/api-reference.md',
  'docs/data-dictionary.md',
  'docs/user-guide.md',
  'docs/final-acceptance-checklist.md',
  'docs/performance-capacity-runbook.md',
  'docs/container-release-runbook.md',
  'docs/backup-recovery-dr-runbook.md',
  'deploy/production.env.example',
  '.github/workflows/performance-capacity.yml'
]

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

function main() {
  requiredFiles.forEach(function(relative) {
    assert(fs.existsSync(path.join(root, relative)), 'required final artifact is missing: ' + relative)
    assert(read(relative).trim().length > 100, 'required final artifact is unexpectedly short: ' + relative)
  })

  const packageJson = JSON.parse(read('package.json'))
  assert.strictEqual(packageJson.version, '1.0.0', 'formal release version must be 1.0.0')
  ;['check:performance', 'check:performance:mysql', 'check:performance:http', 'check:acceptance', 'db:migrate:performance'].forEach(function(name) {
    assert(packageJson.scripts[name], 'package script is missing: ' + name)
  })

  const migration = read('deploy/scripts/migrate.sh')
  ;[
    'apply-reservation-consistency-migration',
    'apply-notification-outbox-migration',
    'apply-observability-audit-migration',
    'apply-backup-recovery-migration',
    'apply-performance-indexes-migration',
    'production-data-readiness-check'
  ].forEach(function(name) {
    assert(migration.includes(name), 'release migration chain is missing: ' + name)
  })

  const workflow = read('.github/workflows/performance-capacity.yml')
  assert(workflow.includes('mysql-performance-index-check'), 'performance workflow must verify database plans')
  assert(workflow.includes('http-performance-smoke'), 'performance workflow must run the HTTP smoke')
  assert(workflow.includes('performance-capacity-evidence'), 'performance workflow must preserve evidence')

  const roadmap = read('docs/engineering-roadmap.md')
  assert(/第十阶段[\s\S]*已完成/.test(roadmap), 'roadmap must mark stage ten complete')
  assert(!/\| 待完成 \|/.test(roadmap), 'roadmap must not contain unfinished stages')

  const readme = read('README.md')
  ;['api-reference.md', 'data-dictionary.md', 'user-guide.md', 'final-acceptance-checklist.md'].forEach(function(file) {
    assert(readme.includes(file), 'README must link final document: ' + file)
  })

  console.log('final-acceptance-check passed')
}

try {
  main()
} catch (err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
}
