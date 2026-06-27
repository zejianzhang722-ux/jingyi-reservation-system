process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_DB = 'true'
process.env.MYSQL_HOST = '127.0.0.1'
process.env.MYSQL_PORT = '1'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const uploadService = require('../server/src/services/secureUploadService')
const adminScope = require('../server/src/middleware/adminScope')

function pngChunk(type, data) {
  const payload = data || Buffer.alloc(0)
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  payload.copy(chunk, 8)
  chunk.writeUInt32BE(0, 8 + payload.length)
  return chunk
}

function samplePng() {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2, 0)
  ihdr.writeUInt32BE(3, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0<script>alert(1)</script>')),
    pngChunk('IDAT', Buffer.from([0x00])),
    pngChunk('IEND')
  ])
}

function sampleJpeg() {
  const app1Payload = Buffer.from('Exif\0\0malicious-metadata')
  const app1 = Buffer.alloc(4 + app1Payload.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(app1Payload.length + 2, 2)
  app1Payload.copy(app1, 4)

  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    0x00, 0x03,
    0x00, 0x02,
    0x01, 0x01, 0x11, 0x00
  ])
  const sos = Buffer.from([
    0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00
  ])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from([0x00, 0xff, 0xd9])])
}

async function main() {
  const png = samplePng()
  assert.strictEqual(uploadService.detectType(png), 'png', 'PNG signature must be detected')
  const sanitizedPng = uploadService.sanitizeImage({
    buffer: png,
    originalname: 'avatar.png',
    mimetype: 'image/png'
  })
  assert.strictEqual(sanitizedPng.width, 2)
  assert.strictEqual(sanitizedPng.height, 3)
  assert.strictEqual(sanitizedPng.buffer.includes(Buffer.from('tEXt')), false, 'PNG text metadata must be removed')
  assert.strictEqual(sanitizedPng.buffer.includes(Buffer.from('<script>')), false, 'embedded script text must be removed')

  const jpeg = sampleJpeg()
  assert.strictEqual(uploadService.detectType(jpeg), 'jpeg', 'JPEG signature must be detected')
  const sanitizedJpeg = uploadService.sanitizeImage({
    buffer: jpeg,
    originalname: 'photo.jpg',
    mimetype: 'image/jpeg'
  })
  assert.strictEqual(sanitizedJpeg.width, 2)
  assert.strictEqual(sanitizedJpeg.height, 3)
  assert.strictEqual(sanitizedJpeg.extension, '.jpg')
  assert.strictEqual(sanitizedJpeg.buffer.includes(Buffer.from('Exif')), false, 'JPEG EXIF metadata must be removed')

  const miniappJpeg = uploadService.sanitizeImage({
    buffer: jpeg,
    originalname: 'wxfile.jpeg',
    mimetype: 'application/octet-stream'
  })
  assert.strictEqual(miniappJpeg.mime, 'image/jpeg', 'miniapp JPEG uploads with generic multipart MIME must be accepted')

  const extensionlessMiniappJpeg = uploadService.sanitizeImage({
    buffer: jpeg,
    originalname: 'tmp_abcdef',
    mimetype: 'application/octet-stream'
  })
  assert.strictEqual(extensionlessMiniappJpeg.extension, '.jpg', 'extensionless miniapp JPEG temp files must be sanitized to jpg')

  const miniappPng = uploadService.sanitizeImage({
    buffer: png,
    originalname: 'tmp_png_upload',
    mimetype: 'application/octet-stream'
  })
  assert.strictEqual(miniappPng.extension, '.png', 'extensionless miniapp PNG temp files must still be accepted')

  let mismatch = null
  try {
    uploadService.sanitizeImage({ buffer: png, originalname: 'avatar.jpg', mimetype: 'image/jpeg' })
  } catch (err) {
    mismatch = err
  }
  assert(mismatch && mismatch.code === 'UPLOAD_EXTENSION_MISMATCH', 'content and extension mismatch must be rejected')

  let doubleExtension = null
  try {
    uploadService.sanitizeImage({ buffer: png, originalname: 'avatar.php.png', mimetype: 'image/png' })
  } catch (err) {
    doubleExtension = err
  }
  assert(doubleExtension && doubleExtension.code === 'UPLOAD_DOUBLE_EXTENSION', 'dangerous double extension must be rejected')

  let svg = null
  try {
    uploadService.sanitizeImage({
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      originalname: 'avatar.svg',
      mimetype: 'image/svg+xml'
    })
  } catch (err) {
    svg = err
  }
  assert(svg && svg.code === 'UPLOAD_TYPE_UNSUPPORTED', 'SVG and active document formats must be rejected')

  assert.strictEqual(adminScope.assertBuilding({ isGlobal: true, buildingId: null }, 999), true, 'super administrator scope must be global')
  assert.strictEqual(adminScope.assertBuilding({ isGlobal: false, buildingId: 2 }, 2), true, 'administrator must access own building')
  assert.strictEqual(adminScope.assertBuilding({ isGlobal: false, buildingId: 2 }, 3), false, 'administrator must not access another building')

  const root = path.join(__dirname, '..')
  const source = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
  const appSource = source('server/src/app.js')
  const mediaSource = source('server/src/routes/media.js')
  const userRoutes = source('server/src/routes/user.js')
  const adminRoutes = source('server/src/routes/admin.js')
  const auditRoutes = source('server/src/routes/audit.js')
  const statsRoutes = source('server/src/routes/stats.js')
  const posterRoutes = source('server/src/routes/poster.js')
  const configSource = source('server/src/config/index.js')
  const profileSource = source('miniapp/pages/profile/profile.js')
  const authSource = source('miniapp/utils/auth.js')

  assert(!/express\.static\(uploadsDir/.test(appSource), 'raw upload directory must not be served with unrestricted express.static')
  assert(/app\.use\('\/uploads', mediaRouter\)/.test(appSource), 'sanitized media router must serve public images')
  assert(/Content-Security-Policy/.test(mediaSource) && /nosniff/.test(mediaSource), 'media responses must set restrictive security headers')
  assert(/secureUploadService\.imageUpload\('avatar'/.test(userRoutes), 'avatar upload must use the secure image pipeline')
  assert(/normalizeAssetUrl/.test(authSource) && /\/uploads\//.test(authSource), 'miniapp must normalize uploaded relative media URLs to absolute server URLs')
  assert(/applyUploadedAvatar/.test(profileSource) && !/that\.loadUserInfo\(\)\s*\n\s*}/.test(profileSource), 'avatar upload should update local profile immediately without stale reload overwrite')
  assert(/requireAdmin, adminScope\.loadAdminScope, scopedQueryController\.users/.test(userRoutes), 'user listing must require administrator scope')
  assert(/forceBuildingQuery/.test(adminRoutes) && /roomFromParam/.test(adminRoutes), 'room administration must apply building scope')
  assert(/reservationBatchFromBody/.test(auditRoutes), 'batch audit must validate every reservation building')
  assert(/scopedStatsController/.test(statsRoutes), 'statistics must use scoped controller')
  assert(/posterFromParam/.test(posterRoutes), 'poster review must apply user building scope')
  assert(!/jingyi-reservation-jwt-secret-2026-dev/.test(configSource), 'legacy JWT default must be removed')
  assert(!/wx_test_secret/.test(configSource), 'legacy WeChat default must be removed')
  assert(!/password:\s*process\.env\.MYSQL_PASSWORD\s*\|\|\s*'123456'/.test(configSource), 'legacy database password default must be removed')

  console.log('security-hardening-check passed')
}

main().then(function() {
  process.exit(0)
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
