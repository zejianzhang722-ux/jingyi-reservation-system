const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const errors = []

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8')
}

function assert(condition, message) {
  if (!condition) errors.push(message)
}

const reservationRoutes = read('server/src/routes/reservation.js')
assert(
  /router\.get\('\/pending',\s*auth,\s*requireAdmin/.test(reservationRoutes),
  '待审核列表必须要求管理员权限'
)
assert(
  /router\.put\('\/:id\/approve',\s*auth,\s*requireAdmin/.test(reservationRoutes),
  '审批通过接口必须要求管理员权限'
)
assert(
  /router\.put\('\/:id\/reject',\s*auth,\s*requireAdmin/.test(reservationRoutes),
  '审批拒绝接口必须要求管理员权限'
)
assert(
  /reservationApprovalController/.test(reservationRoutes),
  '审批接口必须使用角色范围控制器'
)

const auditController = read('server/src/controllers/auditController.js')
assert(
  /reservationApprovalController\.approve/.test(auditController) &&
  /reservationApprovalController\.reject/.test(auditController),
  '/audit 单条审批接口必须复用角色范围控制器'
)
assert(
  /allowedStatusesForRole/.test(auditController),
  '/audit 列表与批量审批必须按角色限制状态范围'
)
assert(
  /beginTransaction/.test(auditController) && /rollback/.test(auditController),
  '真实数据库中的批量审批必须使用事务'
)

const checkinRoutes = read('server/src/routes/checkin.js')
assert(
  /router\.post\('\/checkout',\s*auth,\s*reservationFromBody/.test(checkinRoutes),
  '签退接口必须校验预约归属'
)
assert(
  /router\.get\('\/status\/:reservationId',\s*auth,\s*reservationFromParam/.test(checkinRoutes),
  '签到状态接口必须校验预约归属'
)
assert(
  /router\.get\('\/current\/:roomId',\s*auth,\s*requireAdmin/.test(checkinRoutes),
  '房间当前使用人员仅管理员可查看'
)

const responseUtil = read('server/src/utils/response.js')
assert(/res\.status\(httpStatus\)\.json/.test(responseUtil), '错误响应必须设置真实 HTTP 状态码')

const authRoutes = read('server/src/routes/auth.js')
assert(/tokenController\.refresh/.test(authRoutes), '刷新接口必须使用严格刷新处理器')
assert(/refreshLimiter/.test(authRoutes), '刷新接口必须使用独立限流器')
assert(
  /login\/admin'[^\n]*authController\.adminMiniappLogin/.test(authRoutes),
  'Web 管理端登录必须复用可用的管理员登录实现'
)

const authMiddleware = read('server/src/middleware/auth.js')
assert(/isStoredRefreshToken/.test(authMiddleware), '受保护接口必须拒绝 Refresh Token')
assert(
  /旧版会话状态不存在/.test(authMiddleware),
  '未标记 tokenType 的旧会话必须在状态缺失时安全失败'
)

const app = read('server/src/app.js')
assert(!/origin:\s*['"]\*['"]/.test(app), 'Socket.IO CORS 不得允许任意来源')
assert(/app\.set\('trust proxy',\s*1\)/.test(app), '生产反向代理部署必须正确识别客户端 IP')

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log('security-critical-check passed')
