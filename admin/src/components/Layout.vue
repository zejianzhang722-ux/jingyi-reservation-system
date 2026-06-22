<template>
  <el-container class="layout-container">
    <el-aside :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <div class="logo-container">
        <div class="logo-mark">敬</div>
        <transition name="fade">
          <span v-show="!isCollapse" class="logo-text">敬一书院</span>
        </transition>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        router
        background-color="transparent"
        text-color="rgba(255,255,255,0.68)"
        active-text-color="#FFFFFF"
        class="aside-menu"
      >
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon>
          <template #title>工作台</template>
        </el-menu-item>

        <el-sub-menu index="reservation">
          <template #title>
            <el-icon><Calendar /></el-icon>
            <span>预约管理</span>
          </template>
          <el-menu-item index="/reservation/pending"><el-icon><Clock /></el-icon><template #title>待审核</template></el-menu-item>
          <el-menu-item index="/reservation/all"><el-icon><List /></el-icon><template #title>全部预约</template></el-menu-item>
          <el-menu-item index="/reservation/counselor"><el-icon><UserFilled /></el-icon><template #title>辅导员审核</template></el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="room">
          <template #title>
            <el-icon><OfficeBuilding /></el-icon>
            <span>功能房管理</span>
          </template>
          <el-menu-item index="/room/monitor"><el-icon><Monitor /></el-icon><template #title>实时监控</template></el-menu-item>
          <el-menu-item index="/room/manage"><el-icon><Setting /></el-icon><template #title>房间管理</template></el-menu-item>
          <el-menu-item index="/room/seats"><el-icon><Grid /></el-icon><template #title>座位管理</template></el-menu-item>
          <el-menu-item index="/room/rules"><el-icon><Operation /></el-icon><template #title>规则配置</template></el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/building/manage"><el-icon><HomeFilled /></el-icon><template #title>楼栋管理</template></el-menu-item>
        <el-menu-item index="/checkin/manage"><el-icon><Check /></el-icon><template #title>签到管理</template></el-menu-item>
        <el-menu-item index="/reading-room/logs"><el-icon><Reading /></el-icon><template #title>阅览室记录</template></el-menu-item>

        <el-sub-menu index="poster">
          <template #title>
            <el-icon><PictureFilled /></el-icon>
            <span>海报管理</span>
          </template>
          <el-menu-item index="/poster/pending"><el-icon><Clock /></el-icon><template #title>海报审核</template></el-menu-item>
          <el-menu-item index="/poster/position"><el-icon><Location /></el-icon><template #title>位置管理</template></el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/feedback"><el-icon><ChatDotRound /></el-icon><template #title>反馈管理</template></el-menu-item>

        <el-sub-menu index="credit">
          <template #title>
            <el-icon><WarningFilled /></el-icon>
            <span>信用管理</span>
          </template>
          <el-menu-item index="/credit/violations"><el-icon><Warning /></el-icon><template #title>违规记录</template></el-menu-item>
          <el-menu-item index="/credit/blacklist"><el-icon><CircleCloseFilled /></el-icon><template #title>黑名单</template></el-menu-item>
          <el-menu-item index="/credit/config"><el-icon><SetUp /></el-icon><template #title>信用配置</template></el-menu-item>
        </el-sub-menu>

        <el-sub-menu index="stats">
          <template #title>
            <el-icon><TrendCharts /></el-icon>
            <span>数据统计</span>
          </template>
          <el-menu-item index="/stats/overview"><el-icon><DataAnalysis /></el-icon><template #title>数据概览</template></el-menu-item>
          <el-menu-item index="/stats/export"><el-icon><Download /></el-icon><template #title>导出报表</template></el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/account"><el-icon><User /></el-icon><template #title>账号管理</template></el-menu-item>

        <el-sub-menu index="system">
          <template #title>
            <el-icon><Tools /></el-icon>
            <span>系统管理</span>
          </template>
          <el-menu-item index="/system/announcements"><el-icon><Bell /></el-icon><template #title>公告管理</template></el-menu-item>
          <el-menu-item index="/system/logs"><el-icon><Document /></el-icon><template #title>操作日志</template></el-menu-item>
          <el-menu-item index="/system/backup"><el-icon><FolderOpened /></el-icon><template #title>数据备份</template></el-menu-item>
        </el-sub-menu>
      </el-menu>
    </el-aside>

    <el-container class="main-container">
      <el-header class="layout-header">
        <div class="header-content">
          <div class="header-left">
            <el-icon class="collapse-btn" @click="isCollapse = !isCollapse">
              <Fold v-if="!isCollapse" />
              <Expand v-else />
            </el-icon>
            <div>
              <div class="page-title">{{ currentTitle }}</div>
              <div class="page-subtitle">功能房预约管理后台</div>
            </div>
          </div>
          <div class="header-right">
            <el-tag type="warning" effect="light">{{ roleLabel }}</el-tag>
            <el-dropdown @command="handleCommand">
              <span class="user-info">
                <el-avatar :size="32" class="user-avatar">{{ avatarText }}</el-avatar>
                <span class="user-name">{{ userStore.userInfo.realName || userStore.userInfo.username || '管理员' }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="logout">
                    <el-icon><SwitchButton /></el-icon>退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/store/user'

const route = useRoute()
const userStore = useUserStore()
const isCollapse = ref(false)

const activeMenu = computed(() => route.path)
const currentTitle = computed(() => route.meta.title || '工作台')
const avatarText = computed(() => {
  const name = userStore.userInfo.realName || userStore.userInfo.username || '管'
  return name.charAt(0)
})

const roleMap = {
  super_admin: '超级管理员',
  admin: '管理员',
  counselor: '辅导员'
}

const roleLabel = computed(() => roleMap[userStore.userInfo.role] || '管理员')

function handleCommand(command) {
  if (command === 'logout') {
    userStore.logout()
  }
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
}

.layout-aside {
  background: linear-gradient(180deg, #103B70 0%, #0B1F35 100%);
  transition: width 0.25s ease;
  overflow: hidden;
  box-shadow: 2px 0 12px rgba(0, 21, 41, 0.14);
  position: relative;
  z-index: 20;
}

.logo-container {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(196, 148, 58, 0.28);
}

.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #C4943A;
  color: #fff;
  font-weight: 800;
}

.logo-text {
  color: #FFFFFF;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: 1px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.aside-menu {
  border-right: none;
  height: calc(100vh - 64px);
  overflow-y: auto;
  padding: 8px 0;
}

.aside-menu::-webkit-scrollbar {
  width: 0;
}

.aside-menu :deep(.el-menu-item),
.aside-menu :deep(.el-sub-menu__title) {
  height: 46px;
  line-height: 46px;
  margin: 3px 8px;
  border-radius: 8px;
}

.aside-menu :deep(.el-menu-item:hover),
.aside-menu :deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.08) !important;
}

.aside-menu :deep(.el-menu-item.is-active) {
  background: rgba(0, 102, 204, 0.48) !important;
  color: #FFFFFF !important;
}

.aside-menu :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 25%;
  bottom: 25%;
  width: 3px;
  background: #C4943A;
  border-radius: 0 3px 3px 0;
}

.main-container {
  background-color: var(--jy-bg, #F5F6FA);
}

.layout-header {
  background: #FFFFFF;
  padding: 0;
  height: 64px;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.06);
  z-index: 10;
}

.header-content {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
}

.header-left,
.header-right,
.user-info {
  display: flex;
  align-items: center;
}

.header-left {
  gap: 14px;
}

.header-right {
  gap: 16px;
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--jy-text-secondary, #8C8C9A);
  padding: 6px;
  border-radius: 6px;
}

.collapse-btn:hover {
  color: var(--jy-primary, #0066CC);
  background-color: var(--jy-primary-bg, rgba(0, 102, 204, 0.08));
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--jy-text-primary, #1A1A2E);
}

.page-subtitle {
  margin-top: 2px;
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
}

.user-info {
  gap: 8px;
  cursor: pointer;
}

.user-avatar {
  background: #0066CC;
  color: #fff;
  font-weight: 700;
}

.user-name {
  font-size: 14px;
  color: var(--jy-text-primary, #1A1A2E);
  font-weight: 600;
}

.layout-main {
  padding: 20px;
  overflow-y: auto;
  background-color: var(--jy-bg, #F5F6FA);
}
</style>
