<template>
  <div class="overview-page">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="时间范围">
          <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width: 260px" />
        </el-form-item>
        <el-form-item label="功能房">
          <el-select v-model="filters.roomId" placeholder="全部" clearable style="width: 160px">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAllData">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-row :gutter="20" class="chart-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">预约趋势</span></template>
          <div ref="trendChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">使用率统计</span></template>
          <div ref="usageChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="chart-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">高峰时段分析</span></template>
          <div ref="peakChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="hover">
          <template #header><span class="card-title">爽约率统计</span></template>
          <div ref="noshowChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="24">
        <el-card shadow="hover">
          <template #header><span class="card-title">用户活跃度</span></template>
          <div ref="userChartRef" class="chart-container" style="height: 300px;"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { getReservations, getUsageRate, getPeakHours, getNoshow, getUsers } from '@/api/stats'
import { getList as getRoomList } from '@/api/room'

const trendChartRef = ref(null)
const usageChartRef = ref(null)
const peakChartRef = ref(null)
const noshowChartRef = ref(null)
const userChartRef = ref(null)

let trendChart = null
let usageChart = null
let peakChart = null
let noshowChart = null
let userChart = null

const roomOptions = ref([])
const filters = reactive({ dateRange: null, roomId: '' })

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function loadAllData() {
  const params = {
    startDate: filters.dateRange?.[0] || '',
    endDate: filters.dateRange?.[1] || '',
    roomId: filters.roomId
  }

  try {
    const [reservations, usage, peak, noshow, users] = await Promise.allSettled([
      getReservations(params),
      getUsageRate(params),
      getPeakHours(params),
      getNoshow(params),
      getUsers(params)
    ])

    renderTrendChart(reservations.status === 'fulfilled' ? reservations.value.data : null)
    renderUsageChart(usage.status === 'fulfilled' ? usage.value.data : null)
    renderPeakChart(peak.status === 'fulfilled' ? peak.value.data : null)
    renderNoshowChart(noshow.status === 'fulfilled' ? noshow.value.data : null)
    renderUserChart(users.status === 'fulfilled' ? users.value.data : null)
  } catch (e) {
    // handled
  }
}

function renderTrendChart(data) {
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  const dates = data?.dates || ['1月', '2月', '3月', '4月', '5月', '6月']
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['预约总数', '已使用', '已取消'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value' },
    series: [
      { name: '预约总数', type: 'line', smooth: true, data: data?.total || [320, 410, 390, 520, 480, 610], itemStyle: { color: '#0066CC' } },
      { name: '已使用', type: 'line', smooth: true, data: data?.used || [280, 360, 340, 470, 420, 550], itemStyle: { color: '#52C41A' } },
      { name: '已取消', type: 'line', smooth: true, data: data?.cancelled || [20, 30, 25, 35, 28, 40], itemStyle: { color: '#FF4D4F' } }
    ]
  }
  trendChart.setOption(option)
}

function renderUsageChart(data) {
  if (!usageChart) usageChart = echarts.init(usageChartRef.value)
  const rooms = data?.rooms || ['自习室A', '会议室B', '活动室C', '阅览室D', '琴房E']
  const rates = data?.rates || [85, 72, 65, 90, 55]
  const option = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: rooms },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'bar',
      data: rates.map(v => ({
        value: v,
        itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#0066CC' },
          { offset: 1, color: '#3399FF' }
        ])}
      })),
      barWidth: 30,
      label: { show: true, position: 'top', formatter: '{c}%' }
    }]
  }
  usageChart.setOption(option)
}

function renderPeakChart(data) {
  if (!peakChart) peakChart = echarts.init(peakChartRef.value)
  const hours = data?.hours || Array.from({ length: 14 }, (_, i) => `${i + 8}:00`)
  const counts = data?.counts || [5, 12, 25, 38, 42, 35, 28, 45, 52, 48, 30, 18, 8, 2]
  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: hours },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: counts,
      itemStyle: { color: (p) => counts[p.dataIndex] >= 40 ? '#FF4D4F' : counts[p.dataIndex] >= 25 ? '#FA8C16' : '#52C41A' },
      barWidth: 20
    }]
  }
  peakChart.setOption(option)
}

function renderNoshowChart(data) {
  if (!noshowChart) noshowChart = echarts.init(noshowChartRef.value)
  const dates = data?.dates || ['1月', '2月', '3月', '4月', '5月', '6月']
  const rates = data?.rates || [5.2, 4.8, 6.1, 5.5, 4.2, 3.8]
  const option = {
    tooltip: { trigger: 'axis', formatter: '{b}: {c}%' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{
      type: 'line',
      smooth: true,
      data: rates,
      itemStyle: { color: '#FA8C16' },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(250,140,22,0.3)' },
        { offset: 1, color: 'rgba(250,140,22,0.02)' }
      ])},
      markLine: { data: [{ yAxis: 5, name: '目标线', lineStyle: { color: '#FF4D4F', type: 'dashed' } }] }
    }]
  }
  noshowChart.setOption(option)
}

function renderUserChart(data) {
  if (!userChart) userChart = echarts.init(userChartRef.value)
  const dates = data?.dates || ['1月', '2月', '3月', '4月', '5月', '6月']
  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '新增用户'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: dates },
    yAxis: { type: 'value' },
    series: [
      { name: '活跃用户', type: 'bar', data: data?.active || [150, 180, 200, 230, 260, 290], itemStyle: { color: '#0066CC' } },
      { name: '新增用户', type: 'bar', data: data?.newUsers || [30, 45, 35, 50, 40, 55], itemStyle: { color: '#52C41A' } }
    ]
  }
  userChart.setOption(option)
}

function handleResize() {
  trendChart?.resize()
  usageChart?.resize()
  peakChart?.resize()
  noshowChart?.resize()
  userChart?.resize()
}

onMounted(() => {
  loadRooms()
  loadAllData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose()
  usageChart?.dispose()
  peakChart?.dispose()
  noshowChart?.dispose()
  userChart?.dispose()
})
</script>

<style scoped>
.overview-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
}

.chart-row {
  margin-bottom: 0;
}

.chart-container {
  height: 320px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}
</style>
