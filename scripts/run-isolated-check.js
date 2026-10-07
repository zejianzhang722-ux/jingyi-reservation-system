const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');

async function runIsolatedCheck(relative, options = {}) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) throw new Error('Invalid check path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-check-'));
  const env = { ...process.env, NODE_ENV: 'test', MOCK_DATA_DIR: directory,
    UPLOAD_DIR: path.join(directory, 'uploads'),
    MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', REDIS_HOST: '127.0.0.1', REDIS_PORT: '1',
    ENABLE_SCHEDULER: 'false', ALLOW_MOCK_DB: 'true', ALLOW_MOCK_REDIS: 'true', JWT_SECRET: 'isolated-comprehensive-test-secret', ...options.env };
  env.RUN_REAL_MIGRATION_CHECK = 'false';
  delete env.PERF_BASE_URL;
  delete env.PERF_STUDENT_TOKEN;
  delete env.PERF_ADMIN_TOKEN;
  delete env.BASE_URL;
  delete env.ADMIN_API_BASE_URL;
  let server;
  let serverOutput = '';
  let output = '';
  try {
    if (options.server) {
      const port = await new Promise((resolve, reject) => {
        const socket = net.createServer();
        socket.on('error', reject);
        socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); });
      });
      env.PORT = String(port);
      env.BASE_URL = 'http://127.0.0.1:' + port + '/api/v1';
      env.ADMIN_API_BASE_URL = env.BASE_URL;
      env.PERF_BASE_URL = env.BASE_URL;
      server = spawn(process.execPath, ['src/app.js'], { cwd: path.join(root, 'server'), env, windowsHide: true });
      server.stdout.on('data', chunk => { serverOutput += chunk; });
      server.stderr.on('data', chunk => { serverOutput += chunk; });
      let ready = false;
      for (let i = 0; i < 150; i++) {
        if (server.exitCode !== null) throw new Error('Test server exited: ' + serverOutput.slice(-2000));
        try { if ((await fetch(env.BASE_URL + '/health', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      if (!ready) throw new Error('Test server did not become ready: ' + serverOutput.slice(-3500));
    }
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [target], { cwd: root, env, windowsHide: true });
      const timer = setTimeout(() => { child.kill(); output += '\nCHECK TIMEOUT'; }, options.timeout || 120000);
      child.stdout.on('data', chunk => { output += chunk; if (options.stream) process.stdout.write(chunk); });
      child.stderr.on('data', chunk => { output += chunk; if (options.stream) process.stderr.write(chunk); });
      child.on('error', reject);
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: code === null ? 1 : code, signal, output }); });
    });
    return result;
  } finally {
    if (server && server.exitCode === null) {
      const closed = new Promise(resolve => server.once('close', resolve));
      server.kill();
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    // Keep isolated artifacts for diagnosis; never reset the running app's data.
  }
}
module.exports = { runIsolatedCheck };
if (require.main === module) {
  const relative = process.argv[2];
  runIsolatedCheck(relative, { server: true, stream: true }).then(result => { process.exitCode = result.code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
