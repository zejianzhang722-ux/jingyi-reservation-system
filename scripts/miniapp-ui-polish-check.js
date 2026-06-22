const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const miniappRoot = path.join(root, 'miniapp')
const errors = []

function fail(message) {
  errors.push(message)
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function walk(dir, files) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (entry.name === 'node_modules') return
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
    } else if (/\.(js|wxml|wxss|json)$/.test(entry.name)) {
      files.push(full)
    }
  })
}

const files = []
walk(miniappRoot, files)

const internalCopyPatterns = [
  /测试账号/,
  /管理员测试账号/,
  /当前服务器/,
  /模板ID/,
  /桌面后台/,
  /移动端保留/,
  /移动端暂不/,
  /127\.0\.0\.1/,
  /TODO|FIXME|Mock|Demo|Sample|Placeholder/
]

const emojiPattern = /[\u{1F300}-\u{1FAFF}]/u
const legacySymbolPattern = /⚖|🏠|📚|📱|🚪|📖|🎉|👤|⭐|📊|📋|💬|🔔|ℹ|🔐|🌐/
const iconSingleCharPattern = /icon:\s*['"][\u4e00-\u9fa5]['"]/

files.forEach(function (file) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  if (rel === 'miniapp/project.private.config.json' || rel === 'miniapp/utils/network-config.js') return
  const content = fs.readFileSync(file, 'utf8')
  internalCopyPatterns.forEach(function (pattern) {
    if (pattern.test(content)) fail(rel + ' 包含不应出现在正式界面的内部说明：' + pattern)
  })
  if (emojiPattern.test(content) || legacySymbolPattern.test(content)) {
    fail(rel + ' 仍包含表情或临时符号图标')
  }
  if (rel.indexOf('custom-tab-bar') !== -1 && emojiPattern.test(content)) {
    fail(rel + ' 底部导航仍使用 Emoji 图标')
  }
  if (/pages\/profile\/profile\.(js|wxml|wxss)$/.test(rel) && emojiPattern.test(content)) {
    fail(rel + ' 我的页面仍使用 Emoji 图标')
  }
  if (/pages\/admin-(manage|profile)\/admin-(manage|profile)\.js$/.test(rel) && iconSingleCharPattern.test(content)) {
    fail(rel + ' 管理员入口仍使用单字图标')
  }
})

const confirmWxml = read('miniapp/pages/reservation-confirm/reservation-confirm.wxml')
if (!/data-field="discussionFields"[\s\S]*type="number"/.test(confirmWxml) && !/type="number"[\s\S]*data-field="discussionFields"/.test(confirmWxml)) {
  fail('共享空间参与人数输入框应使用数字键盘')
}
if (!/required-star/.test(confirmWxml)) {
  fail('预约确认页应明确标记共享空间必填项')
}

const profileJs = read('miniapp/pages/profile/profile.js')
if (!/cropImage/.test(profileJs)) {
  fail('头像上传前应调用圆形裁切能力')
}
if (/open-type="chooseAvatar"/.test(read('miniapp/pages/profile/profile.wxml'))) {
  fail('我的页面头像入口不应绕过裁切直接使用 chooseAvatar')
}

const tabbarWxml = read('miniapp/custom-tab-bar/index.wxml')
if (/emoji/.test(tabbarWxml)) {
  fail('底部导航 WXML 不应再绑定 emoji 字段')
}

const myReservationsWxml = read('miniapp/pages/my-reservations/my-reservations.wxml')
if (/:\s*item\.status/.test(myReservationsWxml)) {
  fail('我的预约不得把原始状态码直接显示给用户')
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('miniapp-ui-polish-check passed')
