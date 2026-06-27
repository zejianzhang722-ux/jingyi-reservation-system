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
    pngChunk('tEXt', Buffer.from('Comment metadata')),
    pngChunk('IDAT', Buffer.from([0x00])),
    pngChunk('IEND')
  ])
}

function sampleJpeg() {
  const metadata = Buffer.from('Exif metadata')
  const app1 = Buffer.alloc(4 + metadata.length)
  app1[0] = 0xff
  app1[1] = 0xe1
  app1.writeUInt16BE(metadata.length + 2, 2)
  metadata.copy(app1, 4)
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00])
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos, Buffer.from([0x00, 0xff, 0xd9])])
}

async function main() {
  const png = samplePng()
  assert.strictEqual(uploadService.detectType(png), 'png')
  const sanitizedPng = uploadService.sanitizeImage({ buffer: png, originalname: 'avatar.png', mimetype: 'image/png' })
  assert.strictEqual(sanitizedPng.width, 2)
  assert.strictEqual(sanitizedPng.height, 3)
  assert.strictEqual(sanitizedPng.buffer.includes(Buffer.from('tEXt')), false)

  const jpeg = sampleJpeg()
  assert.strictEqual(uploadService.detectType(jpeg), 'jpeg')
  const sanitizedJpeg = uploadService.sanitizeImage({ buffer: jpeg, originalname: 'photo.jpg', mimetype: 'image/jpeg' })
  assert.strictEqual(sanitizedJpeg.width, 2)
  assert.strictEqual(sanitizedJpeg.height, 3)
  assert.strictEqual(sanitizedJpeg.extension, '.jpg')
  assert.strictEqual(sanitizedJpeg.buffer.includes(Buffer.from('Exif')), false)

  const miniappJpeg = uploadService.sanitizeImage({ buffer: jpeg, originalname: 'wxfile.jpeg', mimetype: 'application/octet-stream' })
  assert.strictEqual(miniappJpeg.mime, 'image/jpeg')

  const extensionlessMiniappJpeg = uploadService.sanitizeImage({ buffer: jpeg, originalname: 'tmp_abcdef', mimetype: 'application/octet-stream' })
  assert.strictEqual(extensionlessMiniappJpeg.extension, '.jpg')

  const miniappPng = uploadService.sanitizeImage({ buffer: png, originalname: 'tmp_png_upload', mimetype: 'application/octet-stream' })
  assert.strictEqual(miniappPng.extension, '.png')

  const misleadingExtension = uploadService.sanitizeImage({ buffer: png, originalname: 'wechat-temp.jpg', mimetype: 'application/octet-stream' })
  assert.strictEqual(misleadingExtension.extension, '.png')

  let doubleExtension = null
  try { uploadService.sanitizeImage({ buffer: png, originalname: 'avatar.php.png', mimetype: 'image/png' }) } catch (err) { doubleExtension = err }
  assert(doubleExtension && doubleExtension.code === 'UPLOAD_DOUBLE_EXTENSION')

  let svg = null
  try { uploadService.sanitizeImage({ buffer: Buffer.from('<svg></svg>'), originalname: 'avatar.svg', mimetype: 'image/svg+xml' }) } catch (err) { svg = err }
  assert(svg && svg.code === 'UPLOAD_TYPE_UNSUPPORTED')

  assert.strictEqual(adminScope.assertBuilding({ isGlobal: true, buildingId: null }, 999), true)
  assert.strictEqual(adminScope.assertBuilding({ isGlobal: false, buildingId: 2 }, 2), true)
  assert.strictEqual(adminScope.assertBuilding({ isGlobal: false, buildingId: 2 }, 3), false)

  const root = path.join(__dirname, '..')
  const source = function(relative) { return fs.readFileSync(path.join(root, relative), 'utf8') }
  const appSource = source('server/src/app.js')
  const mediaSource = source('server/src/routes/media.js')
  const userRoutes = source('server/src/routes/user.js')
  const avatarControllerSource = source('server/src/controllers/avatarController.js')
  const userControllerSource = source('server/src/controllers/userController.js')
  const authControllerSource = source('server/src/controllers/authController.js')
  const adminRoutes = source('server/src/routes/admin.js')
  const auditRoutes = source('server/src/routes/audit.js')
  const statsRoutes = source('server/src/routes/stats.js')
  const posterRoutes = source('server/src/routes/poster.js')
  const profileSource = source('miniapp/pages/profile/profile.js')
  const profileMarkup = source('miniapp/pages/profile/profile.wxml')
  const authSource = source('miniapp/utils/auth.js')

  assert(!/express\.static\(uploadsDir/.test(appSource))
  assert(/app\.use\('\/uploads', mediaRouter\)/.test(appSource))
  assert(/Content-Security-Policy/.test(mediaSource) && /nosniff/.test(mediaSource))
  assert(/secureUploadService\.imageUpload\('avatar'/.test(userRoutes))
  assert(/avatarController\.uploadAvatar/.test(userRoutes))
  assert(/devAvatarStore\.saveAvatar/.test(avatarControllerSource))
  assert(/devAvatarStore\.applyAvatar/.test(userControllerSource))
  assert(/devAvatarStore\.applyAvatar/.test(authControllerSource))
  assert(/normalizeAssetUrl/.test(authSource) && /\/uploads\//.test(authSource))
  assert(/avatarUploading/.test(profileSource) && /_localAvatarPreview/.test(profileSource))
  assert(/open-type="chooseAvatar"/.test(profileMarkup) && !/avatar-source-panel/.test(profileMarkup))
  assert(/requireAdmin, adminScope\.loadAdminScope, scopedQueryController\.users/.test(userRoutes))
  assert(/forceBuildingQuery/.test(adminRoutes) && /roomFromParam/.test(adminRoutes))
  assert(/reservationBatchFromBody/.test(auditRoutes))
  assert(/scopedStatsController/.test(statsRoutes))
  assert(/posterFromParam/.test(posterRoutes))

  console.log('security-hardening-check passed')
}

main().then(function() { process.exit(0) }).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
