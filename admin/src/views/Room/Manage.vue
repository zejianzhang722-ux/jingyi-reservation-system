<template>
  <PageShell
    title="功能房管理"
    eyebrow="SPACE MANAGEMENT"
    description="统一维护功能房信息、开放状态和座位数据；座位编辑支持保存与撤销，避免只在前端临时修改。"
  >
    <template #actions>
      <el-button type="primary" @click="handleAdd">
        <el-icon><Plus /></el-icon>新增功能房
      </el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="房间总数" :value="pagination.total" caption="当前筛选范围内" icon="OfficeBuilding" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="开放中" :value="openCount" caption="本页开放空间" icon="CircleCheck" tone="success" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="维护/关闭" :value="inactiveCount" caption="本页不可预约空间" icon="Warning" tone="warning" />
      </el-col>
    </el-row>

    <FilterBar @search="loadData" @reset="resetFilters">
      <el-input v-model="filters.keyword" placeholder="搜索名称/描述" clearable style="width: 220px" @keyup.enter="loadData" />
      <el-select v-model="filters.type" placeholder="类型" clearable style="width: 180px">
        <el-option v-for="item in roomTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
      </el-select>
      <el-select v-model="filters.buildingId" placeholder="楼栋" clearable style="width: 160px">
        <el-option v-for="b in buildingOptions" :key="b.id" :label="b.name" :value="b.id" />
      </el-select>
      <el-select v-model="filters.status" placeholder="状态" clearable style="width: 140px">
        <el-option label="开放" value="open" />
        <el-option label="关闭" value="closed" />
        <el-option label="维护中" value="maintenance" />
      </el-select>
    </FilterBar>

    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column prop="type" label="类型" width="130">
          <template #default="{ row }">
            <el-tag size="small">{{ typeLabels[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="building_name" label="楼栋" width="110" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column prop="capacity" label="容量" width="90" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type" size="small">{{ statusMap[row.status]?.label || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="success" size="small" link @click="handleSeats(row)">座位</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">关闭</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑功能房' : '新增功能房'" width="620px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入功能房名称" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%">
            <el-option v-for="item in roomTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼栋" prop="buildingId">
          <el-select v-model="form.buildingId" placeholder="请选择楼栋" style="width: 100%">
            <el-option v-for="b in buildingOptions" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="楼层" prop="floor">
              <el-input-number v-model="form.floor" :min="1" :max="30" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="容量" prop="capacity">
              <el-input-number v-model="form.capacity" :min="1" :max="500" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="状态" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="开放" value="open" />
            <el-option label="关闭" value="closed" />
            <el-option label="维护中" value="maintenance" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入描述" />
        </el-form-item>
        <el-form-item label="设施设备">
          <el-checkbox-group v-model="form.facilities">
            <el-checkbox label="projector" value="projector">投影仪</el-checkbox>
            <el-checkbox label="whiteboard" value="whiteboard">白板</el-checkbox>
            <el-checkbox label="aircon" value="aircon">空调</el-checkbox>
            <el-checkbox label="wifi" value="wifi">WiFi</el-checkbox>
            <el-checkbox label="power" value="power">电源插座</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="seatDialogVisible" :title="'座位编辑 - ' + seatRoomName" width="860px" @close="revertSeatChanges">
      <div class="seat-toolbar">
        <div>
          <div class="seat-title">共 {{ seatList.length }} 个座位</div>
          <div class="seat-tip">新增、删除和状态调整需要点击“保存座位变更”才会提交。</div>
        </div>
        <div class="seat-actions">
          <el-button size="small" @click="addSeat">添加座位</el-button>
          <el-button size="small" @click="revertSeatChanges" :disabled="!seatDirty">撤销变更</el-button>
          <el-button type="primary" size="small" :loading="seatSaving" :disabled="!seatDirty" @click="saveSeatChanges">保存座位变更</el-button>
        </div>
      </div>

      <div class="seat-grid" v-if="seatList.length">
        <div v-for="(seat, index) in seatList" :key="seat.localKey" class="seat-card" :class="seat.status">
          <div class="seat-card-head">
            <el-input v-model="seat.seat_number" size="small" @change="markSeatDirty" />
            <el-button type="danger" size="small" link @click="removeSeat(index)">删除</el-button>
          </div>
          <div class="seat-card-body">
            <el-select v-model="seat.status" size="small" @change="markSeatDirty">
              <el-option label="可用" value="available" />
              <el-option label="停用" value="disabled" />
              <el-option label="维护中" value="maintenance" />
            </el-select>
            <el-switch v-model="seat.has_power" :active-value="1" :inactive-value="0" size="small" active-text="电源" @change="markSeatDirty" />
          </div>
        </div>
      </div>
      <el-empty v-else description="暂无座位，可点击添加座位" />
    </el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getList, create, update, deleteRoom, getBuildings, updateSeat, deleteSeat, createSeats } from '@/api/room'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const buildingOptions = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)

const roomTypeOptions = [
  { label: '自习室', value: 'study_room' },
  { label: '研讨室', value: 'seminar_room' },
  { label: '共享空间', value: 'shared_space' },
  { label: '影音室', value: 'media_room' },
  { label: '备赛间', value: 'competition_room' },
  { label: '路演空间', value: 'roadshow_space' },
  { label: '舞蹈室', value: 'dance_room' },
  { label: '阅览室', value: 'reading_room' },
  { label: '多功能厅', value: 'multi_purpose_hall' },
  { label: '学业辅导中心', value: 'study_center' },
  { label: '生涯发展咨询室', value: 'career_center' },
  { label: '求职就业工作室', value: 'job_studio' },
  { label: '创新工作坊', value: 'innovation_workshop' },
  { label: '党团活动室', value: 'party_room' },
  { label: '国防教育工作室', value: 'national_defense_studio' },
  { label: '导师交流室', value: 'mentor_room' },
  { label: '心理咨询室', value: 'psychology_room' },
  { label: '团员模范岗', value: 'tutor' }
]

const typeLabels = roomTypeOptions.reduce((map, item) => ({ ...map, [item.value]: item.label }), {})
const statusMap = { open: { label: '开放', type: 'success' }, closed: { label: '关闭', type: 'info' }, maintenance: { label: '维护中', type: 'danger' } }

const filters = reactive({ keyword: '', type: '', buildingId: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ id: null, name: '', type: '', buildingId: '', floor: 1, capacity: 10, status: 'open', description: '', facilities: [] })
const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  capacity: [{ required: true, message: '请输入容量', trigger: 'blur' }]
}

const openCount = computed(() => tableData.value.filter(item => item.status === 'open').length)
const inactiveCount = computed(() => tableData.value.filter(item => item.status !== 'open').length)

const seatDialogVisible = ref(false)
const seatRoomName = ref('')
const seatRoomId = ref(null)
const seatList = ref([])
const originalSeatList = ref([])
const removedSeatIds = ref([])
const seatDirty = ref(false)
const seatSaving = ref(false)

async function loadData() {
  loading.value = true
  try {
    const res = await getList({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    tableData.value = []
    pagination.total = 0
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { keyword: '', type: '', buildingId: '', status: '' })
  pagination.page = 1
  loadData()
}

async function loadBuildings() {
  try {
    const res = await getBuildings({ pageSize: 100 })
    buildingOptions.value = res.data?.list || []
  } catch (e) {
    buildingOptions.value = []
  }
}

function handleAdd() {
  isEdit.value = false
  resetForm()
  dialogVisible.value = true
}

function mapFacilities(row) {
  if (Array.isArray(row.facilities)) return row.facilities
  if (!row.facilities || typeof row.facilities !== 'string') return []
  const facMap = { 'WiFi': 'wifi', '电源': 'power', '电源插座': 'power', '空调': 'aircon', '投影': 'projector', '投影仪': 'projector', '白板': 'whiteboard' }
  return row.facilities.split(',').map(f => facMap[f.trim()] || f.trim()).filter(Boolean)
}

function handleEdit(row) {
  isEdit.value = true
  Object.assign(form, { id: row.id, name: row.name, type: row.type, buildingId: row.building_id, floor: row.floor, capacity: row.capacity, status: row.status, description: row.description || '', facilities: mapFacilities(row) })
  dialogVisible.value = true
}

function resetForm() {
  Object.assign(form, { id: null, name: '', type: '', buildingId: '', floor: 1, capacity: 10, status: 'open', description: '', facilities: [] })
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitLoading.value = true
  try {
    if (isEdit.value) {
      await update(form.id, form)
      ElMessage.success('更新成功')
    } else {
      await create(form)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (e) {
    // handled by interceptor
  } finally {
    submitLoading.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认关闭功能房“${row.name}”？`, '提示', { type: 'warning' })
    await deleteRoom(row.id)
    ElMessage.success('已关闭')
    loadData()
  } catch (e) {
    // cancelled
  }
}

function normalizeSeat(row) {
  return { ...row, localKey: row.id ? 'seat-' + row.id : 'new-' + Date.now() + '-' + Math.random(), isNew: !row.id }
}

function markSeatDirty() {
  seatDirty.value = true
}

async function handleSeats(row) {
  seatRoomName.value = row.name
  seatRoomId.value = row.id
  await loadSeats(row.id)
  seatDialogVisible.value = true
}

async function loadSeats(roomId) {
  try {
    const res = await request.get('/admin/rooms/' + roomId + '/seats')
    const list = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.list || [])
    seatList.value = list.map(normalizeSeat)
    originalSeatList.value = JSON.parse(JSON.stringify(seatList.value))
    removedSeatIds.value = []
    seatDirty.value = false
  } catch (e) {
    seatList.value = []
    originalSeatList.value = []
  }
}

function addSeat() {
  const nextNum = seatList.value.length + 1
  seatList.value.push(normalizeSeat({
    seat_number: String(nextNum).padStart(2, '0'),
    row_num: Math.ceil(nextNum / 6),
    col_num: ((nextNum - 1) % 6) + 1,
    status: 'available',
    has_power: 1
  }))
  markSeatDirty()
}

function removeSeat(index) {
  const seat = seatList.value[index]
  if (seat.id) removedSeatIds.value.push(seat.id)
  seatList.value.splice(index, 1)
  markSeatDirty()
}

function revertSeatChanges() {
  seatList.value = JSON.parse(JSON.stringify(originalSeatList.value))
  removedSeatIds.value = []
  seatDirty.value = false
}

async function saveSeatChanges() {
  seatSaving.value = true
  try {
    for (const id of removedSeatIds.value) {
      await deleteSeat(seatRoomId.value, id)
    }
    const newSeats = seatList.value.filter(seat => seat.isNew)
    if (newSeats.length) {
      await createSeats(seatRoomId.value, {
        roomId: seatRoomId.value,
        count: newSeats.length,
        startNumber: Math.max(1, seatList.value.length - newSeats.length + 1),
        rowSize: 6
      })
    }
    for (const seat of seatList.value.filter(seat => !seat.isNew && seat.id)) {
      await updateSeat(seatRoomId.value, seat.id, { seatNumber: seat.seat_number, status: seat.status, hasPower: seat.has_power })
    }
    ElMessage.success('座位变更已保存')
    await loadSeats(seatRoomId.value)
    loadData()
  } catch (e) {
    // handled by interceptor
  } finally {
    seatSaving.value = false
  }
}

onMounted(() => {
  loadData()
  loadBuildings()
})
</script>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.seat-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.seat-title {
  font-weight: 700;
  color: var(--jy-text-primary, #1A1A2E);
}

.seat-tip {
  margin-top: 4px;
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
}

.seat-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
  max-height: 520px;
  overflow-y: auto;
}

.seat-card {
  padding: 12px;
  border: 1px solid var(--jy-border-light, #F0F0F5);
  border-radius: 10px;
  background: #fff;
}

.seat-card.disabled,
.seat-card.maintenance {
  background: #FAFAFC;
}

.seat-card-head,
.seat-card-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.seat-card-body {
  margin-top: 10px;
}
</style>
