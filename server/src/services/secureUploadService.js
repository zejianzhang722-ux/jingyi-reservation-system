const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const response = require('../utils/response');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALLOWED_TYPES = {
  png: { mime: 'image/png', aliases: ['image/png', 'application/octet-stream'], extensions: ['.png'] },
  jpeg: { mime: 'image/jpeg', aliases: ['image/jpeg', 'image/jpg', 'image/pjpeg', 'application/octet-stream'], extensions: ['.jpg', '.jpeg'] }
};
const KNOWN_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const DANGEROUS_EXTENSIONS = new Set([
  '.html', '.htm', '.svg', '.xml', '.js', '.mjs', '.cjs', '.php', '.jsp', '.asp', '.aspx',
  '.exe', '.dll', '.bat', '.cmd', '.sh', '.ps1', '.py', '.jar', '.com', '.scr'
]);
const MAX_DIMENSION = Number(process.env.UPLOAD_MAX_DIMENSION || 10000);
const MAX_PIXELS = Number(process.env.UPLOAD_MAX_PIXELS || 20000000);

const uploadError = function(message, status, code) {
  const err = new Error(message);
  err.httpStatus = status || 400;
  err.code = code || 'UPLOAD_INVALID';
  return err;
};

const detectType = function(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpeg';
  return null;
};

const isGenericMultipartMime = function(mime) {
  const value = String(mime || '').toLowerCase().trim();
  return value === '' || value === 'application/octet-stream' || value === 'binary/octet-stream';
};

const validateOriginalName = function(originalName, detectedType, declaredMime) {
  const original = String(originalName || '').trim();
  const normalized = original.replace(/\\/g, '/');
  const basename = path.basename(normalized).toLowerCase();
  if (original && basename !== normalized.split('/').pop().toLowerCase()) {
    throw uploadError('文件名包含非法路径', 400, 'UPLOAD_PATH_INVALID');
  }

  const expected = ALLOWED_TYPES[detectedType];
  if (!expected) throw uploadError('仅支持真实的PNG或JPEG图片', 400, 'UPLOAD_TYPE_UNSUPPORTED');

  const finalExtension = path.extname(basename);
  const parts = basename ? basename.split('.') : [];
  for (let index = 1; index < parts.length - 1; index += 1) {
    if (DANGEROUS_EXTENSIONS.has('.' + parts[index])) {
      throw uploadError('不允许使用危险的双扩展名', 400, 'UPLOAD_DOUBLE_EXTENSION');
    }
  }
  if (finalExtension && DANGEROUS_EXTENSIONS.has(finalExtension)) {
    throw uploadError('不允许使用危险的文件扩展名', 400, 'UPLOAD_EXTENSION_DANGEROUS');
  }
  if (finalExtension && !KNOWN_IMAGE_EXTENSIONS.has(finalExtension)) {
    throw uploadError('仅支持PNG或JPEG图片扩展名', 400, 'UPLOAD_EXTENSION_UNSUPPORTED');
  }
  if (!finalExtension && parts.some(function(part) { return DANGEROUS_EXTENSIONS.has('.' + part); })) {
    throw uploadError('不允许使用危险的文件名', 400, 'UPLOAD_DOUBLE_EXTENSION');
  }

  const mime = String(declaredMime || '').toLowerCase().trim();
  if (!isGenericMultipartMime(mime) && !expected.aliases.includes(mime)) {
    throw uploadError('文件MIME类型与图片内容不一致', 400, 'UPLOAD_MIME_MISMATCH');
  }
};

const validateDimensions = function(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw uploadError('无法识别图片尺寸', 400, 'UPLOAD_DIMENSIONS_INVALID');
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    throw uploadError('图片尺寸或像素总量超出限制', 413, 'UPLOAD_PIXEL_LIMIT');
  }
  return { width, height, pixels: width * height };
};

const sanitizePng = function(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw uploadError('PNG文件签名无效', 400, 'UPLOAD_SIGNATURE_INVALID');
  }
  const kept = [buffer.subarray(0, 8)];
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;
  const allowedChunks = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS']);

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (length > config.upload.maxSize || chunkEnd > buffer.length) {
      throw uploadError('PNG数据块长度无效', 400, 'UPLOAD_PNG_CHUNK_INVALID');
    }
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw uploadError('PNG数据块类型无效', 400, 'UPLOAD_PNG_CHUNK_INVALID');
    }
    if (!sawIHDR && type !== 'IHDR') {
      throw uploadError('PNG缺少有效IHDR头', 400, 'UPLOAD_PNG_STRUCTURE_INVALID');
    }
    if (type === 'IHDR') {
      if (sawIHDR || length !== 13) throw uploadError('PNG IHDR无效', 400, 'UPLOAD_PNG_STRUCTURE_INVALID');
      sawIHDR = true;
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    if (type === 'IDAT') sawIDAT = true;
    if (type === 'IEND') {
      if (length !== 0) throw uploadError('PNG IEND无效', 400, 'UPLOAD_PNG_STRUCTURE_INVALID');
      sawIEND = true;
    }
    if (allowedChunks.has(type)) kept.push(buffer.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  if (!sawIHDR || !sawIDAT || !sawIEND || offset !== buffer.length) {
    throw uploadError('PNG结构不完整或包含尾随数据', 400, 'UPLOAD_PNG_STRUCTURE_INVALID');
  }
  const dimensions = validateDimensions(width, height);
  return { buffer: Buffer.concat(kept), width: dimensions.width, height: dimensions.height, extension: '.png', mime: 'image/png' };
};

const isSofMarker = function(marker) {
  return [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
};

const sanitizeJpeg = function(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw uploadError('JPEG文件签名无效', 400, 'UPLOAD_SIGNATURE_INVALID');
  }
  const kept = [buffer.subarray(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawSos = false;
  let sawEoi = false;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) throw uploadError('JPEG标记无效', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
    const markerStart = offset;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) throw uploadError('JPEG标记不完整', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xd9) {
      kept.push(Buffer.from([0xff, 0xd9]));
      sawEoi = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(buffer.subarray(markerStart, offset));
      continue;
    }
    if (offset + 2 > buffer.length) throw uploadError('JPEG段长度缺失', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2) throw uploadError('JPEG段长度无效', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > buffer.length) throw uploadError('JPEG段超出文件边界', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');

    if (isSofMarker(marker)) {
      if (segmentLength < 7) throw uploadError('JPEG尺寸段无效', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
      height = buffer.readUInt16BE(offset + 3);
      width = buffer.readUInt16BE(offset + 5);
    }

    if (marker === 0xda) {
      sawSos = true;
      const eoi = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
      if (eoi < segmentEnd || eoi !== buffer.length - 2) {
        throw uploadError('JPEG扫描数据或结尾无效', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
      }
      kept.push(buffer.subarray(markerStart, buffer.length));
      sawEoi = true;
      offset = buffer.length;
      break;
    }

    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(buffer.subarray(markerStart, segmentEnd));
    offset = segmentEnd;
  }

  if (!sawSos || !sawEoi) throw uploadError('JPEG结构不完整', 400, 'UPLOAD_JPEG_STRUCTURE_INVALID');
  const dimensions = validateDimensions(width, height);
  return { buffer: Buffer.concat(kept), width: dimensions.width, height: dimensions.height, extension: '.jpg', mime: 'image/jpeg' };
};

const sanitizeImage = function(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) throw uploadError('请选择图片文件', 400, 'UPLOAD_FILE_REQUIRED');
  const detectedType = detectType(file.buffer);
  if (!detectedType) throw uploadError('仅支持真实的PNG或JPEG图片', 400, 'UPLOAD_TYPE_UNSUPPORTED');
  validateOriginalName(file.originalname, detectedType, file.mimetype);
  return detectedType === 'png' ? sanitizePng(file.buffer) : sanitizeJpeg(file.buffer);
};

const ensureUploadDirectory = async function() {
  const configured = path.resolve(__dirname, '..', '..', config.upload.dir);
  await fs.promises.mkdir(configured, { recursive: true, mode: 0o750 });
  return configured;
};

const persistSanitizedImage = async function(file, prefix) {
  const sanitized = sanitizeImage(file);
  const directory = await ensureUploadDirectory();
  const safePrefix = String(prefix || 'image').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 30) || 'image';
  const filename = safePrefix + '-' + crypto.randomUUID() + sanitized.extension;
  const destination = path.resolve(directory, filename);
  if (path.dirname(destination) !== directory) throw uploadError('文件存储路径无效', 400, 'UPLOAD_PATH_INVALID');
  await fs.promises.writeFile(destination, sanitized.buffer, { flag: 'wx', mode: 0o640 });
  return {
    filename,
    path: destination,
    size: sanitized.buffer.length,
    mimetype: sanitized.mime,
    width: sanitized.width,
    height: sanitized.height,
    url: '/uploads/' + filename
  };
};

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: config.upload.maxSize, fields: 20, fieldSize: 64 * 1024 }
});

const imageUpload = function(fieldName, prefix) {
  const single = uploader.single(fieldName);
  return function(req, res, next) {
    single(req, res, function(err) {
      if (err) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return response.error(res, err.code === 'LIMIT_FILE_SIZE' ? '文件大小超出限制' : '文件上传格式无效', status);
      }
      persistSanitizedImage(req.file, prefix).then(function(file) {
        req.secureFile = file;
        req.file = Object.assign({}, req.file, file);
        next();
      }).catch(function(uploadErr) {
        response.error(res, uploadErr.message || '文件上传失败', uploadErr.httpStatus || 400);
      });
    });
  };
};

const safePublicFilename = function(filename) {
  return /^[A-Za-z0-9_-]{1,80}\.(?:png|jpg)$/.test(String(filename || ''));
};

module.exports = {
  ALLOWED_TYPES,
  MAX_DIMENSION,
  MAX_PIXELS,
  detectType,
  validateOriginalName,
  validateDimensions,
  sanitizePng,
  sanitizeJpeg,
  sanitizeImage,
  persistSanitizedImage,
  imageUpload,
  safePublicFilename
};
