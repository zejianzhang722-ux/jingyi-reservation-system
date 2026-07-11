<template>
  <PageShell
    :title="dashboardCopy.title"
    eyebrow="今日概览"
    :description="dashboardCopy.description"
  >
    <template #actions>
      <el-button v-for="item in shortcuts" :key="item.name" @click="router.push(item.destination)">{{ item.title }}</el-button>
      <el-button type="primary" :icon="Refresh" @click="loadData">刷新数据</el-button>
    </template>

    <el-alert v-if="dashboardError" type="error" :closable="false" show-icon class="dashboard-error">
      <template #title>
        数据加载失败，已保留上次成功结果
        <el-button link type="primary" @click="loadData">重试</el-button>
      </template>
    </el-alert>

    <el-row :gutter="16" class="stat-cards">
      <el-col :xs="12" :sm="6" v-for="item in statCards" :key="item.key">
        <MetricCard :label="item.label" :value="item.value" :caption="item.caption" :icon="item.icon" :tone="item.tone" />
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :xs="24" :lg="15">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span>近 7 天预约趋势</span>
              <el-tag size="small" type="info">实时统计</el-tag>
            </div>
          </template>
          <div ref="trendChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="9">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span>待处理事项</span>
              <el-tag size="small" type="danger">{{ pendingItems.length }}</el-tag>
            </div>
          </template>
          <div class="pending-list" v-if="pendingItems.length">
            <button v-for="item in pendingItems" :key="item.id" class="pending-item" type="button" @click="router.push(item.destination)">
              <div>
                <el-tag :type="item.tagType || 'warning'" size="small">{{ item.tag || '待处理' }}</el-tag>
                <span class="pending-text">{{ item.text }}</span>
              </div>
              <span class="pending-time">{{ item.time }}</span>
            </button>
          </div>
          <el-empty v-else description="暂无待处理事项" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span>功能房使用率排行</span>
            </div>
          </template>
          <div ref="barChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span>空间类型分布</span>
            </div>
          </template>
          <div ref="pieChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import { getDashboard } from '@/api/stats'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import { useUserStore } from '@/store/user'
import { ROLE_DASHBOARD_COPY, ROLE_SHORTCUTS } from '@/utils/adminRolePolicy'

const router = useRouter()
const userStore = useUserStore()
const role = computed(() => userStore.userInfo?.role || 'admin')
const dashboardCopy = computed(() => ROLE_DASHBOARD_COPY[role.value] || ROLE_DASHBOARD_COPY.admin)
const shortcuts = computed(() => ROLE_SHORTCUTS[role.value] || ROLE_SHORTCUTS.admin)

const trendChartRef = ref(null)
const pieChartRef = ref(null)
const barChartRef = ref(null)

let trendChart = null
let pieChart = null
let barChart = null

const metricDefinitions = [
  { key: 'today', caption: '今日提交和生效预约', icon: 'Calendar', tone: 'primary' },
  { key: 'pending', caption: '需要当前角色处理', icon: 'Clock', tone: 'warning' },
  { key: 'using', caption: '当前正在使用', icon: 'VideoPlay', tone: 'success' },
  { key: 'noshow', caption: '迟到、爽约和异常', icon: 'WarningFilled', tone: 'danger' }
]
const metricValues = ref([0, 0, 0, 0])
const statCards = computed(() => metricDefinitions.map((item, index) => ({
  ...item,
  label: dashboardCopy.value.metrics[index],
  value: metricValues.value[index]
})))

const pendingItems = ref([])
const dashboardError = ref(false)

function initTrendChart(data) {
  trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预约', '使用', '异常'] },
    grid: { left: 32, right: 24, bottom: 28, top: 40, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data?.dates || []
    },
    yAxis: { type: 'value' },
    series: [
      { name: '预约', type: 'line', smooth: true, data: data?.reservations || [], color: '#0066CC', areaStyle: { opacity: 0.08 } },
      { name: '使用', type: 'line', smooth: true, data: data?.used || [], color: '#52C41A' },
      { name: '异常', type: 'line', smooth: true, data: data?.noshow || [], color: '#FF4D4F' }
    ]
  })
}

function initPieChart(data) {
  pieChart = echarts.init(pieChartRef.value)
  pieChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { type: 'scroll', bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '40%'],
      label: { formatter: '{b}' },
      data: data || []
    }]
  })
}

function initBarChart(data) {
  barChart = echarts.init(barChartRef.value)
  const rooms = data?.rooms || []
  const rates = data?.rates || []
  barChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 24, right: 32, bottom: 24, top: 24, containLabel: true },
    xAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
    yAxis: { type: 'category', data: rooms },
    series: [{
      type: 'bar',
      data: rates,
      barWidth: 18,
      color: '#0066CC',
      label: { show: true, position: 'right', formatter: '{c}%' }
    }]
  })
}

async function loadData() {
  dashboardError.value = false
  try {
    const res = await getDashboard()
    const data = res.data || res || {}
    metricValues.value = [data.todayReservations || 0, data.pendingCount || 0, data.usingCount || 0, data.noshowCount || 0]
    const defaultDestination = role.value === 'counselor' ? '/reservation/counselor' : '/reservation/pending'
    pendingItems.value = (data.pendingItems || []).map(item => ({ ...item, destination: item.destination || defaultDestination }))

    if (trendChart) {
      trendChart.setOption({ xAxis: { data: data.trend?.dates || [] }, series: [
        { data: data.trend?.reservations || [] },
        { data: data.trend?.used || [] },
        { data: data.trend?.noshow || [] }
      ] })
    }
    if (pieChart) pieChart.setOption({ series: [{ data: data.roomTypeStats || [] }] })
    if (barChart) {
      barChart.setOption({
        yAxis: { data: data.usageRanking?.rooms || [] },
        series: [{ data: data.usageRanking?.rates || [] }]
      })
    }
  } catch (e) {
    dashboardError.value = true
  }
}

function handleResize() {
  trendChart?.resize()
  pieChart?.resize()
  barChart?.resize()
}

onMounted(() => {
  initTrendChart()
  initPieChart()
  initBarChart()
  loadData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  pieChart?.dispose()
  barChart?.dispose()
})
</script>

<style scoped>
.stat-cards,
.content-row {
  margin-bottom: 16px;
}

.dashboard-error {
  margin-bottom: 16px;
}

.panel-card {
  border-radius: 10px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
}

.chart-container {
  height: 360px;
}

.pending-list {
  max-height: 320px;
  overflow-y: auto;
}

.pending-item {
  width: 100%;
  background: transparent;
  cursor: pointer;
  text-align: left;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border: 0;
  border-bottom: 1px solid var(--jy-border-light, #F0F0F5);
}

.pending-item:last-child {
  border-bottom: none;
}

.pending-text {
  margin-left: 8px;
  font-size: 14px;
  color: var(--jy-text-primary, #1A1A2E);
}

.pending-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
}
</style>


