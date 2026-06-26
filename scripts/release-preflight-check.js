const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const read = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }

function main() {
  const dockerfile = read('Dockerfile')
  const adminDockerfile = read('admin/Dockerfile')
  const compose = read('deploy/docker-compose.production.yml')
  const entrypoint = read('deploy/docker-entrypoint.sh')
  const gateway = read('deploy/nginx/gateway.conf')
  const deploy = read('deploy/scripts/deploy-blue-green.sh')
  const rollback = read('deploy/scripts/rollback-blue-green.sh')
  const releaseGate = read('deploy/scripts/release-gate.sh')
  const migration = read('deploy/scripts/migrate.sh')
  const routes = read('server/src/routes/ops.js')

  assert(/USER 10001:10001/.test(dockerfile), 'API image must run as a numeric non-root user')
  assert(/HEALTHCHECK/.test(dockerfile) && /ops\/live/.test(dockerfile), 'API image must have a liveness healthcheck')
  assert(/npm ci --omit=dev/.test(dockerfile), 'API dependencies must use deterministic production install')
  assert(/org\.opencontainers\.image\.revision/.test(dockerfile), 'API image must include OCI revision metadata')
  assert(/nginx-unprivileged/.test(adminDockerfile), 'Admin image must use unprivileged nginx')
  assert(/npm ci/.test(adminDockerfile) && /npm run build/.test(adminDockerfile), 'Admin image must build deterministically')

  ;['mysql:', 'redis:', 'api-blue:', 'api-green:', 'scheduler:', 'migrate:', 'admin:', 'gateway:'].forEach(function(service) {
    assert(compose.includes(service), 'production topology must include ' + service)
  })
  assert(/read_only: true/.test(compose), 'application containers must use read-only root filesystems')
  assert(/no-new-privileges:true/.test(compose), 'application containers must prevent privilege escalation')
  assert(/cap_drop:[\s\S]*ALL/.test(compose), 'application containers must drop Linux capabilities')
  assert(/backend:[\s\S]*internal: true/.test(compose), 'database network must be internal')

  assert(/_FILE/.test(entrypoint), 'entrypoint must support file-mounted secrets')
  assert(/exec "\$@"/.test(entrypoint), 'entrypoint must preserve signal handling')
  assert(/proxy_set_header Upgrade/.test(gateway), 'gateway must support WebSocket upgrades')
  assert(/X-Forwarded-Proto/.test(gateway), 'gateway must preserve proxy protocol context')

  assert(/release-gate\.sh/.test(deploy), 'deployment must run the release gate')
  assert(/wait-ready\.sh/.test(deploy), 'deployment must wait for inactive slot readiness')
  assert(/nginx -t/.test(deploy) && /nginx -s reload/.test(deploy), 'traffic switch must validate and reload nginx')
  assert(/GIT_SHA/.test(deploy) && /ops\/version/.test(deploy), 'deployment must verify target build identity')
  assert(/PREVIOUS_SLOT/.test(deploy), 'deployment must persist rollback slot')
  assert(/Database migrations were not reversed/.test(rollback), 'rollback must explicitly preserve additive migrations')
  assert(/run-backup\.js/.test(releaseGate) && /verify-backup\.js/.test(releaseGate), 'release gate must create and verify a pre-release backup')
  assert(/apply-backup-recovery-migration/.test(migration), 'release migration sequence must include backup schema')
  assert(/router\.get\('\/version'/.test(routes), 'public version endpoint must be available')

  console.log('release-preflight-check passed')
}

try {
  main()
} catch (err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
}
