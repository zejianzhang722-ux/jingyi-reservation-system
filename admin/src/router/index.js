import { createRouter, createWebHistory } from 'vue-router'
import Layout from '@/components/Layout.vue'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: Layout,
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', name: 'Dashboard', component: () => import('@/views/Dashboard/Index.vue'), meta: { title: '工作台', icon: 'DataBoard' } },
      { path: 'reservation/pending', name: 'ReservationPending', component: () => import('@/views/Reservation/PendingList.vue'), meta: { title: '待审核', icon: 'Clock', parent: '预约管理' } },
      { path: 'reservation/all', name: 'ReservationAll', component: () => import('@/views/Reservation/AllList.vue'), meta: { title: '全部预约', icon: 'List', parent: '预约管理' } },
      { path: 'reservation/counselor', name: 'CounselorPending', component: () => import('@/views/Reservation/CounselorPending.vue'), meta: { title: '辅导员审核', icon: 'UserFilled', parent: '预约管理' } },
      { path: 'room/monitor', name: 'RoomMonitor', component: () => import('@/views/Room/Monitor.vue'), meta: { title: '实时监控', icon: 'Monitor', parent: '功能房管理' } },
      { path: 'room/manage', name: 'RoomManage', component: () => import('@/views/Room/Manage.vue'), meta: { title: '房间管理', icon: 'OfficeBuilding', parent: '功能房管理' } },
      { path: 'room/seats', name: 'SeatManage', component: () => import('@/views/Room/SeatManage.vue'), meta: { title: '座位管理', icon: 'Grid', parent: '功能房管理' } },
      { path: 'room/rules', name: 'RulesConfig', component: () => import('@/views/Room/RulesConfig.vue'), meta: { title: '规则配置', icon: 'Setting', parent: '功能房管理' } },
      { path: 'building/manage', name: 'BuildingManage', component: () => import('@/views/Room/BuildingManage.vue'), meta: { title: '楼栋管理', icon: 'HomeFilled' } },
      { path: 'checkin/manage', name: 'CheckinManage', component: () => import('@/views/Checkin/Manage.vue'), meta: { title: '签到管理', icon: 'Check' } },
      { path: 'reading-room/logs', name: 'ReadingRoomLogs', component: () => import('@/views/ReadingRoom/Logs.vue'), meta: { title: '阅览室记录', icon: 'Reading' } },
      { path: 'poster/pending', name: 'PosterPending', component: () => import('@/views/Poster/PendingList.vue'), meta: { title: '海报审核', icon: 'PictureFilled', parent: '海报管理' } },
      { path: 'poster/position', name: 'PosterPosition', component: () => import('@/views/Poster/PositionManage.vue'), meta: { title: '位置管理', icon: 'Location', parent: '海报管理' } },
      { path: 'credit/violations', name: 'CreditViolations', component: () => import('@/views/Credit/Violations.vue'), meta: { title: '违规记录', icon: 'WarningFilled', parent: '信用管理' } },
      { path: 'credit/blacklist', name: 'CreditBlacklist', component: () => import('@/views/Credit/Blacklist.vue'), meta: { title: '黑名单', icon: 'CircleCloseFilled', parent: '信用管理' } },
      { path: 'credit/config', name: 'CreditConfig', component: () => import('@/views/Credit/ScoreConfig.vue'), meta: { title: '信用配置', icon: 'SetUp', parent: '信用管理' } },
      { path: 'stats/overview', name: 'StatsOverview', component: () => import('@/views/Stats/Overview.vue'), meta: { title: '数据概览', icon: 'TrendCharts', parent: '数据统计' } },
      { path: 'stats/export', name: 'StatsExport', component: () => import('@/views/Stats/Export.vue'), meta: { title: '导出报表', icon: 'Download', parent: '数据统计' } },
      { path: 'account', name: 'AccountManage', component: () => import('@/views/Account/Index.vue'), meta: { title: '账号管理', icon: 'User' } },
      { path: 'feedback', name: 'Feedback', component: () => import('@/views/FeedbackView.vue'), meta: { title: '反馈管理', icon: 'ChatDotRound' } },
      { path: 'system/announcements', name: 'SystemAnnouncements', component: () => import('@/views/System/Announcements.vue'), meta: { title: '公告管理', icon: 'Bell', parent: '系统管理' } },
      { path: 'system/logs', name: 'SystemLogs', component: () => import('@/views/System/Logs.vue'), meta: { title: '操作日志', icon: 'Document', parent: '系统管理' } },
      { path: 'system/backup', name: 'SystemBackup', component: () => import('@/views/System/Backup.vue'), meta: { title: '数据备份', icon: 'FolderOpened', parent: '系统管理' } }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  document.title = to.meta.title ? `${to.meta.title} - 敬一书院` : '敬一书院'
  const token = localStorage.getItem('token')
  if (to.path === '/login') {
    next()
  } else if (!token) {
    next('/login')
  } else {
    next()
  }
})

export default router
