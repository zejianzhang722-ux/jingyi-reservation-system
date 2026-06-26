const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const db = require('../config/database');
const logger = require('../config/logger');
const backupCrypto = require('../utils/backupCrypto');

const REQUIRED_TABLES = [
  'users', 'admins', 'rooms', 'reservations', 'reservation_slots', 'notifications',
  'notification_outbox', 'operation_logs', 'system_config'
];

const safeIdentifier = function(value, label) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_]+$/.test(text)) {
    const err = new Error((label || '数据库标识符') + '无效');
    err.code = 'BACKUP_IDENTIFIER_INVALID';
    throw err;
  }
  return text;
};

const ensureDirectory = function(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch (err) {}
  return directory;
};

const backupRoot = function() {
  return ensureDirectory(process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'data', 'backups'));
};

const uploadsRoot = function() {
  return process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
};

const mysqlEnvironment = function() {
  return Object.assign({}, process.env, { MYSQL_PWD: process.env.MYSQL_PASSWORD || '' });
};

const runCommand = function(command, args, options) {
  const settings = options || {};
  return new Promise(function(resolve, reject) {
    const child = spawn(command, args, {
      cwd: settings.cwd,
      env: settings.env || process.env,
      stdio: settings.stdinPath ? ['pipe', 'ignore', 'pipe'] : ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', function(chunk) {
      stderr += chunk.toString('utf8');
      if (stderr.length > 16000) stderr = stderr.slice(-16000);
    });
    if (settings.stdinPath) {
      const input = fs.createReadStream(settings.stdinPath);
      input.on('error', reject);
      input.pipe(child.stdin);
    }
    child.on('error', function(err) {
      err.code = err.code || 'BACKUP_COMMAND_START_FAILED';
      reject(err);
    });
    child.on('close', function(code, signal) {
      if (code === 0) return resolve({ code, signal, stderr });
      const err = new Error(command + '执行失败: ' + stderr.trim());
      err.code = 'BACKUP_COMMAND_FAILED';
      err.exitCode = code;
      err.signal = signal;
      err.stderr = stderr;
      reject(err);
    });
  });
};

const mysqlArgs = function() {
  return [
    '--host=' + (process.env.MYSQL_HOST || '127.0.0.1'),
    '--port=' + Number(process.env.MYSQL_PORT || 3306),
    '--user=' + (process.env.MYSQL_USER || 'root'),
    '--default-character-set=utf8mb4'
  ];
};

const backupId = function(date) {
  const timestamp = (date || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return timestamp + '-' + crypto.randomBytes(4).toString('hex');
};

const insertRun = async function(id, trigger, requestedBy) {
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    if (!tables.backup_runs) tables.backup_runs = [];
    const row = {
      id: tables.backup_runs.length + 1,
      backup_id: id,
      trigger_type: trigger,
      requested_by: requestedBy || null,
      status: 'running',
      started_at: new Date().toISOString()
    };
    tables.backup_runs.push(row);
    return row.id;
  }
  const [result] = await db.query(
    "INSERT INTO backup_runs (backup_id,trigger_type,requested_by,status,started_at) VALUES (?,?,?,'running',NOW())",
    [id, trigger, requestedBy || null]
  );
  return result.insertId;
};

const finishRun = async function(runId, status, result, error) {
  const details = result || {};
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    const row = (tables.backup_runs || []).find(function(item) { return Number(item.id) === Number(runId); });
    if (row) Object.assign(row, {
      status,
      file_name: details.fileName || null,
      size_bytes: details.sizeBytes || null,
      checksum_sha256: details.checksum || null,
      secondary_copied: details.secondaryCopied ? 1 : 0,
      error_message: error ? String(error.message || error).slice(0, 1000) : null,
      finished_at: new Date().toISOString()
    });
    return;
  }
  await db.query(
    'UPDATE backup_runs SET status=?,file_name=?,size_bytes=?,checksum_sha256=?,secondary_copied=?,error_message=?,finished_at=NOW() WHERE id=?',
    [
      status,
      details.fileName || null,
      details.sizeBytes || null,
      details.checksum || null,
      details.secondaryCopied ? 1 : 0,
      error ? String(error.message || error).slice(0, 1000) : null,
      runId
    ]
  );
};

const createDatabaseDump = async function(outputPath) {
  const database = safeIdentifier(process.env.MYSQL_DATABASE || 'jingyi_reservation', 'MYSQL_DATABASE');
  const args = mysqlArgs().concat([
    '--single-transaction',
    '--quick',
    '--routines',
    '--triggers',
    '--events',
    '--hex-blob',
    '--no-tablespaces',
    '--set-gtid-purged=OFF',
    '--result-file=' + outputPath,
    database
  ]);
  await runCommand(process.env.MYSQLDUMP_BIN || 'mysqldump', args, { env: mysqlEnvironment() });
  fs.chmodSync(outputPath, 0o600);
  return { database };
};

const createUploadsArchive = async function(outputPath) {
  const directory = uploadsRoot();
  if (!fs.existsSync(directory)) return { included: false, directory };
  await runCommand(process.env.TAR_BIN || 'tar', ['-czf', outputPath, '-C', directory, '.']);
  fs.chmodSync(outputPath, 0o600);
  return { included: true, directory };
};

const createManifest = async function(id, workspace, databaseInfo, uploadsInfo) {
  const databasePath = path.join(workspace, 'database.sql');
  const uploadsPath = path.join(workspace, 'uploads.tar.gz');
  const manifest = {
    format: 'jingyi-backup-v1',
    backupId: id,
    createdAt: new Date().toISOString(),
    sourceDatabase: databaseInfo.database,
    sourceEnvironment: process.env.NODE_ENV || 'development',
    components: {
      database: {
        file: 'database.sql',
        sizeBytes: fs.statSync(databasePath).size,
        sha256: await backupCrypto.sha256File(databasePath)
      },
      uploads: uploadsInfo.included ? {
        file: 'uploads.tar.gz',
        sizeBytes: fs.statSync(uploadsPath).size,
        sha256: await backupCrypto.sha256File(uploadsPath)
      } : null
    },
    requiredTables: REQUIRED_TABLES
  };
  fs.writeFileSync(path.join(workspace, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  return manifest;
};

const packageWorkspace = async function(workspace, outputPath, includeUploads) {
  const files = ['database.sql', 'manifest.json'];
  if (includeUploads) files.push('uploads.tar.gz');
  await runCommand(process.env.TAR_BIN || 'tar', ['-czf', outputPath, '-C', workspace].concat(files));
  fs.chmodSync(outputPath, 0o600);
};

const pruneBackups = async function(options) {
  const settings = options || {};
  const root = backupRoot();
  const maxAgeDays = Math.max(1, Number(settings.maxAgeDays || process.env.BACKUP_RETENTION_DAYS || 30));
  const minKeep = Math.max(1, Number(settings.minKeep || process.env.BACKUP_MIN_KEEP || 7));
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const files = fs.readdirSync(root)
    .filter(function(name) { return name.endsWith('.jybak'); })
    .map(function(name) {
      const full = path.join(root, name);
      return { name, full, mtimeMs: fs.statSync(full).mtimeMs };
    })
    .sort(function(a, b) { return b.mtimeMs - a.mtimeMs; });
  const removed = [];
  files.slice(minKeep).forEach(function(item) {
    if (item.mtimeMs >= cutoff) return;
    fs.unlinkSync(item.full);
    try { fs.unlinkSync(item.full + '.sha256'); } catch (err) {}
    removed.push(item.name);
  });
  return { scanned: files.length, removed, maxAgeDays, minKeep };
};

const copySecondary = function(filePath) {
  const secondary = String(process.env.BACKUP_SECONDARY_DIR || '').trim();
  if (!secondary) return false;
  ensureDirectory(secondary);
  const target = path.join(secondary, path.basename(filePath));
  fs.copyFileSync(filePath, target, fs.constants.COPYFILE_EXCL);
  fs.copyFileSync(filePath + '.sha256', target + '.sha256', fs.constants.COPYFILE_EXCL);
  return true;
};

const createBackup = async function(options) {
  const settings = options || {};
  const id = backupId();
  const runId = await insertRun(id, settings.trigger || 'manual', settings.requestedBy);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-backup-'));
  const packedPath = path.join(workspace, id + '.tar.gz');
  const outputPath = path.join(backupRoot(), id + '.jybak');
  let result = null;
  try {
    const databaseInfo = await createDatabaseDump(path.join(workspace, 'database.sql'));
    const uploadsInfo = await createUploadsArchive(path.join(workspace, 'uploads.tar.gz'));
    const manifest = await createManifest(id, workspace, databaseInfo, uploadsInfo);
    await packageWorkspace(workspace, packedPath, uploadsInfo.included);
    await backupCrypto.encryptFile(packedPath, outputPath, process.env.BACKUP_ENCRYPTION_KEY);
    const checksum = await backupCrypto.sha256File(outputPath);
    fs.writeFileSync(outputPath + '.sha256', checksum + '  ' + path.basename(outputPath) + '\n', { mode: 0o600 });
    const secondaryCopied = copySecondary(outputPath);
    result = {
      backupId: id,
      runId,
      fileName: path.basename(outputPath),
      filePath: outputPath,
      sizeBytes: fs.statSync(outputPath).size,
      checksum,
      secondaryCopied,
      manifest
    };
    await finishRun(runId, 'success', result, null);
    await pruneBackups();
    logger.info('backup_completed', {
      backupId: id,
      runId,
      fileName: result.fileName,
      sizeBytes: result.sizeBytes,
      secondaryCopied
    });
    return result;
  } catch (err) {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (unlinkErr) {}
    await finishRun(runId, 'failed', result, err).catch(function() {});
    logger.error('backup_failed', { backupId: id, runId, error: err.message, code: err.code });
    throw err;
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

const checksumFromSidecar = function(filePath) {
  const text = fs.readFileSync(filePath + '.sha256', 'utf8').trim();
  return text.split(/\s+/)[0];
};

const extractBundle = async function(filePath, workspace) {
  const expectedChecksum = checksumFromSidecar(filePath);
  const actualChecksum = await backupCrypto.sha256File(filePath);
  if (expectedChecksum !== actualChecksum) {
    const err = new Error('备份文件SHA-256校验失败');
    err.code = 'BACKUP_CHECKSUM_MISMATCH';
    throw err;
  }
  const packedPath = path.join(workspace, 'bundle.tar.gz');
  await backupCrypto.decryptFile(filePath, packedPath, process.env.BACKUP_ENCRYPTION_KEY);
  await runCommand(process.env.TAR_BIN || 'tar', ['-xzf', packedPath, '-C', workspace]);
  const manifestPath = path.join(workspace, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const err = new Error('备份清单缺失');
    err.code = 'BACKUP_MANIFEST_MISSING';
    throw err;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== 'jingyi-backup-v1') {
    const err = new Error('备份格式不受支持');
    err.code = 'BACKUP_FORMAT_UNSUPPORTED';
    throw err;
  }
  for (const component of Object.values(manifest.components || {})) {
    if (!component) continue;
    const componentPath = path.join(workspace, component.file);
    if (!fs.existsSync(componentPath)) throw new Error('备份组件缺失: ' + component.file);
    const hash = await backupCrypto.sha256File(componentPath);
    if (hash !== component.sha256) {
      const err = new Error('备份组件校验失败: ' + component.file);
      err.code = 'BACKUP_COMPONENT_CHECKSUM_MISMATCH';
      throw err;
    }
  }
  return { workspace, manifest, checksum: actualChecksum };
};

const verifyBackup = async function(filePath) {
  const resolved = path.resolve(filePath);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-verify-'));
  try {
    const extracted = await extractBundle(resolved, workspace);
    return {
      valid: true,
      fileName: path.basename(resolved),
      checksum: extracted.checksum,
      manifest: extracted.manifest
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

const restoreDatabase = async function(sqlPath, targetDatabase) {
  const target = safeIdentifier(targetDatabase, '恢复目标数据库');
  const source = safeIdentifier(process.env.MYSQL_DATABASE || 'jingyi_reservation', 'MYSQL_DATABASE');
  if (target === source && process.env.ALLOW_IN_PLACE_RESTORE !== 'true') {
    const err = new Error('默认禁止覆盖当前生产数据库');
    err.code = 'IN_PLACE_RESTORE_FORBIDDEN';
    throw err;
  }
  if (String(process.env.RESTORE_CONFIRM_DATABASE || '') !== target) {
    const err = new Error('RESTORE_CONFIRM_DATABASE必须与恢复目标数据库完全一致');
    err.code = 'RESTORE_CONFIRMATION_REQUIRED';
    throw err;
  }
  const createSql = 'CREATE DATABASE IF NOT EXISTS `' + target + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci';
  await runCommand(process.env.MYSQL_BIN || 'mysql', mysqlArgs().concat(['--execute=' + createSql]), { env: mysqlEnvironment() });
  await runCommand(process.env.MYSQL_BIN || 'mysql', mysqlArgs().concat([target]), {
    env: mysqlEnvironment(),
    stdinPath: sqlPath
  });
  return target;
};

const restoreUploads = async function(archivePath, targetDirectory) {
  const target = ensureDirectory(targetDirectory);
  await runCommand(process.env.TAR_BIN || 'tar', ['-xzf', archivePath, '-C', target]);
  return target;
};

const validateRestoredDatabase = async function(targetDatabase) {
  const target = safeIdentifier(targetDatabase, '恢复目标数据库');
  const args = mysqlArgs().concat([
    '--batch', '--skip-column-names',
    '--execute=SELECT table_name FROM information_schema.tables WHERE table_schema=\'' + target + '\''
  ]);
  return new Promise(function(resolve, reject) {
    const child = spawn(process.env.MYSQL_BIN || 'mysql', args, { env: mysqlEnvironment() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function(chunk) { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', function(chunk) { stderr += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', function(code) {
      if (code !== 0) return reject(new Error('恢复数据库校验失败: ' + stderr.trim()));
      const tables = stdout.split(/\r?\n/).map(function(item) { return item.trim(); }).filter(Boolean);
      const missing = REQUIRED_TABLES.filter(function(table) { return !tables.includes(table); });
      resolve({ ready: missing.length === 0, tables, missing });
    });
  });
};

const restoreBackup = async function(filePath, options) {
  if (process.env.ALLOW_RESTORE !== 'true') {
    const err = new Error('恢复操作未启用，请设置ALLOW_RESTORE=true');
    err.code = 'RESTORE_DISABLED';
    throw err;
  }
  const settings = options || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jingyi-restore-'));
  try {
    const extracted = await extractBundle(path.resolve(filePath), workspace);
    const targetDatabase = await restoreDatabase(path.join(workspace, 'database.sql'), settings.targetDatabase);
    let uploads = null;
    if (settings.restoreUploads && extracted.manifest.components.uploads) {
      uploads = await restoreUploads(
        path.join(workspace, extracted.manifest.components.uploads.file),
        settings.targetUploadsDirectory || path.join(workspace, 'restored-uploads')
      );
    }
    const validation = await validateRestoredDatabase(targetDatabase);
    if (!validation.ready) {
      const err = new Error('恢复后的数据库缺少必要数据表: ' + validation.missing.join(','));
      err.code = 'RESTORE_VALIDATION_FAILED';
      throw err;
    }
    logger.info('backup_restored', {
      backupId: extracted.manifest.backupId,
      targetDatabase,
      restoreUploads: !!uploads
    });
    return { restored: true, targetDatabase, uploadsDirectory: uploads, validation, manifest: extracted.manifest };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
};

const listBackups = async function(limit) {
  const max = Math.min(100, Math.max(1, Number(limit || 20)));
  if (db.isMock()) {
    const tables = require('../config/mock-db').__tables;
    return (tables.backup_runs || []).slice().reverse().slice(0, max);
  }
  const [rows] = await db.query('SELECT * FROM backup_runs ORDER BY id DESC LIMIT ' + max);
  return rows;
};

module.exports = {
  REQUIRED_TABLES,
  safeIdentifier,
  ensureDirectory,
  backupRoot,
  uploadsRoot,
  runCommand,
  mysqlArgs,
  backupId,
  createDatabaseDump,
  createUploadsArchive,
  createManifest,
  packageWorkspace,
  pruneBackups,
  createBackup,
  extractBundle,
  verifyBackup,
  restoreDatabase,
  restoreUploads,
  validateRestoredDatabase,
  restoreBackup,
  listBackups
};
