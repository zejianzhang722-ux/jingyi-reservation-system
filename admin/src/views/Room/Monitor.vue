<template>
  <div class="monitor-page">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="楼栋">
          <el-select v-model="filters.buildingId" placeholder="全部楼栋" clearable style="width: 150px" @change="loadRooms">
            <el-option v-for="b in buildingOptions" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.type" placeholder="全部类型" clearable style="width: 140px" @change="loadRooms">
            <el-option label="自习室" value="study_room" />
            <el-option label="共享空间" value="seminar_room" />
            <el-option label="影音室" value="media_room" />
            <el-option label="备赛间" value="competition_room" />
            <el-option label="路演空间" value="roadshow_space" />
            <el-option label="舞蹈室" value="dance_room" />
            <el-option label="阅览室" value="reading_room" />
            <el-option label="多功能厅" value="multi_purpose_hall" />
            <el-option label="学业辅导" value="study_center" />
            <el-option label="就业创业" value="career_center" />
            <el-option label="党团活动" value="party_room" />
            <el-option label="心理咨询" value="psychology_room" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadRooms">刷新</el-button>
        </el-form-item>
        <el-form-item>
          <el-tag :type="socketConnected ? 'success' : 'danger'">
            {{ socketConnected ? 'WebSocket 已连接' : 'WebSocket 未连接' }}
          </el-tag>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="room-grid">
      <el-card v-for="room in rooms" :key="room.id" shadow="hover" class="room-card" @click="showTimeline(room)">
        <div class="room-header">
          <span class="room-name">{{ room.name }}</span>
          <el-tag :type="getRoomStatusType(room.status)" size="small">{{ getRoomStatusLabel(room.status) }}</el-tag>
        </div>
        <div class="room-info">
          <span class="room-type">{{ getTypeLabel(room.type) }}</span>
          <span class="room-capacity">容纳 {{ room.capacity }} 人</span>
        </div>
        <div class="room-timeline-mini">
          <div v-for="slot in room.todaySlots?.slice(0, 8)" :key="slot.time" class="timeline-block" :class="{ occupied: slot.occupied }" :title="`${slot.time} ${slot.occupied ? slot.userName : '空闲'}`"></div>
        </div>
        <div class="room-current" v-if="room.currentUser">
          <el-icon><User /></el-icon>
          <span>当前使用：{{ room.currentUser }}</span>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="timelineDialogVisible" :title="`${currentRoom?.name || ''} - 时间线详情`" width="700px">
      <div ref="timelineDetailRef" class="timeline-chart"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { getList, getTimeline } from '@/api/room'
import { getBuildings } from '@/api/room'

const filters = reactive({ buildingId: '', type: '' })
const rooms = ref([])
const buildingOptions = ref([])
const socketConnected = ref(false)
const timelineDialogVisible = ref(false)
const currentRoom = ref(null)
const timelineDetailRef = ref(null)
let timelineChart = null
let socket = null

const typeLabels = {
  study_room: '自习室', seminar_room: '共享空间', media_room: '影音室',
  competition_room: '备赛间', roadshow_space: '路演空间', dance_room: '舞蹈室',
  reading_room: '阅览室', multi_purpose_hall: '多功能厅', study_center: '学业辅导',
  career_center: '就业创业', party_room: '党团活动', psychology_room: '心理咨询',
  tutor: '团员模范岗', mentor_room: '导师交流室', job_studio: '求职就业',
  innovation_workshop: '创新工作坊', national_defense_studio: '国防教育'
}

function getTypeLabel(type) {
  return typeLabels[type] || type
}

function getRoomStatusType(status) {
  const map = { free: 'success', using: '', reserved: 'warning', maintenance: 'danger', open: 'success', closed: 'info' }
  return map[status] || 'info'
}

function getRoomStatusLabel(status) {
  const map = { free: '空闲', using: '使用中', reserved: '已预约', maintenance: '维护中', open: '开放', closed: '关闭' }
  return map[status] || '未知'
}

async function loadRooms() {
  try {
    const res = await getList({ buildingId: filters.buildingId, type: filters.type, pageSize: 100 })
    rooms.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function loadBuildings() {
  try {
    const res = await getBuildings({ pageSize: 100 })
    buildingOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function showTimeline(room) {
  currentRoom.value = room
  timelineDialogVisible.value = true
  try {
    const res = await getTimeline(room.id, { date: new Date().toISOString().slice(0, 10) })
    renderTimeline(res.data)
  } catch (e) {
    renderTimeline(null)
  }
}

function renderTimeline(data) {
  setTimeout(() => {
    if (timelineChart) {
      timelineChart.dispose()
    }
    if (!timelineDetailRef.value) return
    timelineChart = echarts.init(timelineDetailRef.value)
    const hours = Array.from({ length: 14 }, (_, i) => `${i + 8}:00`)
    const slots = data?.slots || hours.map(() => ({ occupied: false, userName: '' }))
    const option = {
      tooltip: {
        formatter: (p) => {
          const s = slots[p.dataIndex]
          return `${hours[p.dataIndex]} ${s.occupied ? `占用 (${s.userName})` : '空闲'}`
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
      xAxis: { type: 'category', data: hours },
      yAxis: { type: 'category', data: ['状态'], axisLabel: { show: false } },
      series: [
        {
          type: 'heatmap',
          data: slots.map((s, i) => [i, 0, s.occupied ? 1 : 0]),
          label: {
            show: true,
            formatter: (p) => slots[p.dataIndex].occupied ? '占用' : '空闲',
            color: '#fff'
          },
          visualMap: false,
          itemStyle: {
            color: (p) => slots[p.dataIndex].occupied ? '#FF4D4F' : '#52C41A'
          }
        }
      ]
    }
    timelineChart.setOption(option)
  }, 100)
}

function initSocket() {
  socket = io(window.location.origin, { path: '/socket.io', transports: ['websocket'] })
  socket.on('connect', () => { socketConnected.value = true })
  socket.on('disconnect', () => { socketConnected.value = false })
  socket.on('room-status-update', (data) => {
    const idx = rooms.value.findIndex(r => r.id === data.roomId)
    if (idx !== -1) {
      rooms.value[idx] = { ...rooms.value[idx], ...data }
    }
  })
}

onMounted(() => {
  loadRooms()
  loadBuildings()
  initSocket()
})

onBeforeUnmount(() => {
  socket?.disconnect()
  timelineChart?.dispose()
})
</script>

<style scoped>
.monitor-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
}

.room-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.room-card {
  cursor: pointer;
  transition: transform 0.2s;
}

.room-card:hover {
  transform: translateY(-2px);
}

.room-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.room-name {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.room-info {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #999;
}

.room-timeline-mini {
  display: flex;
  gap: 2px;
  margin-bottom: 8px;
}

.timeline-block {
  flex: 1;
  height: 8px;
  background-color: #52C41A;
  border-radius: 2px;
}

.timeline-block.occupied {
  background-color: #FF4D4F;
}

.room-current {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: #0066CC;
}

.timeline-chart {
  height: 200px;
}
</style>
