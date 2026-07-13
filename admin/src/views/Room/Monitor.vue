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
          <el-tooltip :content="socketStatusMessage" placement="bottom">
            <el-tag :type="socketConnected ? 'success' : 'danger'">
              {{ socketConnected ? '实时更新正常' : '实时更新暂不可用' }}
            </el-tag>
          </el-tooltip>
        </el-form-item>
      </el-form>
    </el-card>

    <div class="room-grid">
      <el-card v-for="room in rooms" :key="room.id" shadow="hover" class="room-card" @click="showTimeline(room)">
        <div class="room-header">
          <span class="room-name">{{ room.name }}</span>
          <el-tag :type="getRoomStatusType(room.currentStatus || room.status)" size="small">{{ getRoomStatusLabel(room.currentStatus || room.status) }}</el-tag>
        </div>
        <div class="room-info">
          <span class="room-type">{{ getTypeLabel(room.type) }}</span>
          <span class="room-capacity">容纳 {{ room.capacity }} 人</span>
        </div>
        <div class="room-timeline-mini" v-if="room.todaySlots?.length">
          <div
            v-for="slot in room.todaySlots.slice(0, 8)"
            :key="slot.time"
            class="timeline-block"
            :class="{ occupied: slot.occupied }"
            :title="slot.detail"
          ></div>
        </div>
        <div class="room-timeline-empty" v-else>暂无今日时间线</div>
        <div class="room-current" v-if="room.currentUser">
          <el-icon><User /></el-icon>
          <span>当前使用：{{ room.currentUser }}</span>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="timelineDialogVisible" :title="`${currentRoom?.name || ''} - 今日使用安排`" width="860px">
      <div class="timeline-overview">
        <div><span>日期</span><strong>{{ timelineDate }}</strong></div>
        <div><span>开放时间</span><strong>{{ roomOpeningHours }}</strong></div>
        <div><span>当前状态</span><strong>{{ getRoomStatusLabel(currentRoom?.currentStatus || currentRoom?.status) }}</strong></div>
        <div><span>预约数量</span><strong>{{ timelineView.summary.reservationCount }}</strong></div>
      </div>

      <div class="timeline-legend" aria-label="时间格图例">
        <span v-for="item in timelineLegend" :key="item.status"><i :class="item.status"></i>{{ item.label }}</span>
      </div>

      <div v-if="timelineLoading" class="timeline-message">正在加载今日安排…</div>
      <div v-else-if="timelineError" class="timeline-message error-message">
        <strong>暂时无法加载</strong>
        <span>请检查网络后重试</span>
        <el-button type="primary" plain @click="retryTimeline">重试</el-button>
      </div>
      <div v-else-if="timelineView.emptyState" class="timeline-message">
        <strong>{{ timelineView.emptyState.title }}</strong>
        <span>{{ timelineView.emptyState.description }}</span>
      </div>
      <div v-else>
        <div v-if="timelineView.message" class="timeline-notice">{{ timelineView.message }}</div>
        <div class="timeline-grid">
          <div v-for="slot in timelineView.slots" :key="`${slot.time}-${slot.reservationId || slot.status}`" class="timeline-slot" :class="slot.status">
            <span class="slot-time">{{ slot.time }}</span>
            <strong>{{ slot.label }}</strong>
            <template v-if="isStudyRoom">
              <small v-if="slot.totalCount">剩余 {{ slot.availableCount }}/{{ slot.totalCount }} 座</small>
            </template>
            <template v-else-if="slot.status === 'reserved' || slot.status === 'using'">
              <small v-if="slot.userName">{{ slot.userName }}</small>
              <small>{{ slot.timeRange }}</small>
              <small v-if="slot.purpose">{{ slot.purpose }}</small>
            </template>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { io } from 'socket.io-client'
import { getList, getTimeline, getBuildings } from '@/api/room'
import { buildMiniTimeline, buildTimelineView } from '@/utils/roomTimeline'

const filters = reactive({ buildingId: '', type: '' })
const rooms = ref([])
const buildingOptions = ref([])
const socketConnected = ref(false)
const socketStatusMessage = ref('实时连接尚未建立')
const timelineDialogVisible = ref(false)
const currentRoom = ref(null)
const timelineLoading = ref(false)
const timelineError = ref(false)
const timelineView = ref(buildTimelineView([]))
const timelineDate = ref('')
let socket = null

const timelineLegend = [
  { status: 'available', label: '空闲' }, { status: 'reserved', label: '已预约' },
  { status: 'using', label: '使用中' }, { status: 'maintenance', label: '维护' }
]
const isStudyRoom = computed(() => currentRoom.value?.type === 'study_room')
const roomOpeningHours = computed(() => {
  const room = currentRoom.value || {}
  const start = timelineView.value.openStartTime || room.openStartTime || room.open_start_time || room.openTime || room.open_time
  const end = timelineView.value.openEndTime || room.openEndTime || room.open_end_time || room.closeTime || room.close_time
  return start && end ? `${start}-${end}` : '以场地当日安排为准'
})

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

function normalizeRoom(room) {
  return {
    ...room,
    todaySlots: room.todaySlots?.length ? room.todaySlots : buildMiniTimeline(room.todayTimeline || room.timeline || [])
  }
}

async function loadRooms() {
  try {
    const res = await getList({ buildingId: filters.buildingId, type: filters.type, pageSize: 100 })
    rooms.value = (res.data?.list || []).map(normalizeRoom)
  } catch (e) {
    // Keep the last successful snapshot visible during a transient refresh failure.
  }
}

async function loadBuildings() {
  try {
    const res = await getBuildings({ pageSize: 100 })
    buildingOptions.value = res.data?.list || []
  } catch (e) {
    // Keep the last successful options visible during a transient refresh failure.
  }
}

async function showTimeline(room) {
  currentRoom.value = room
  timelineDialogVisible.value = true
  timelineDate.value = formatLocalDate(new Date())
  await loadTimeline()
}

function formatLocalDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function loadTimeline() {
  if (!currentRoom.value) return
  timelineLoading.value = true
  timelineError.value = false
  try {
    const res = await getTimeline(currentRoom.value.id, { date: timelineDate.value })
    timelineView.value = buildTimelineView(res.data)
  } catch (e) {
    timelineError.value = true
  } finally {
    timelineLoading.value = false
  }
}

function retryTimeline() {
  loadTimeline()
}

function initSocket() {
  const token = localStorage.getItem('token') || ''
  if (!token) {
    socketConnected.value = false
    socketStatusMessage.value = '实时更新暂不可用，请重新登录'
    return
  }

  socket = io(window.location.origin, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: (callback) => callback({ token: localStorage.getItem('token') || '' }),
    reconnectionAttempts: 5,
    timeout: 8000
  })
  socket.on('connect', () => {
    socketConnected.value = true
    socketStatusMessage.value = '场地状态将自动更新'
  })
  socket.on('disconnect', (reason) => {
    socketConnected.value = false
    socketStatusMessage.value = '实时更新已暂停'
  })
  socket.on('connect_error', (error) => {
    socketConnected.value = false
    socketStatusMessage.value = '实时更新暂不可用'
  })
  socket.on('socket-error', (error) => {
    socketStatusMessage.value = '实时更新暂不可用'
  })
  socket.on('room-status-update', (data) => {
    const idx = rooms.value.findIndex(r => r.id === data.roomId)
    if (idx !== -1) rooms.value[idx] = normalizeRoom({ ...rooms.value[idx], ...data })
  })
}

onMounted(() => {
  loadRooms()
  loadBuildings()
  initSocket()
})

onBeforeUnmount(() => {
  socket?.disconnect()
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
  gap: 8px;
  margin-bottom: 8px;
}

.room-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.room-timeline-empty {
  margin-bottom: 8px;
  font-size: 12px;
  color: #8C8C9A;
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

.timeline-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 18px;
}

.timeline-overview > div {
  padding: 12px;
  background: #f7f8fa;
  border-radius: 8px;
}

.timeline-overview span,
.timeline-overview strong {
  display: block;
}

.timeline-overview span {
  margin-bottom: 5px;
  font-size: 12px;
  color: #8c8c9a;
}

.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-bottom: 14px;
  color: #606266;
  font-size: 13px;
}

.timeline-legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.timeline-legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.timeline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
  max-height: 390px;
  overflow-y: auto;
}

.timeline-slot {
  min-height: 92px;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #f0f9eb;
}

.timeline-slot > * {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.timeline-slot .slot-time {
  margin-bottom: 5px;
  font-size: 12px;
  color: #606266;
}

.timeline-slot small {
  margin-top: 4px;
  color: #606266;
}

.timeline-slot.reserved { background: #fdf6ec; border-color: #e6a23c; }
.timeline-slot.using { background: #ecf5ff; border-color: #409eff; }
.timeline-slot.maintenance { background: #fef0f0; border-color: #f56c6c; }
.timeline-slot.unknown { background: #f4f4f5; border-color: #909399; }
.timeline-legend .available { background: #67c23a; }
.timeline-legend .reserved { background: #e6a23c; }
.timeline-legend .using { background: #409eff; }
.timeline-legend .maintenance { background: #f56c6c; }

.timeline-message {
  min-height: 210px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #8c8c9a;
}

.timeline-message strong {
  color: #303133;
  font-size: 16px;
}

.timeline-notice {
  margin-bottom: 12px;
  padding: 10px 12px;
  color: #3f7d20;
  background: #f0f9eb;
  border-radius: 6px;
}

@media (max-width: 720px) {
  .timeline-overview {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
