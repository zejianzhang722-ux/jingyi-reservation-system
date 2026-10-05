const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const groups = {
  'motion-tab': [
    'index', 'my-reservations', 'notifications', 'profile',
    'admin-home', 'admin-manage', 'admin-profile'
  ],
  'motion-stack': [
    'room-list', 'study-room', 'room-timeline', 'reading-room', 'room-compare',
    'group-list', 'admin-announcement', 'admin-credit', 'admin-feedback',
    'admin-poster', 'admin-reservation', 'admin-rooms', 'admin-stats', 'admin-users'
  ],
  'motion-detail': [
    'room-detail', 'reservation-detail', 'credit-detail', 'qrcode', 'rules',
    'admin-reservation-detail'
  ],
  'motion-form': [
    'reservation-confirm', 'poster-apply', 'feedback', 'network-settings',
    'subscribe-settings', 'group-reserve', 'profile-edit'
  ]
}

const failures = []
const expect = (condition, message) => {
  if (!condition) failures.push(message)
}

const appWxss = read('miniapp/app.wxss')
expect(!/\.container\s*\{[^}]*animation\s*:/s.test(appWxss), 'container 不应再强制统一入场动画')
expect(!appWxss.includes('.page-fade-in'), '应移除会造成重复入场的 page-fade-in')

for (const token of [
  '--motion-duration-tab',
  '--motion-duration-page',
  '--motion-ease-out',
  '@keyframes routeTabEnter',
  '@keyframes routeStackEnter',
  '@keyframes routeDetailEnter',
  '@keyframes routeFormEnter'
]) {
  expect(appWxss.includes(token), `缺少统一转场定义：${token}`)
}

for (const [motionClass, pages] of Object.entries(groups)) {
  for (const page of pages) {
    const wxml = read(`miniapp/pages/${page}/${page}.wxml`)
    const firstTag = wxml.split(/\r?\n/, 1)[0]
    expect(firstTag.includes('motion-page'), `${page} 根节点缺少 motion-page`)
    expect(firstTag.includes(motionClass), `${page} 根节点缺少 ${motionClass}`)
    expect(!firstTag.includes('page-fade-in'), `${page} 仍包含重复的 page-fade-in`)
  }
}

const tabWxml = read('miniapp/custom-tab-bar/index.wxml')
const tabWxss = read('miniapp/custom-tab-bar/index.wxss')
expect(tabWxml.includes('tab-bar-active-glow'), '底栏缺少跟随选中项的光感指示层')
expect(tabWxss.includes('@keyframes tabGlowEnter'), '底栏缺少光感指示层转场')
expect(tabWxss.includes('@keyframes tabIconSettle'), '底栏缺少图标落位转场')

const motionUtilPath = path.join(root, 'miniapp/utils/page-motion.js')
expect(fs.existsSync(motionUtilPath), '缺少可在缓存底栏页重新播放转场的工具')
if (fs.existsSync(motionUtilPath)) {
  const { replayPageMotion } = require(motionUtilPath)
  const updates = []
  let scheduled = null
  replayPageMotion({ setData: (payload) => updates.push(payload) }, (callback) => { scheduled = callback })
  expect(updates.length === 1 && updates[0].pageMotionActive === false, '重播转场应先清除激活状态')
  expect(typeof scheduled === 'function', '重播转场应等待下一次界面更新')
  if (scheduled) scheduled()
  expect(updates.length === 2 && updates[1].pageMotionActive === true, '重播转场应在下一次界面更新时重新激活')
}

for (const page of groups['motion-tab']) {
  const wxml = read(`miniapp/pages/${page}/${page}.wxml`)
  const js = read(`miniapp/pages/${page}/${page}.js`)
  expect(wxml.includes("pageMotionActive ? 'motion-active' : ''"), `${page} 未绑定可重播的转场状态`)
  expect(js.includes("require('../../utils/page-motion')"), `${page} 未接入转场重播工具`)
  expect(js.includes('replayPageMotion(this)'), `${page} 未在显示时重播转场`)
}

expect(!/nth-child\((?:7|8|9|10|11|12)\)/.test(appWxss), '列表级联延迟应在 6 项内封顶')

if (failures.length) {
  console.error(`小程序页面转场检查失败（${failures.length} 项）：`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('小程序页面转场检查通过：语义化转场、底栏动效与级联节奏均已配置。')
