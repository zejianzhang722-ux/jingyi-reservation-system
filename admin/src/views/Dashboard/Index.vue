<template>
  <div class="dashboard">
    <section class="overview-strip">
      <div class="overview-copy">
        <div class="eyebrow">今日运营</div>
        <h1>功能房预约工作台</h1>
        <p>集中查看待审核、使用中、异常记录和空间使用趋势。</p>
      </div>
      <el-button type="primary" :icon="Refresh" @click="loadData">刷新数据</el-button>
    </section>

    <el-row :gutter="16" class="stat-cards">
      <el-col :xs="12" :sm="6" v-for="item in statCards" :key="item.key">
        <div class="stat-card" :class="item.key">
          <div class="stat-card-body">
            <div>
              <div class="stat-label">{{ item.label }}</div>
              <div class="stat-value">{{ item.value }}</div>
            </div>
            <el-icon :size="28" class="stat-icon">
              <component :is="item.icon" />
            </el-icon>
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="content-row">
      <el-col :xs="24" :lg="15">
        <el-card shadow="never" class="panel-card">
          <template #header>
            <div class="panel-header">
              <span>近 7 天预约趋势</span>
              <el-tag size="small" type="info">自动统计</el-tag>
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
            <div v-for="item in pendingItems" :key="item.id" class="pending-item">
              <div>
                <el-tag :type="item.tagType || 'warning'" size="small">{{ item.tag || '待处理' }}</el-tag>
                <span class="pending-text">{{ item.text }}</span>
              </div>
              <span class="pending-time">{{ item.time }}</span>
            </div>
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
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { Refresh } from '@element-plus/icons-vue'
import { getDashboard } from '@/api/stats'

const trendChartRef = ref(null)
const pieChartRef = ref(null)
const barChartRef = ref(null)

let trendChart = null
let pieChart = null
let barChart = null

const statCards = ref([
  { key: 'today', label: '今日预约', value: 0, icon: 'Calendar' },
  { key: 'pending', label: '待审核', value: 0, icon: 'Clock' },
  { key: 'using', label: '使用中', value: 0, icon: 'VideoPlay' },
  { key: 'noshow', label: '今日异常', value: 0, icon: 'WarningFilled' }
])

const pendingItems = ref([])

function initTrendChart(data) {
  trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预约', '使用', '异常'] },
    grid: { left: 32, right: 24, bottom: 28, top: 40, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: data?.dates || ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    },
    yAxis: { type: 'value' },
    series: [
      { name: '预约', type: 'line', smooth: true, data: data?.reservations || [18, 22, 20, 26, 24, 31, 28], color: '#0066CC', areaStyle: { opacity: 0.08 } },
      { name: '使用', type: 'line', smooth: true, data: data?.used || [12, 18, 16, 20, 19, 25, 23], color: '#52C41A' },
      { name: '异常', type: 'line', smooth: true, data: data?.noshow || [1, 2, 1, 3, 1, 2, 2], color: '#FF4D4F' }
    ]
  })
}

function initPieChart(data) {
  pieChart = echarts.init(pieChartRef.value)
  pieChart.setOption({
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '42%'],
      label: { formatter: '{b}' },
      data: data || [
        { value: 5, name: '自习室' },
        { value: 5, name: '研讨室' },
        { value: 3, name: '活动空间' },
        { value: 2, name: '影音/多功能' }
      ]
    }]
  })
}

function initBarChart(data) {
  barChart = echarts.init(barChartRef.value)
  const rooms = data?.rooms || ['B228自习室', 'B102研讨室', 'C128影音室', 'D218多功能厅', 'D510自习室']
  const rates = data?.rates || [92, 85, 78, 66, 58]
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
  try {
    const res = await getDashboard()
    const data = res.data || res || {}
    statCards.value[0].value = data.todayReservations || 0
    statCards.value[1].value = data.pendingCount || 0
    statCards.value[2].value = data.usingCount || 0
    statCards.value[3].value = data.noshowCount || 0
    pendingItems.value = data.pendingItems || []

    if (trendChart && data.trend) {
      trendChart.setOption({ xAxis: { data: data.trend.dates }, series: [
        { data: data.trend.reservations },
        { data: data.trend.used },
        { data: data.trend.noshow }
      ] })
    }
    if (pieChart && data.roomTypeStats) pieChart.setOption({ series: [{ data: data.roomTypeStats }] })
    if (barChart && data.usageRanking) {
      barChart.setOption({
        yAxis: { data: data.usageRanking.rooms || [] },
        series: [{ data: data.usageRanking.rates || [] }]
      })
    }
  } catch (e) {
    pendingItems.value = []
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
.dashboard {
  min-height: 100%;
}

.overview-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 16px;
  padding: 22px 24px;
  background: #FFFFFF;
  border: 1px solid var(--jy-border-light, #F0F0F5);
  border-radius: 10px;
  box-shadow: var(--jy-shadow-card, 0 2px 8px rgba(0, 21, 41, 0.06));
}

.eyebrow {
  font-size: 12px;
  color: var(--jy-accent, #C4943A);
  font-weight: 700;
  margin-bottom: 6px;
}

h1 {
  margin: 0;
  font-size: 24px;
  color: var(--jy-text-primary, #1A1A2E);
}

p {
  margin: 6px 0 0;
  color: var(--jy-text-secondary, #8C8C9A);
}

.stat-cards {
  margin-bottom: 16px;
}

.stat-card {
  margin-bottom: 12px;
  border-radius: 10px;
  padding: 20px;
  color: #fff;
  background: #0066CC;
}

.stat-card.pending { background: #C4943A; }
.stat-card.using { background: #2BA471; }
.stat-card.noshow { background: #E8684A; }

.stat-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.stat-label {
  font-size: 14px;
  opacity: 0.9;
}

.stat-value {
  margin-top: 8px;
  font-size: 32px;
  font-weight: 800;
  line-height: 1.1;
}

.stat-icon {
  opacity: 0.86;
}

.content-row {
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
  height: 320px;
}

.pending-list {
  max-height: 320px;
  overflow-y: auto;
}

.pending-item {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
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
