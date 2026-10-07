import { sortRoutesForRole } from '../utils/adminRolePolicy.js'

export const roleGroups = {
  allAdmins: ['super_admin', 'admin', 'counselor'],
  superOnly: ['super_admin'],
  counselorPlus: ['super_admin', 'counselor'],
  ordinaryReviewers: ['super_admin', 'admin', 'counselor'],
  reviewers: ['super_admin', 'admin', 'counselor']
}

export const adminChildren = [
  { path: 'verification', name: 'Verification', component: () => import('@/views/Checkin/Verification.vue'), meta: { title: '扫码核验与签到', icon: 'Check', roles: ['super_admin', 'admin', 'counselor', 'dorm_manager'], description: '核验通过即办理签到，查询记录并跟进异常' } },
  { path: 'dashboard', name: 'Dashboard', component: () => import('@/views/Dashboard/Index.vue'), meta: { title: '工作台', icon: 'DataBoard', roles: roleGroups.allAdmins, description: '今日运营概览、待办事项与关键指标' } },

  { path: 'reservation/pending', name: 'ReservationPending', component: () => import('@/views/Reservation/ReviewQueue.vue'), meta: { title: '预约审核', icon: 'Clock', roles: roleGroups.ordinaryReviewers, description: '处理待审核预约申请' } },
  { path: 'reservation/all', name: 'ReservationAll', component: () => import('@/views/Reservation/AllList.vue'), meta: { title: '全部预约', icon: 'List', roles: roleGroups.allAdmins, description: '查询和追踪全部预约记录' } },
  { path: 'reservation/counselor', name: 'CounselorPending', component: () => import('@/views/Reservation/CounselorPending.vue'), meta: { title: '辅导员审核', icon: 'UserFilled', roles: roleGroups.counselorPlus, capability: 'audit', description: '处理需要辅导员确认的预约' } },
  { path: 'reservation/groups', name: 'ReservationGroups', component: () => import('@/views/Group/PendingList.vue'), meta: { title: '组团审核', icon: 'User', roles: roleGroups.ordinaryReviewers, description: '审核组团预约申请与成员名单' } },
  { path: 'checkin/manage', name: 'CheckinManage', component: () => import('@/views/Checkin/Manage.vue'), meta: { title: '签到核销', icon: 'Check', roles: roleGroups.allAdmins, description: '核验签到、处理迟到与爽约' } },
  { path: 'reading-room/logs', name: 'ReadingRoomLogs', component: () => import('@/views/ReadingRoom/Logs.vue'), meta: { title: '阅览室记录', icon: 'Reading', roles: roleGroups.allAdmins, description: '查看阅览室出入与使用记录' } },

  { path: 'room/monitor', name: 'RoomMonitor', component: () => import('@/views/Room/Monitor.vue'), meta: { title: '空间监控', icon: 'Monitor', roles: roleGroups.allAdmins, description: '查看功能房实时使用情况' } },
  { path: 'room/manage', name: 'RoomManage', component: () => import('@/views/Room/Manage.vue'), meta: { title: '功能房', icon: 'OfficeBuilding', roles: roleGroups.superOnly, description: '维护功能房基础信息、状态与设施' } },
  { path: 'building/manage', name: 'BuildingManage', component: () => import('@/views/Room/BuildingManage.vue'), meta: { title: '楼栋', icon: 'HomeFilled', roles: roleGroups.superOnly, description: '维护书院楼栋与管理范围' } },
  { path: 'room/seats', name: 'SeatManage', component: () => import('@/views/Room/SeatManage.vue'), meta: { title: '座位', icon: 'Grid', roles: roleGroups.superOnly, description: '批量维护自习室座位' } },
  { path: 'room/rules', name: 'RulesConfig', component: () => import('@/views/Room/RulesConfig.vue'), meta: { title: '开放规则', icon: 'Setting', roles: roleGroups.superOnly, capability: 'rule_config', description: '配置开放时间、预约规则和审批策略' } },

  { path: 'account', name: 'AccountManage', component: () => import('@/views/Account/Index.vue'), meta: { title: '账号管理', icon: 'User', roles: roleGroups.superOnly, description: '管理宿生、导生管理员、辅导员和导生会会长团账号' } },
  { path: 'credit/violations', name: 'CreditViolations', component: () => import('@/views/Credit/Violations.vue'), meta: { title: '违规记录', icon: 'WarningFilled', roles: roleGroups.allAdmins, description: '记录和追踪违规行为' } },
  { path: 'credit/blacklist', name: 'CreditBlacklist', component: () => import('@/views/Credit/Blacklist.vue'), meta: { title: '黑名单', icon: 'CircleCloseFilled', roles: roleGroups.counselorPlus, description: '处理受限和封禁宿生' } },
  { path: 'credit/config', name: 'CreditConfig', component: () => import('@/views/Credit/ScoreConfig.vue'), meta: { title: '信用配置', icon: 'SetUp', roles: roleGroups.superOnly, description: '配置信用分规则和阈值' } },

  { path: 'stats/overview', name: 'StatsOverview', component: () => import('@/views/Stats/Overview.vue'), meta: { title: '数据概览', icon: 'TrendCharts', roles: roleGroups.allAdmins, description: '查看空间、预约、信用与用户统计' } },
  { path: 'stats/export', name: 'StatsExport', component: () => import('@/views/Stats/Export.vue'), meta: { title: '导出报表', icon: 'Download', roles: roleGroups.counselorPlus, capability: 'data_export', description: '导出运营数据与报表' } },

  { path: 'poster/pending', name: 'PosterPending', component: () => import('@/views/Poster/PendingList.vue'), meta: { title: '海报审核', icon: 'PictureFilled', roles: roleGroups.counselorPlus, description: '审核海报投放申请' } },
  { path: 'poster/position', name: 'PosterPosition', component: () => import('@/views/Poster/PositionManage.vue'), meta: { title: '海报位置', icon: 'Location', roles: roleGroups.superOnly, description: '维护海报投放位置' } },
  { path: 'feedback', name: 'Feedback', component: () => import('@/views/FeedbackView.vue'), meta: { title: '反馈管理', icon: 'ChatDotRound', roles: roleGroups.counselorPlus, description: '查看和处理用户反馈' } },
  { path: 'system/announcements', name: 'SystemAnnouncements', component: () => import('@/views/System/Announcements.vue'), meta: { title: '公告管理', icon: 'Bell', roles: roleGroups.superOnly, description: '发布和维护系统公告' } },
  { path: 'system/logs', name: 'SystemLogs', component: () => import('@/views/System/Logs.vue'), meta: { title: '操作日志', icon: 'Document', roles: roleGroups.superOnly, description: '审计关键管理操作' } },
  { path: 'system/backup', name: 'SystemBackup', component: () => import('@/views/System/Backup.vue'), meta: { title: '数据备份', icon: 'FolderOpened', roles: roleGroups.superOnly, description: '管理数据备份与恢复校验' } }
]

export const navSections = [
  { key: 'today', title: '工作台', icon: 'DataBoard', children: ['Dashboard'] },
  { key: 'reservation', title: '预约审核', icon: 'Calendar', children: ['CounselorPending', 'ReservationPending', 'ReservationGroups'] },
  { key: 'operations', title: '现场运营', icon: 'Monitor', children: ['Verification', 'CheckinManage', 'ReservationAll', 'ReadingRoomLogs', 'RoomMonitor'] },
  { key: 'space', title: '空间与规则', icon: 'OfficeBuilding', children: ['RoomManage', 'BuildingManage', 'SeatManage', 'RulesConfig', 'PosterPosition'] },
  { key: 'governance', title: '宿生与信用', icon: 'UserFilled', children: ['CreditViolations', 'CreditBlacklist', 'AccountManage', 'CreditConfig'] },
  { key: 'statistics', title: '数据报表', icon: 'TrendCharts', children: ['StatsOverview', 'StatsExport'] },
  { key: 'content', title: '公告与反馈', icon: 'PictureFilled', children: ['PosterPending', 'Feedback', 'SystemAnnouncements'] },
  { key: 'system', title: '系统运维', icon: 'Setting', children: ['SystemLogs', 'SystemBackup'] }
]

export function hasRouteRole(route, role, capabilities = []) {
  if (role === 'dorm_manager') return route?.name === 'Verification';
  const roles = route?.meta?.roles || []
  if (!roles.length) return true
  return roles.includes(role) || Boolean(route?.meta?.capability && capabilities.includes(route.meta.capability))
}

export function getNavigationSectionForRoute(routeName) {
  return navSections.find(section => section.children.includes(routeName))?.title || ''
}

export function buildNavigation(role, capabilities = []) {
  const routeMap = new Map(adminChildren.map(route => [route.name, route]))
  return navSections
    .map(section => ({
      ...section,
      children: sortRoutesForRole(section.children
        .map(name => routeMap.get(name))
        .filter(route => route && hasRouteRole(route, role, capabilities)), role)
        .map(route => ({
          name: route.name,
          path: '/' + route.path,
          title: route.meta.title,
          icon: route.meta.icon,
          description: route.meta.description
        }))
    }))
    .filter(section => section.children.length)
}
