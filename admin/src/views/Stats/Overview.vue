<template>
  <PageShell
    title="数据概览"
    eyebrow="数据统计"
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
import {
  formatReservationTrend,
  formatUsageRate,
  formatPeakHours,
  formatNoshowRate,
  formatUserActivity,
  getRangeDays
} from '@/utils/statsFormatters'

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

  const rangeDays = getRangeDays(params.startDate, params.endDate)
  renderTrendChart(formatReservationTrend(reservations.status === 'fulfilled' ? reservations.value.data : null))
  renderUsageChart(formatUsageRate(usage.status === 'fulfilled' ? usage.value.data : null, rangeDays))
  renderPeakChart(formatPeakHours(peak.status === 'fulfilled' ? peak.value.data : null))
  renderNoshowChart(formatNoshowRate(noshow.status === 'fulfilled' ? noshow.value.data : null))
  renderUserChart(formatUserActivity(users.status === 'fulfilled' ? users.value.data : null))
}

function renderTrendChart(data) {
  if (!trendChart) trendChart = echarts.init(trendChartRef.value)
  const empty = !data?.dates?.length
  trendChart.setOption({
    title: empty ? { text: '暂无预约趋势数据', left: 'center', top: 'middle', textStyle: { color: '#8C8C9A', fontSize: 14 } } : undefined,
    tooltip: { trigger: 'axis' },
    legend: { data: ['预约总数', '已使用', '已取消'] },
    grid: { left: 36, right: 24, bottom: 72, top: 34, containLabel: true },
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
  const empty = !data?.rooms?.length
  usageChart.setOption({
    title: empty ? { text: '暂无使用率数据', left: 'center', top: 'middle', textStyle: { color: '#8C8C9A', fontSize: 14 } } : undefined,
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 36, right: 24, bottom: 72, top: 34, containLabel: true },
    xAxis: { type: 'category', data: data?.rooms || [], axisLabel: { interval: 0, rotate: 28, overflow: 'truncate', width: 88 } },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{ type: 'bar', data: data?.rates || [], barWidth: 30, label: { show: true, position: 'top', formatter: '{c}%' }, itemStyle: { color: '#0066CC' } }]
  })
}

function renderPeakChart(data) {
  if (!peakChart) peakChart = echarts.init(peakChartRef.value)
  const empty = !data?.hours?.length
  peakChart.setOption({
    title: empty ? { text: '暂无高峰时段数据', left: 'center', top: 'middle', textStyle: { color: '#8C8C9A', fontSize: 14 } } : undefined,
    tooltip: { trigger: 'axis' },
    grid: { left: 36, right: 24, bottom: 34, top: 54, containLabel: true },
    xAxis: { type: 'category', data: data?.hours || [] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: data?.counts || [], itemStyle: { color: '#52C41A' }, barWidth: 20 }]
  })
}

function renderNoshowChart(data) {
  if (!noshowChart) noshowChart = echarts.init(noshowChartRef.value)
  const empty = !data?.labels?.length
  noshowChart.setOption({
    title: empty ? { text: '暂无爽约数据', left: 'center', top: 'middle', textStyle: { color: '#8C8C9A', fontSize: 14 } } : undefined,
    tooltip: { trigger: 'axis', formatter: '{b}: {c}%' },
    grid: { left: 36, right: 24, bottom: 72, top: 34, containLabel: true },
    xAxis: { type: 'category', data: data?.labels || [], axisLabel: { interval: 0, rotate: 28, overflow: 'truncate', width: 88 } },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [{ type: 'bar', data: data?.rates || [], itemStyle: { color: '#FA8C16' }, label: { show: true, position: 'top', formatter: '{c}%' } }]
  })
}

function renderUserChart(data) {
  if (!userChart) userChart = echarts.init(userChartRef.value)
  const empty = !data?.dates?.length
  userChart.setOption({
    title: empty ? { text: '暂无用户活跃数据', left: 'center', top: 'middle', textStyle: { color: '#8C8C9A', fontSize: 14 } } : undefined,
    tooltip: { trigger: 'axis' },
    legend: { data: ['活跃用户', '新增用户'] },
    grid: { left: 36, right: 24, bottom: 72, top: 34, containLabel: true },
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
  margin-bottom: 16px;
}

.card-title {
  font-weight: 700;
}

.chart-container {
  height: 380px;
}

.chart-container.tall {
  height: 360px;
}
</style>




