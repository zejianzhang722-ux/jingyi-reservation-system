/**
 * 小程序角色门禁与跳转冒烟检查（纯 node，模拟微信宿主）
 * 覆盖：admin-scan / admin-manage / admin-profile / profile 门禁，
 *      role-model 的 homePath / scanPath / isAdminRole 三族语义，红线回归
 * 运行：node scripts/miniapp-role-gate-check.js
 *
 * 【用例隔离契约，勿破坏】
 * setRole() 会清空 require.cache 中所有 miniapp 模块（含 utils/auth.js、
 * utils/role-model.js），保证每个用例都拿到全新模块实例、重新读取当前 storage。
 * 否则 auth 一旦引入模块级状态，角色切换就会读到上一个用例的残留值，
 * 表现为同一份代码时绿时红（flaky），且会掩盖真实回归。
 * 验收标准：同一份代码连跑 10 次输出必须逐字节一致。
 */

//模拟微信宿主，验证角色门禁与 role-model 集成
var launched = []
var storage = { token: 't', userInfo: { role: 'admin', name: 'A' } }
global.wx = {
  getStorageSync: function (k) { return storage[k] },
  setStorageSync: function (k, v) { storage[k] = v },
  removeStorageSync: function (k) { delete storage[k] },
  reLaunch: function (o) { launched.push(o.url) },
  navigateTo: function (o) { launched.push('nav:' + o.url) },
  switchTab: function (o) { launched.push('tab:' + o.url) },
  showToast: function () {}, showModal: function () {}, scanCode: function () {},
  getLocation: function () {}, stopPullDownRefresh: function () {}
}
global.getApp = function () { return { globalData: {} } }
global.Page = function (def) { global.__page = def }
global.Component = function () {}

// 清空所有 miniapp 模块缓存，让下一次 require 拿到全新实例。
// 只清页面模块是不够的：auth.js / role-model.js 若被页面间接 require，
// 其模块级状态会跨用例残留，导致角色切换读到过期值。
function purgeMiniappModules () {
  Object.keys(require.cache).forEach(function (key) {
    if (key.indexOf('miniapp') >= 0) delete require.cache[key]
  })
}

var results = []
function check (name, actual, expected) {
  var ok = actual === expected
  if (!ok) results.push('FAIL ' + name + ' got ' + JSON.stringify(actual))
  else results.push('PASS ' + name)
}

// 统一入口：先清全部 miniapp 缓存，再 require，保证拿到全新模块实例
function freshRequire (relPath) {
  purgeMiniappModules()
  return require(relPath)
}

// role-model 每次从 fresh 实例取，避免与页面模块持有不同实例
function roleModel () {
  return freshRequire('../miniapp/utils/role-model')
}

function loadPage (relPath) {
  purgeMiniappModules()
  global.__page = null
  require(relPath)
  var def = global.__page
  // 注入小程序实例方法（真实运行时由框架提供）
  def.setData = function (patch) { Object.assign(this.data, patch) }
  return def
}

// admin-scan 是工厂包装，单独一个 loader
function loadScan () {
  purgeMiniappModules()
  global.__page = null
  require('../miniapp/pages/admin-scan/admin-scan.js')
  global.__page.setData = function () {}
  global.__page.data = global.__page.data || {}
  return global.__page
}

// 切换角色前必须清缓存，否则 auth.js 的模块级状态会残留上一个用例的角色
function setRole (r) {
  storage.userInfo = { role: r, name: 'X' }
  purgeMiniappModules()
}

// 1) admin角色：放行，且调用了工厂 onLoad（会出现岗位权限请求失败的兜底文案，但不应 reLaunch）
setRole('admin'); launched = []
var p = loadScan()
check('admin-scan 注册为 Page 对象', typeof p, 'object')
check('admin-scan 拥有工厂方法 scan', typeof p.scan, 'function')
check('admin-scan 拥有工厂方法 pass', typeof p.pass, 'function')
check('admin-scan 未被踢出（admin）', launched.length, 0)
check('admin-scan 初始 data.section 未设置', p.data.section, undefined)

// 2) counselor：放行
setRole('counselor'); launched = []
p = loadScan()
p.onLoad({})
check('counselor 未被踢出', launched.filter(function (u) { return u.indexOf('login') >= 0 }).length, 0)

// 3) super_admin：放行
setRole('super_admin'); launched = []
p = loadScan()
p.onLoad({})
check('super_admin 未被踢出', launched.filter(function (u) { return u.indexOf('login') >= 0 }).length, 0)

// 4) dorm_manager：必须回宿管工作台，绝不能回登录页
setRole('dorm_manager'); launched = []
p = loadScan()
p.onLoad({})
check('dorm_manager 回宿管工作台', launched[0], '/pages/verification/verification')
check('dorm_manager 未被踢去登录页', launched.filter(function (u) { return u.indexOf('login') >= 0 }).length, 0)

// 5) student：学生没有管理端工作台，直接回登录页，不得绕道 admin-home
setRole('student'); launched = []
p = loadScan()
p.onLoad({})
check('student 被挡在门外', launched[0], '/pages/login/login')
check('student 未被绕道 admin-home', launched.indexOf('/pages/admin-home/admin-home'), -1)

// 6) 未登录
storage.token = ''
launched = []
p = loadScan()
p.onLoad({})
check('未登录回登录页', launched[0], '/pages/login/login')

// 7) superadmin 别名（旧数据）应被视作 guide 而放行
storage.token = 't'; setRole('superadmin'); launched = []
p = loadScan()
p.onLoad({})
check('superadmin 别名被放行', launched.filter(function (u) { return u.indexOf('login') >= 0 }).length, 0)

// 8) auth.getAdminHome 与 roleModel().homePath 一致
var auth = require('../miniapp/utils/auth')
setRole('dorm_manager')
check('auth.getAdminHome(dorm)=verification', auth.getAdminHome(), '/pages/verification/verification')
setRole('admin')
check('auth.getAdminHome(admin)=admin-home', auth.getAdminHome(), '/pages/admin-home/admin-home')
check('auth.isAdmin(admin)', auth.isAdmin(), true)
check('auth.isAdmin(student)', (setRole('student'), auth.isAdmin()), false)
check('auth.isAdmin(dorm_manager)', (setRole('dorm_manager'), auth.isAdmin()), true)

// 8b) roleModel().homePath 直测：三种层级必须各自指向正确工作台，不得有任何兜底
var HOME_LOGIN = '/pages/login/login'
var HOME_ADMIN = '/pages/admin-home/admin-home'
var HOME_DORM = '/pages/verification/verification'
check('homePath(dorm_manager)=宿管工作台', roleModel().homePath('dorm_manager'), HOME_DORM)
check('homePath(super_admin)=admin-home', roleModel().homePath('super_admin'), HOME_ADMIN)
check('homePath(admin)=admin-home', roleModel().homePath('admin'), HOME_ADMIN)
check('homePath(counselor)=admin-home', roleModel().homePath('counselor'), HOME_ADMIN)
check('homePath(superadmin 别名)=admin-home', roleModel().homePath('superadmin'), HOME_ADMIN)
check('homePath(student)=登录页', roleModel().homePath('student'), HOME_LOGIN)
check('homePath(空字符串)=登录页', roleModel().homePath(''), HOME_LOGIN)
check('homePath(null)=登录页', roleModel().homePath(null), HOME_LOGIN)
check('homePath(undefined)=登录页', roleModel().homePath(undefined), HOME_LOGIN)
check('homePath(未知角色)=登录页', roleModel().homePath('unknown_role'), HOME_LOGIN)
// 关键回归：非管理角色绝不能落到管理端外壳
;['student', '', null, undefined, 'unknown_role'].forEach(function (r) {
  check('homePath(' + (typeof r === 'string' ? (r || '空字符串') : String(r)) + ') 不落admin-home',
    roleModel().homePath(r) === HOME_ADMIN, false)
})
// 同样约束 scanPath：宿管与导生会各自扫各自的页
check('scanPath(dorm_manager)=dorm-scan', roleModel().scanPath('dorm_manager'), '/pages/dorm-scan/dorm-scan')
check('scanPath(admin)=admin-scan', roleModel().scanPath('admin'), '/pages/admin-scan/admin-scan')

// 9) admin-manage：dorm_manager 访问应回宿管工作台
setRole('dorm_manager'); launched = []
var amPath = require.resolve('../miniapp/pages/admin-manage/admin-manage.js')
delete require.cache[amPath]
global.__page = null
require(amPath)
var am = global.__page
check('admin-manage ensureAdmin 存在', typeof am.ensureAdmin, 'function')
var allowed = am.ensureAdmin.call({ setData: function () {} })
check('dorm_manager 进不了管理端外壳', allowed, false)
check('dorm_manager 被送回宿管工作台', launched[0], '/pages/verification/verification')

setRole('admin'); launched = []
var allowedAdmin = am.ensureAdmin.call({ setData: function () {} })
check('admin 可进入管理端外壳', allowedAdmin, true)
check('admin 未被 reLaunch', launched.length, 0)

// 10) admin-manage 扫码路由
setRole('admin')
launched = []
am.onItemTap.call(am, { currentTarget: { dataset: { key: 'verification' } } })
check('admin 点扫码核验-> admin-scan', launched[0], 'nav:/pages/admin-scan/admin-scan')

;['super_admin', 'admin', 'counselor', 'superadmin'].forEach(function (role) {
  setRole(role); launched = []
  var home = loadPage('../miniapp/pages/admin-home/admin-home.js')
  home.onScanCheckin.call(home)
  check('首页扫码入口留在导生会流程（' + role + '）', launched[0], 'nav:/pages/admin-scan/admin-scan')
})
setRole('dorm_manager'); launched = []
var dormHome = loadPage('../miniapp/pages/admin-home/admin-home.js')
dormHome.onScanCheckin.call(dormHome)
check('宿管误入管理员首页回自身工作台', launched[0], '/pages/verification/verification')
check('宿管不打开管理员扫码页', launched.indexOf('nav:/pages/admin-scan/admin-scan'), -1)
setRole('admin'); launched = []
var restrictedMenu = loadPage('../miniapp/pages/admin-manage/admin-manage.js')
restrictedMenu.onItemTap.call(restrictedMenu, { currentTarget: { dataset: { key: 'feedback' } } })
check('普通管理员伪造受限菜单点击不跳转', launched.length, 0)

// ============ 以下覆盖 admin-profile / profile 的宿管越权收口 ============
// 背景：auth.isAdmin() 对 dorm_manager 返回 true（dorm-page.js:11 依赖该行为），
// 所以宿管点「我的」tab 会跳到 admin-profile。必须用 isGuideRole 二次收口，
// 否则宿管会看到导生会层级外壳（账号信息/账号安全），且 roleLabel 显示「宿管」。
function loadPage (relPath) {
  var p = require.resolve(relPath)
  delete require.cache[p]
  global.__page = null
  require(p)
  var def = global.__page
  // 注入小程序实例方法（真实运行时由框架提供）
  def.setData = function (patch) { Object.assign(this.data, patch) }
  return def
}

// 11) admin-profile.ensureAdmin：三个 guide 角色放行，宿管回宿管工作台，学生回登录页
var GUIDE_ROLES = ['super_admin', 'admin', 'counselor']
GUIDE_ROLES.forEach(function (role) {
  storage.token = 't'; setRole(role); launched = []
  var ap = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
  var ok = ap.ensureAdmin.call({ setData: function () {} })
  check('admin-profile 放行 guide 角色 ' + role, ok, true)
  check('admin-profile 未 reLaunch（' + role + '）', launched.length, 0)
})

storage.token = 't'; setRole('superadmin'); launched = []
var apAlias = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
check('admin-profile 放行 superadmin 别名', apAlias.ensureAdmin.call({ setData: function () {} }), true)

storage.token = 't'; setRole('dorm_manager'); launched = []
var apDorm = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
check('admin-profile 拒绝 dorm_manager', apDorm.ensureAdmin.call({ setData: function () {} }), false)
check('admin-profile dorm_manager 回宿管工作台', launched[0], '/pages/verification/verification')
check('admin-profile dorm_manager 未被踢去登录页', launched.filter(function (u) { return u.indexOf('login') >= 0 }).length, 0)
// 反向断言：宿管绝不能被弹回 admin-profile 自身，否则会与 profile.js 形成无限 reLaunch 循环
check('admin-profile dorm_manager 未被弹回自身（防循环）', launched.filter(function (u) { return u === '/pages/admin-profile/admin-profile' }).length, 0)

storage.token = 't'; setRole('student'); launched = []
var apStudent = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
check('admin-profile 拒绝 student', apStudent.ensureAdmin.call({ setData: function () {} }), false)
// 学生没有管理端工作台，必须直接回登录页，不得先进 admin-home 外壳一帧
check('admin-profile student 回登录页', launched[0], '/pages/login/login')
check('admin-profile student 未被绕道 admin-home', launched.indexOf('/pages/admin-home/admin-home'), -1)

storage.token = ''; setRole('admin'); launched = []
var apAnon = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
check('admin-profile 未登录回登录页', apAnon.ensureAdmin.call({ setData: function () {} }), false)
check('admin-profile 未登录目标正确', launched[0], '/pages/login/login')

// 12) admin-profile.loadAdminInfo 的roleLabel 走 role-model 归一化
storage.token = 't'
var roleLabelCases = [
  ['super_admin', '导生会会长团'],
  ['superadmin', '导生会会长团'],
  ['admin', '导生管理员'],
  ['counselor', '书院辅导员'],
  ['dorm_manager', '宿管'],
  ['student', '管理员'],
  ['', '管理员']
]
roleLabelCases.forEach(function (pair) {
  setRole(pair[0])
  var ap2 = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
  var inst = { data: JSON.parse(JSON.stringify(ap2.data)), setData: function (p) { Object.assign(this.data, p) } }
  ap2.loadAdminInfo.call(inst)
  check('admin-profile roleLabel(' + (pair[0] || '空') + ')', inst.data.roleLabel, pair[1])
})
// 页头与账号弹窗对 superadmin 别名必须一致（同页不得自相矛盾）
setRole('superadmin')
var apAlias2 = loadPage('../miniapp/pages/admin-profile/admin-profile.js')
var instAlias = { data: JSON.parse(JSON.stringify(apAlias2.data)), setData: function (p) { Object.assign(this.data, p) } }
apAlias2.loadAdminInfo.call(instAlias)
check('superadmin 别名页头与弹窗一致', instAlias.data.roleLabel, instAlias.data.roleMap[roleModel().normalizeRole('superadmin')])

// 13) profile.onLoad / onShow：guide 跳admin-profile，宿管留在本页
GUIDE_ROLES.concat(['superadmin']).forEach(function (role) {
  storage.token = 't'; setRole(role); launched = []
  var pf = loadPage('../miniapp/pages/profile/profile.js')
  pf.onLoad.call({ setData: function () {}, loadUserInfo: function () {} })
  check('profile 引导生会角色跳转（' + role + '）', launched[0], '/pages/admin-profile/admin-profile')
})

storage.token = 't'; setRole('dorm_manager'); launched = []
var pfDorm = loadPage('../miniapp/pages/profile/profile.js')
var dormLoadCalls = 0
var dormInst = { setData: function () {}, loadUserInfo: function () { dormLoadCalls++ } }
pfDorm.onLoad.call(dormInst)
check('profile 宿管不被弹去 admin-profile', launched.filter(function (u) { return u === '/pages/admin-profile/admin-profile' }).length, 0)
check('profile 宿管未发生任何 reLaunch', launched.length, 0)
check('profile 宿管正常加载本页数据', dormLoadCalls, 1)

launched = []
var dormShowCalls = 0
var dormInst2 = { setData: function () {}, loadUserInfo: function () { dormShowCalls++ }, getTabBar: function () { return null } }
pfDorm.onShow.call(dormInst2)
check('profile onShow 宿管不被弹走', launched.length, 0)
check('profile onShow 宿管正常渲染', dormShowCalls, 1)

storage.token = 't'; setRole('student'); launched = []
var pfStudent = loadPage('../miniapp/pages/profile/profile.js')
var stuLoadCalls = 0
pfStudent.onLoad.call({ setData: function () {}, loadUserInfo: function () { stuLoadCalls++ } })
check('profile 学生不被弹去 admin-profile', launched.length, 0)
check('profile 学生正常加载本页数据', stuLoadCalls, 1)

storage.token = ''; launched = []
var pfAnon = loadPage('../miniapp/pages/profile/profile.js')
var anonLoadCalls = 0
pfAnon.onLoad.call({ setData: function () {}, loadUserInfo: function () { anonLoadCalls++ } })
check('profile 未登录不被弹走', launched.length, 0)

// 14) profile 的 tabBar 选中项仍按 isAdmin 走（宿管高亮不能因本次收口而错位）
storage.token = 't'; setRole('dorm_manager')
var pfDorm2 = loadPage('../miniapp/pages/profile/profile.js')
var selectedByRole = {}
var tabInst = {
  setData: function () {},
  loadUserInfo: function () {},
  getTabBar: function () {
    return {
      switchTabList: function () {},
      setData: function (p) { selectedByRole.value = p.selected }
    }
  }
}
pfDorm2.onShow.call(tabInst)
check('profile tabBar 宿管仍选中 index 2', selectedByRole.value, 2)
selectedByRole.value = undefined
storage.token = 't'; setRole('student')
var pfStu2 = loadPage('../miniapp/pages/profile/profile.js')
pfStu2.onShow.call(tabInst)
check('profile tabBar 学生仍选中 index 3', selectedByRole.value, 3)

// 15) 红线回归：isAdminRole 必须继续包含 dorm（dorm-page.js:11 依赖）
check('isAdminRole(dorm_manager) 仍为 true（红线）', roleModel().isAdminRole('dorm_manager'), true)
check('isAdminRole(admin) 仍为 true（红线）', roleModel().isAdminRole('admin'), true)
check('isAdminRole(student) 仍为 false（红线）', roleModel().isAdminRole('student'), false)

console.log(results.join('\n'))
var failed = results.filter(function (r) { return r.indexOf('FAIL') === 0 })
console.log('\n' + (failed.length ? failed.length + ' 项失败' : '全部通过') + '（共 ' + results.length + ' 项）')
process.exit(failed.length ? 1 : 0)
