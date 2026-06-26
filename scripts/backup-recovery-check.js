process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'
process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const backupCrypto = require('../server/src/utils/backupCrypto')
const backupService = require('../server/src/services/backupService')
const dataRetentionService = require('../server/src/services/dataRetentionService')
const backupController = require('../server/src/controllers/backupController')
const productionConfigGuard = require('../server/src/services/productionConfigGuard')
const config = require('../server/src/config')

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-check-'))
  try {
    const source = path.join(workspace, 'source.txt')
    const encrypted = path.join(workspace, 'source.jybak')
    const restored = path.join(workspace, 'restored.txt')
    fs.writeFileSync(source, 'backup payload\n'.repeat(1000), { mode: 0o600 })

    assert.strictEqual(backupCrypto.parseKey(process.env.BACKUP_ENCRYPTION_KEY).length, 32)
    assert.throws(function() { backupCrypto.parseKey('weak') }, function(err) {
      return err && err.code === 'BACKUP_ENCRYPTION_KEY_INVALID'
    })

    await backupCrypto.encryptFile(source, encrypted, process.env.BACKUP_ENCRYPTION_KEY)
    await backupCrypto.decryptFile(encrypted, restored, process.env.BACKUP_ENCRYPTION_KEY)
    assert.strictEqual(fs.readFileSync(restored, 'utf8'), fs.readFileSync(source, 'utf8'), 'encrypted backup must round-trip')

    const tampered = Buffer.from(fs.readFileSync(encrypted))
    tampered[Math.floor(tampered.length / 2)] ^= 0xff
    fs.writeFileSync(encrypted, tampered)
    const tamperedOutput = path.join(workspace, 'tampered-output.txt')
    await assert.rejects(
      backupCrypto.decryptFile(encrypted, tamperedOutput, process.env.BACKUP_ENCRYPTION_KEY),
      function(err) { return err && err.code === 'BACKUP_DECRYPT_FAILED' }
    )

    assert.strictEqual(backupService.safeIdentifier('jingyi_restore_123'), 'jingyi_restore_123')
    assert.throws(function() { backupService.safeIdentifier('prod;DROP DATABASE prod') }, /无效/)
    assert(/\.jybak$/.test(backupController.safeBackupPath('20260626T000000Z-aabbccdd.jybak')))
    assert.throws(function() { backupController.safeBackupPath('../../etc/passwd') }, /无效/)

    const policy = dataRetentionService.safePolicy('operation_logs')
    const cutoff = dataRetentionService.cutoffDate(policy, new Date('2026-06-26T00:00:00Z'))
    assert.strictEqual(cutoff.days, 365)
    assert.strictEqual(cutoff.value.slice(0, 10), '2025-06-26')
    assert.throws(function() { dataRetentionService.safePolicy('users') }, /不支持归档/)

    const oldEnvironment = process.env.NODE_ENV
    const oldValues = {
      JWT_SECRET: process.env.JWT_SECRET,
      MYSQL_PASSWORD: process.env.MYSQL_PASSWORD,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD,
      OPS_MONITOR_TOKEN: process.env.OPS_MONITOR_TOKEN,
      AUDIT_IP_HASH_SALT: process.env.AUDIT_IP_HASH_SALT,
      BACKUP_DIR: process.env.BACKUP_DIR,
      BACKUP_SECONDARY_DIR: process.env.BACKUP_SECONDARY_DIR,
      ALLOW_WECHAT_DISABLED: process.env.ALLOW_WECHAT_DISABLED,
      ALLOW_INSECURE_BASE_URL: process.env.ALLOW_INSECURE_BASE_URL
    }
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'j'.repeat(40)
    process.env.MYSQL_PASSWORD = 'mysql-strong-password'
    process.env.REDIS_PASSWORD = 'redis-strong-password'
    process.env.OPS_MONITOR_TOKEN = 'o'.repeat(40)
    process.env.AUDIT_IP_HASH_SALT = 'a'.repeat(40)
    process.env.ALLOW_WECHAT_DISABLED = 'true'
    process.env.ALLOW_INSECURE_BASE_URL = 'true'
    delete process.env.BACKUP_DIR
    assert.throws(function() { productionConfigGuard.validate() }, function(err) {
      return err && err.code === 'BACKUP_DIR_REQUIRED'
    })
    process.env.BACKUP_DIR = path.join(workspace, 'backups')
    delete process.env.BACKUP_SECONDARY_DIR
    assert.throws(function() { productionConfigGuard.validate() }, function(err) {
      return err && err.code === 'BACKUP_SECONDARY_DIR_REQUIRED'
    })
    process.env.BACKUP_SECONDARY_DIR = path.join(workspace, 'secondary')
    config.corsOrigins = ['https://admin.example.edu']
    config.baseUrl = 'https://api.example.edu'
    assert.strictEqual(productionConfigGuard.validate().valid, true)
    process.env.NODE_ENV = oldEnvironment
    Object.keys(oldValues).forEach(function(key) {
      if (oldValues[key] === undefined) delete process.env[key]
      else process.env[key] = oldValues[key]
    })

    const root = path.join(__dirname, '..')
    const read = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
    assert(/mysqldump/.test(read('server/src/services/backupService.js')), 'backup service must create a real database dump')
    assert(/aes-256-gcm/.test(read('server/src/utils/backupCrypto.js')), 'backup archive must use authenticated encryption')
    assert(/RESTORE_CONFIRM_DATABASE/.test(read('server/src/services/backupService.js')), 'restore must require explicit database confirmation')
    assert(/DATA_RETENTION_APPLY/.test(read('server/src/services/dataRetentionService.js')), 'retention deletion must require explicit apply mode')
    assert(/backupController\.create/.test(read('server/src/routes/admin.js')), 'administrator backup endpoint must use real backup controller')

    console.log('backup-recovery-check passed')
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
