const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-avatar-persistence-'))
const avatar = '/uploads/avatar-persistence-test.png'

function run(source) {
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: root,
    env: Object.assign({}, process.env, { MOCK_DATA_DIR: dataDir }),
    encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || '子进程执行失败')
  return result.stdout.trim()
}

try {
  run(`
    const db = require('./server/src/config/mock-db')
    db.query('UPDATE users SET avatar = ? WHERE id = ?', ['${avatar}', 1])
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  `)

  const output = run(`
    const db = require('./server/src/config/mock-db')
    db.query('SELECT avatar FROM users WHERE id = ?', [1])
      .then(([rows]) => process.stdout.write(String(rows[0] && rows[0].avatar || '')))
      .catch(() => process.exit(1))
  `)

  assert.strictEqual(output, avatar, '模拟数据模式重启后应保留已上传头像')
  console.log('mock-avatar-persistence-check passed')
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true })
}
