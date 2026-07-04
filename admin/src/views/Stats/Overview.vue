<template>
  <PageShell
    title="数据概览"
    eyebrow="ANALYTICS"
    description="按时间范围和功能房查看预约趋势、使用率、高峰时段、爽约率和用户活跃度。"
  >
    <template #actions>
      <el-button type="primary" @click="loadAllData">刷新统计</el-button>
    </template>

    <FilterBar @search="loadAllData" @reset="resetFilters">
      <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width: 280px" />
      <el-select v-model="filters.roomId" placeholder="功能房" clearable filterable style="width: 220px">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
    </FilterBar>

    <el-row :gutter="16" class="chart-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="card-title">预约趋势</span></template>
          <div ref="trendChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="card-title">使用率统计</span></template>
          <div ref="usageChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="16" class="chart-row">
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="card-title">高峰时段分析</span></template>
          <div ref="peakChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="12">
        <el-card shadow="never">
          <template #header><span class="card-title">爽约率统计</span></template>
          <div ref="noshowChartRef" class="chart-container"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never">
      <template #header><span class="card-title">用户活跃度</span></template>
      <div ref="userChartRef" class="chart-container tall"></div>
    </el-card>
  </PageShell>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { getReservations, getUsageRate, getPeakHours, getNoshow, getUsers } from '@/api/stats'
import { getList as getRoomList } from '@/api/room'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'

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
    roomOptions.value = []
  }
}

function resetFilters() {
  filters.dateRange = null
  filters.roomId = ''
  loadAllData()
}

async function loadAllData() {
  const params = {
    startDate: filters.dateRange?.[0] || '',
    endDate: filters.dateRange?.[1] || '',
    roomId: filters.roomId
  }

  const [reservations, usage, peak, noshow, users] = await Promise.allSettled([
    getReservations(params), getUsageRate(params), getPeakHours(params), getNoshow(params), getUsers(params)
  ])

  renderTrendChart(reservations.status === 'fulfilled' ? reservations.value.data : null)
  renderUsageChart(usage.status === 'fulfilled' ? usage.value.data : null)
  renderPeakChart(peak.status === 'fulfilled' ? peak.value.data : null)
  renderNoshowChart(noshow.status === 'fulfilled' ? noshow.value.data : null)
  renderUserChart(users.status === 'fulfilled' ? users.value.data : null)
}

function renderTrendChart(data) {
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['预约总数', '已使用', '已取消'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: data?.dates || [] },
    yAxis: { type: 'value' },
    series: [
      { name: '预约总数', type: 'line', smooth: true, data: data?.total || [], itemStyle: { color: '#0066CC' } },
      { name: '已使用', type: 'line', smooth: true, data: data?.used || [], itemStyle: { color: '#52C41A' } },
      { name: '已取消', type: 'line', smooth: true, data: data?.cancelled || [], itemStyle: { color: '#FF4D4F' } }
    ]
  })
}

function renderUsageChart(data) {
  if (!usageChart) usageChart = echarts.init(usageChartRef.value)
  usageChart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: data?.rooms || [] },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{ type: 'bar', data: data?.rates || [], barWidth: 30, label: { show: true, position: 'top', formatter: '{c}%' }, itemStyle: { color: '#0066CC' } }]
  })
}

function renderPeakChart(data) {
  if (!peakChart) peakChart = echarts.init(peakChartRef.value)
  peakChart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: data?.hours || [] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: data?.counts || [], itemStyle: { color: '#52C41A' }, barWidth: 20 }]
  })
}

function renderNoshowChart(data) {
  if (!noshowChart) noshowChart = echarts.init(noshowChartRef.value)
  noshowChart.setOption({
    tooltip: { trigger: 'axis', formatter: '{b}: {c}%' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: data?.dates || [] },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{ type: 'line', smooth: true, data: data?.rates || [], itemStyle: { color: '#FA8C16' }, markLine: { data: [{ yAxis: 5, name: '目标线', lineStyle: { color: '#FF4D4F', type: 'dashed' } }] } }]
  })
}

function renderUserChart(data) {
  if (!userChart) userChart = echarts.init(userChartRef.value)
  userChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '新增用户'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: data?.dates || [] },
    yAxis: { type: 'value' },
    series: [
      { name: '活跃用户', type: 'bar', data: data?.active || [], itemStyle: { color: '#0066CC' } },
      { name: '新增用户', type: 'bar', data: data?.newUsers || [], itemStyle: { color: '#52C41A' } }
    ]
  })
}

function handleResize() {
  trendChart?.resize(); usageChart?.resize(); peakChart?.resize(); noshowChart?.resize(); userChart?.resize()
}

onMounted(() => {
  loadRooms()
  loadAllData()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendChart?.dispose(); usageChart?.dispose(); peakChart?.dispose(); noshowChart?.dispose(); userChart?.dispose()
})
</script>

<style scoped>
.chart-row {
  margin-bottom: 0;
}

.card-title {
  font-weight: 700;
}

.chart-container {
  height: 320px;
}

.chart-container.tall {
  height: 300px;
}
</style>
