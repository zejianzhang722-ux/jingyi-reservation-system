const assert = require('assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const express = require('../server/node_modules/express')
const mediaRouter = require('../server/src/routes/media')

const uploadsDir = path.resolve(__dirname, '../server', require('../server/src/config').upload.dir)
const fixtureName = 'avatar-display-policy-test.png'
const fixturePath = path.join(uploadsDir, fixtureName)
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/atR9poAAAAASUVORK5CYII=',
  'base64'
)

async function main() {
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.writeFileSync(fixturePath, tinyPng)

  const app = express()
  app.use('/uploads', mediaRouter)
  const server = app.listen(0, '127.0.0.1')

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve)
      server.once('error', reject)
    })
    const address = server.address()
    const response = await new Promise((resolve, reject) => {
      http.get({
        host: '127.0.0.1',
        port: address.port,
        path: `/uploads/${fixtureName}`,
        agent: false,
        headers: { Connection: 'close' }
      }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject)
    })
    assert.strictEqual(response.status, 200, '头像文件应可访问')
    assert.strictEqual(response.headers['content-type'], 'image/png', '头像应返回正确图片类型')
    assert.strictEqual(
      response.headers['cross-origin-resource-policy'],
      'cross-origin',
      '头像需要允许微信小程序跨站点显示'
    )
    console.log('avatar-display-policy-check passed')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(fixturePath, { force: true })
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
