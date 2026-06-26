const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

const MAGIC = Buffer.from('JYBKUP01', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

const parseKey = function(value) {
  const text = String(value || '').trim();
  if (!text) {
    const err = new Error('缺少BACKUP_ENCRYPTION_KEY');
    err.code = 'BACKUP_ENCRYPTION_KEY_REQUIRED';
    throw err;
  }
  let key;
  if (/^[0-9a-f]{64}$/i.test(text)) key = Buffer.from(text, 'hex');
  else {
    try { key = Buffer.from(text, 'base64'); } catch (err) { key = null; }
  }
  if (!key || key.length !== 32) {
    const err = new Error('BACKUP_ENCRYPTION_KEY必须为32字节Base64或64位十六进制值');
    err.code = 'BACKUP_ENCRYPTION_KEY_INVALID';
    throw err;
  }
  return key;
};

const sha256File = async function(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
};

const encryptFile = async function(inputPath, outputPath, keyValue) {
  const key = parseKey(keyValue);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  output.write(MAGIC);
  output.write(iv);
  await pipeline(fs.createReadStream(inputPath), cipher, output);
  const tag = cipher.getAuthTag();
  fs.appendFileSync(outputPath, tag, { mode: 0o600 });
  return { iv: iv.toString('hex'), algorithm: 'aes-256-gcm', sizeBytes: fs.statSync(outputPath).size };
};

const decryptFile = async function(inputPath, outputPath, keyValue) {
  const key = parseKey(keyValue);
  const stats = fs.statSync(inputPath);
  const headerBytes = MAGIC.length + IV_BYTES;
  if (stats.size <= headerBytes + TAG_BYTES) {
    const err = new Error('备份文件长度无效');
    err.code = 'BACKUP_FILE_INVALID';
    throw err;
  }
  const fd = fs.openSync(inputPath, 'r');
  const header = Buffer.alloc(headerBytes);
  fs.readSync(fd, header, 0, header.length, 0);
  const tag = Buffer.alloc(TAG_BYTES);
  fs.readSync(fd, tag, 0, tag.length, stats.size - TAG_BYTES);
  fs.closeSync(fd);
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    const err = new Error('备份文件魔数无效');
    err.code = 'BACKUP_MAGIC_INVALID';
    throw err;
  }
  const iv = header.subarray(MAGIC.length);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const input = fs.createReadStream(inputPath, {
    start: headerBytes,
    end: stats.size - TAG_BYTES - 1
  });
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  try {
    await pipeline(input, decipher, output);
  } catch (err) {
    try { fs.unlinkSync(outputPath); } catch (unlinkErr) {}
    const wrapped = new Error('备份解密或完整性校验失败');
    wrapped.code = 'BACKUP_DECRYPT_FAILED';
    wrapped.cause = err;
    throw wrapped;
  }
  return { sizeBytes: fs.statSync(outputPath).size, algorithm: 'aes-256-gcm' };
};

module.exports = {
  MAGIC,
  IV_BYTES,
  TAG_BYTES,
  parseKey,
  sha256File,
  encryptFile,
  decryptFile
};
