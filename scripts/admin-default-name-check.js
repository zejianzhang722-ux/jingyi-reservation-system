const assert = require('assert/strict')
const fs = require('fs')
const mock = require('../server/src/config/mock-db')
assert.equal(mock.__tables.admins.find(row => row.role === 'super_admin').real_name, '导生会会长团')
const adminName = require('../server/src/utils/adminNamePresenter')
assert.equal(adminName('超级管理员', 'super_admin'), '导生会会长团')
assert.equal(adminName('超级管理员', 'superadmin'), '导生会会长团')
assert.equal(adminName('张三', 'super_admin'), '张三')
assert.equal(adminName('超级管理员', 'student'), '超级管理员')
assert.equal(adminName('', 'super_admin'), '')
assert.match(fs.readFileSync(require('path').join(__dirname, '../server/sql/seed.sql'), 'utf8'), /'导生会会长团', 'super_admin'/)
// 小程序端不做「超级管理员 -> 导生会会长团」的猜测性翻译：
// loadAdminInfo 只透传 userInfo，展示名以服务端下发的为准。
let page
const cached = { role: 'super_admin', name: '超级管理员', realName: '超级管理员' }
global.wx = { getStorageSync: key => key === 'userInfo' ? cached : 'token' }
global.Page = config => { page = config }
const profileSource = fs.readFileSync(require('path').join(__dirname, '../miniapp/pages/admin-profile/admin-profile.js'), 'utf8')
require('../miniapp/pages/admin-profile/admin-profile')
page.setData = data => { Object.assign(page.data, data) }
page.loadAdminInfo()
assert.equal(page.data.adminInfo.name, '超级管理员', '小程序端应透传服务端下发的姓名，不做客户端翻译')
assert.equal(page.data.adminInfo.realName, '超级管理员')
assert.equal(cached.name, '超级管理员', '不得就地改写缓存对象')
assert.equal(cached.realName, '超级管理员', '不得就地改写缓存对象')
assert.doesNotMatch(profileSource, /'导生会会长团'/, '小程序端不应硬编码会长团文案')
// 角色展示名统一由 role-model 提供
assert.match(profileSource, /roleModel\.label\(/, '角色展示名应来自 role-model 单一来源')
console.log('小程序端姓名透传、缓存不被改写且角色名走 role-model 检查通过')
