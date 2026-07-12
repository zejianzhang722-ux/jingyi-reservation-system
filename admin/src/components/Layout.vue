<template>
  <el-container class="layout-container">
    <el-aside :width="isCollapse ? '64px' : '240px'" class="layout-aside">
      <div class="logo-container">
        <div class="logo-mark">敬</div>
        <transition name="fade">
          <div v-show="!isCollapse" class="logo-copy">
            <span class="logo-text">敬一书院</span>
            <span class="logo-subtitle">预约管理平台</span>
          </div>
        </transition>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        router
        background-color="transparent"
        text-color="rgba(255,255,255,0.72)"
        active-text-color="#FFFFFF"
        class="aside-menu"
      >
        <template v-for="section in navigation" :key="section.title">
          <div v-if="!isCollapse" class="menu-section-title">{{ section.title }}</div>
          <el-menu-item
            v-for="item in section.children"
            :key="item.path"
            :index="item.path"
          >
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>
              <span>{{ item.title }}</span>
            </template>
          </el-menu-item>
        </template>
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
            <div class="route-summary">
              <el-breadcrumb separator="/" class="breadcrumb">
                <el-breadcrumb-item>管理后台</el-breadcrumb-item>
                <el-breadcrumb-item v-if="route.meta.parent">{{ route.meta.parent }}</el-breadcrumb-item>
                <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
              </el-breadcrumb>
              <transition name="title-slide" mode="out-in">
                <div class="page-title-row" :key="route.fullPath">
                  <span class="page-title">{{ currentTitle }}</span>
                  <span class="page-subtitle">{{ currentDescription }}</span>
                </div>
              </transition>
            </div>
          </div>
          <div class="header-right">
            <el-button class="quick-btn" :icon="Search" circle @click="quickSearchVisible = true" />
            <el-button
              class="quick-btn notify-btn"
              :icon="Bell"
              circle
              :aria-label="pendingCount > 0 ? `待审核预约，${pendingCount} 条` : '待审核预约'"
              @click="goPending"
            >
              <span
                v-if="pendingCount > 0"
                class="pending-badge"
                role="status"
                :aria-label="`有 ${pendingCount} 条待审核预约`"
              >{{ pendingCount }}</span>
            </el-button>
            <el-tag type="warning" effect="light">{{ roleLabel }}</el-tag>
            <el-dropdown @command="handleCommand">
              <span class="user-info">
                <el-avatar :size="32" class="user-avatar">{{ avatarText }}</el-avatar>
                <span class="user-name">{{ userStore.userInfo.realName || userStore.userInfo.username || '管理员' }}</span>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="dashboard">
                    <el-icon><DataBoard /></el-icon>工作台
                  </el-dropdown-item>
                  <el-dropdown-item divided command="logout">
                    <el-icon><SwitchButton /></el-icon>退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view v-slot="{ Component, route: viewRoute }">
          <transition name="route-fade" mode="out-in">
            <component :is="Component" :key="viewRoute.fullPath" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <el-dialog v-model="quickSearchVisible" title="快速导航" width="520px" class="quick-search-dialog">
      <el-input v-model="quickKeyword" placeholder="输入功能名称，例如：预约、账号、黑名单" clearable autofocus />
      <div class="quick-list">
        <div
          v-for="(item, index) in filteredQuickEntries"
          :key="item.path"
          class="quick-item"
          :style="{ animationDelay: `${index * 32}ms` }"
          @click="goQuick(item.path)"
        >
          <div>
            <div class="quick-title">{{ item.title }}</div>
            <div class="quick-description">{{ item.description }}</div>
          </div>
          <el-icon><ArrowRight /></el-icon>
        </div>
        <el-empty v-if="!filteredQuickEntries.length" description="没有匹配的功能" :image-size="80" />
      </div>
    </el-dialog>
  </el-container>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, Bell } from '@element-plus/icons-vue'
import { useUserStore } from '@/store/user'
import { buildNavigation } from '@/router/adminRoutes'
import { getPendingCount } from '@/api/reservation'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isCollapse = ref(false)
const quickSearchVisible = ref(false)
const quickKeyword = ref('')
const pendingCount = ref(0)
let pendingRequestVersion = 0

const activeMenu = computed(() => route.path)
const currentTitle = computed(() => route.meta.title || '工作台')
const currentDescription = computed(() => route.meta.description || '功能房预约管理后台')
const navigation = computed(() => buildNavigation(userStore.userInfo.role || 'admin'))
const quickEntries = computed(() => navigation.value.flatMap(section => section.children))
const filteredQuickEntries = computed(() => {
  const keyword = quickKeyword.value.trim().toLowerCase()
  if (!keyword) return quickEntries.value
  return quickEntries.value.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(keyword))
})
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

async function loadPendingCount() {
  const requestVersion = ++pendingRequestVersion
  if (!userStore.token) {
    pendingCount.value = 0
    return
  }
  try {
    const count = await getPendingCount()
    if (requestVersion === pendingRequestVersion) pendingCount.value = count
  } catch {
    if (requestVersion === pendingRequestVersion) pendingCount.value = 0
  }
}

watch(() => userStore.token, loadPendingCount, { immediate: true })
watch(() => route.fullPath, loadPendingCount)
onBeforeUnmount(() => { pendingRequestVersion += 1 })

function goPending() {
  const target = userStore.userInfo.role === 'counselor'
    ? '/reservation/counselor'
    : '/reservation/pending'
  router.push(target)
}

function goQuick(path) {
  quickSearchVisible.value = false
  quickKeyword.value = ''
  router.push(path)
}

function handleCommand(command) {
  if (command === 'logout') {
    userStore.logout()
  } else if (command === 'dashboard') {
    router.push('/dashboard')
  }
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
}

.layout-aside {
  background: linear-gradient(180deg, #103B70 0%, #0B1F35 100%);
  transition: width var(--jy-motion-normal, 260ms) var(--jy-motion-spring, cubic-bezier(0.16, 1, 0.3, 1));
  overflow: hidden;
  box-shadow: 2px 0 12px rgba(0, 21, 41, 0.14);
  position: relative;
  z-index: 20;
}

.layout-aside::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at 25% 8%, rgba(196, 148, 58, 0.22), transparent 26%), radial-gradient(circle at 90% 78%, rgba(0, 102, 204, 0.26), transparent 32%);
}

.logo-container {
  height: 68px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(196, 148, 58, 0.28);
  position: relative;
  z-index: 1;
}

.logo-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #C4943A;
  color: #fff;
  font-weight: 800;
  animation: jy-pulse-ring 2.8s ease-out infinite;
}

.logo-copy {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.logo-text {
  color: #FFFFFF;
  font-size: 17px;
  font-weight: 800;
  white-space: nowrap;
  letter-spacing: 1px;
}

.logo-subtitle {
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  white-space: nowrap;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--jy-motion-fast, 160ms) ease, transform var(--jy-motion-fast, 160ms) ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-6px);
}

.aside-menu {
  border-right: none;
  height: calc(100vh - 68px);
  overflow-y: auto;
  padding: 10px 0 18px;
  position: relative;
  z-index: 1;
}

.aside-menu::-webkit-scrollbar {
  width: 0;
}

.menu-section-title {
  padding: 14px 18px 6px;
  color: rgba(255, 255, 255, 0.38);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.aside-menu :deep(.el-menu-item) {
  height: 42px;
  line-height: 42px;
  margin: 3px 10px;
  border-radius: 10px;
  transition: background-color var(--jy-motion-fast, 160ms) ease, transform var(--jy-motion-fast, 160ms) ease, color var(--jy-motion-fast, 160ms) ease;
}

.aside-menu :deep(.el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.08) !important;
  transform: translateX(3px);
}

.aside-menu :deep(.el-menu-item.is-active) {
  background: rgba(0, 102, 204, 0.5) !important;
  color: #FFFFFF !important;
  transform: translateX(3px);
}

.aside-menu :deep(.el-menu-item.is-active)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 24%;
  bottom: 24%;
  width: 3px;
  background: #C4943A;
  border-radius: 0 3px 3px 0;
}

.main-container {
  background-color: var(--jy-bg, #F5F6FA);
}

.layout-header {
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(14px);
  padding: 0;
  height: 68px;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.06);
  z-index: 10;
}

.header-content {
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}

.header-left,
.header-right,
.user-info {
  display: flex;
  align-items: center;
}

.header-left {
  gap: 14px;
  min-width: 0;
}

.header-right {
  gap: 12px;
  flex-shrink: 0;
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: var(--jy-text-secondary, #8C8C9A);
  padding: 6px;
  border-radius: 8px;
  transition: background-color var(--jy-motion-fast, 160ms) ease, transform var(--jy-motion-fast, 160ms) ease;
}

.collapse-btn:hover,
.quick-btn:hover {
  color: var(--jy-primary, #0066CC);
  background-color: var(--jy-primary-bg, rgba(0, 102, 204, 0.08));
  transform: translateY(-1px);
}

.notify-btn {
  position: relative;
}

.pending-badge {
  position: absolute;
  right: -5px;
  top: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--jy-danger, #FF4D4F);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  box-shadow: 0 0 0 2px #fff;
}

.route-summary {
  min-width: 0;
}

.breadcrumb {
  margin-bottom: 4px;
  font-size: 12px;
}

.page-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}

.page-title {
  font-size: 18px;
  font-weight: 800;
  color: var(--jy-text-primary, #1A1A2E);
  white-space: nowrap;
}

.page-subtitle {
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-slide-enter-active,
.title-slide-leave-active {
  transition: opacity var(--jy-motion-fast, 160ms) ease, transform var(--jy-motion-fast, 160ms) ease;
}

.title-slide-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.title-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.quick-btn {
  border: none;
  background: var(--jy-bg, #F5F6FA);
}

.user-info {
  gap: 8px;
  cursor: pointer;
}

.user-avatar {
  background: #0066CC;
  color: #fff;
  font-weight: 700;
  transition: transform var(--jy-motion-fast, 160ms) ease;
}

.user-info:hover .user-avatar {
  transform: rotate(-6deg) scale(1.05);
}

.user-name {
  font-size: 14px;
  color: var(--jy-text-primary, #1A1A2E);
  font-weight: 600;
}

.layout-main {
  padding: 22px;
  overflow-y: auto;
  background-color: var(--jy-bg, #F5F6FA);
}

.route-fade-enter-active,
.route-fade-leave-active {
  transition: opacity var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease), transform var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease), filter var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease);
}

.route-fade-enter-from {
  opacity: 0;
  transform: translateY(12px) scale(0.992);
  filter: blur(2px);
}

.route-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.998);
  filter: blur(1px);
}

.quick-list {
  margin-top: 14px;
  max-height: 420px;
  overflow-y: auto;
}

.quick-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  animation: jy-fade-up var(--jy-motion-normal, 260ms) var(--jy-motion-ease, ease) both;
  transition: background-color var(--jy-motion-fast, 160ms) ease, transform var(--jy-motion-fast, 160ms) ease;
}

.quick-item:hover {
  background: var(--jy-primary-bg, rgba(0, 102, 204, 0.08));
  transform: translateX(4px);
}

.quick-title {
  font-weight: 700;
  color: var(--jy-text-primary, #1A1A2E);
}

.quick-description {
  margin-top: 4px;
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
}
</style>
