const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const wxml = read('miniapp/pages/login/login.wxml')
const wxss = read('miniapp/pages/login/login.wxss')
const pageConfig = JSON.parse(read('miniapp/pages/login/login.json'))
const logoPath = path.join(root, 'miniapp/images/brand/jingyi-glass-logo.png')
const backgroundPath = path.join(root, 'miniapp/images/brand/login-space-bg.png')

assert(fs.existsSync(logoPath) && fs.statSync(logoPath).size > 0, '新版玻璃 Logo 资源应存在')
assert(fs.existsSync(backgroundPath) && fs.statSync(backgroundPath).size > 0, '新版空间背景资源应存在')
assert(wxml.indexOf('/images/brand/jingyi-glass-logo.png') !== -1, '登录页应使用新版玻璃 Logo')
assert(wxml.indexOf('/images/brand/login-space-bg.png') !== -1, '登录页应使用新版空间背景')
assert(wxml.indexOf('field-label') !== -1, '输入框应显示固定字段标签')
assert(wxml.indexOf('学生登录') !== -1 && wxml.indexOf('管理员登录') !== -1, '应保留学生和管理员双登录模式')
assert(wxml.indexOf('onStudentIdInput') !== -1 && wxml.indexOf('onCardNoInput') !== -1, '学生登录输入绑定必须保留')
assert(wxml.indexOf('onUsernameInput') !== -1 && wxml.indexOf('onPasswordInput') !== -1, '管理员登录输入绑定必须保留')
assert(wxss.indexOf('.particle') === -1, '应移除旧圆形粒子背景')
assert(wxss.indexOf('login-space-bg.png') === -1, '背景图片应由 WXML image 加载，避免 WXSS 本地资源兼容问题')
assert(/\.login-btn\s*\{[^}]*height:\s*(?:9\d|1\d{2,})rpx/s.test(wxss), '主按钮触控高度不得小于 90rpx')
assert(pageConfig.navigationBarBackgroundColor === '#061426', '导航栏应与页面背景统一')
assert(pageConfig.navigationBarTextStyle === 'white', '导航栏文字应适配深色背景')

console.log('miniapp-login-visual-check passed')
