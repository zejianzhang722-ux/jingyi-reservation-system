<template>
  <div class="page-container">
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">功能房管理</span>
        <el-button type="primary" @click="handleAdd">
          <el-icon><Plus /></el-icon>新增功能房
        </el-button>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="名称" width="150" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag size="small">{{ typeLabels[row.type] || row.type }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="building_name" label="楼栋" width="120" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column prop="capacity" label="容纳人数" width="100" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type" size="small">{{ statusMap[row.status]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="success" size="small" link @click="handleSeats(row)">座位</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑功能房' : '新增功能房'" width="600px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入功能房名称" />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择类型" style="width: 100%">
            <el-option label="自习室" value="study_room" />
            <el-option label="共享空间" value="seminar_room" />
            <el-option label="影音室" value="media_room" />
            <el-option label="备赛间" value="competition_room" />
            <el-option label="路演空间" value="roadshow_space" />
            <el-option label="舞蹈室" value="dance_room" />
            <el-option label="阅览室" value="reading_room" />
            <el-option label="多功能厅" value="multi_purpose_hall" />
            <el-option label="学业辅导中心" value="study_center" />
            <el-option label="生涯发展咨询室" value="career_center" />
            <el-option label="求职就业工作室" value="job_studio" />
            <el-option label="创新工作坊" value="innovation_workshop" />
            <el-option label="党团活动室" value="party_room" />
            <el-option label="国防教育工作室" value="national_defense_studio" />
            <el-option label="导师交流室" value="mentor_room" />
            <el-option label="心理咨询室" value="psychology_room" />
            <el-option label="团员模范岗" value="tutor" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼栋" prop="buildingId">
          <el-select v-model="form.buildingId" placeholder="请选择楼栋" style="width: 100%">
            <el-option v-for="b in buildingOptions" :key="b.id" :label="b.name" :value="b.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input-number v-model="form.floor" :min="1" :max="30" />
        </el-form-item>
        <el-form-item label="容纳人数" prop="capacity">
          <el-input-number v-model="form.capacity" :min="1" :max="500" />
        </el-form-item>
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

    <el-dialog v-model="seatDialogVisible" :title="'座位管理 - ' + seatRoomName" width="700px">
      <div class="seat-info-bar">
        <span>总座位数: {{ seatList.length }}</span>
        <el-button type="primary" size="small" @click="addSeat" style="margin-left: 16px;">添加座位</el-button>
      </div>
      <el-table :data="seatList" stripe max-height="400">
        <el-table-column prop="seat_number" label="座位号" width="120">
          <template #default="{ row }">
            <el-input v-model="row.seat_number" size="small" />
          </template>
        </el-table-column>
        <el-table-column prop="row_num" label="行" width="80" />
        <el-table-column prop="col_num" label="列" width="80" />
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-select v-model="row.status" size="small">
              <el-option label="可用" value="available" />
              <el-option label="停用" value="disabled" />
              <el-option label="维护中" value="maintenance" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column prop="has_power" label="电源" width="80">
          <template #default="{ row }">
            <el-switch v-model="row.has_power" :active-value="1" :inactive-value="0" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row, $index }">
            <el-button type="warning" size="small" link v-if="row.status === 'available'" @click="toggleSeatStatus($index, 'disabled')">停用</el-button>
            <el-button type="success" size="small" link v-if="row.status === 'disabled'" @click="toggleSeatStatus($index, 'available')">启用</el-button>
            <el-button type="danger" size="small" link @click="removeSeat($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getList, create, update, deleteRoom, getBuildings } from '@/api/room'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const buildingOptions = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)

const typeLabels = {
  study_room: '自习室', seminar_room: '共享空间', media_room: '影音室',
  competition_room: '备赛间', roadshow_space: '路演空间', dance_room: '舞蹈室',
  reading_room: '阅览室', multi_purpose_hall: '多功能厅', study_center: '学业辅导中心',
  career_center: '生涯发展咨询室', job_studio: '求职就业工作室',
  innovation_workshop: '创新工作坊', party_room: '党团活动室',
  national_defense_studio: '国防教育工作室', mentor_room: '导师交流室',
  counseling_room: '心理咨询室', shared_space: '共享空间',
  psychology_room: '心理咨询室', tutor: '团员模范岗'
}
const statusMap = { open: { label: '开放', type: 'success' }, closed: { label: '关闭', type: 'info' }, maintenance: { label: '维护中', type: 'danger' } }

const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({
  id: null,
  name: '',
  type: '',
  buildingId: '',
  floor: 1,
  capacity: 10,
  status: 'open',
  description: '',
  facilities: []
})

const rules = {
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
  buildingId: [{ required: true, message: '请选择楼栋', trigger: 'change' }],
  capacity: [{ required: true, message: '请输入容纳人数', trigger: 'blur' }]
}

async function loadData() {
  loading.value = true
  try {
    const res = await getList({ page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
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

function handleAdd() {
  isEdit.value = false
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  let facilitiesList = []
  if (row.facilities) {
    if (Array.isArray(row.facilities)) {
      facilitiesList = row.facilities
    } else if (typeof row.facilities === 'string') {
      const facMap = { 'WiFi': 'wifi', '电源': 'power', '电源插座': 'power', '空调': 'aircon', '投影': 'projector', '投影仪': 'projector', '白板': 'whiteboard', '音响': 'speaker', '镜子': 'mirror', '3D打印机': 'printer' }
      facilitiesList = row.facilities.split(',').map(f => facMap[f.trim()] || f.trim()).filter(Boolean)
    }
  }
  Object.assign(form, {
    id: row.id,
    name: row.name,
    type: row.type,
    buildingId: row.building_id,
    floor: row.floor,
    capacity: row.capacity,
    status: row.status,
    description: row.description || '',
    facilities: facilitiesList
  })
  dialogVisible.value = true
}

const seatDialogVisible = ref(false)
const seatRoomName = ref('')
const seatRoomId = ref(null)
const seatList = ref([])

function handleSeats(row) {
  seatRoomName.value = row.name
  seatRoomId.value = row.id
  loadSeats(row.id)
  seatDialogVisible.value = true
}

async function loadSeats(roomId) {
  try {
    const res = await request.get('/admin/rooms/' + roomId + '/seats')
    seatList.value = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.list || [])
  } catch (e) {
    seatList.value = []
  }
}

function addSeat() {
  const nextNum = seatList.value.length + 1
  const roomCode = seatRoomName.value.match(/[A-Z]\d{3}/)?.[0] || seatRoomName.value.replace(/[^A-Z0-9]/g, '')
  seatList.value.push({
    id: Date.now(),
    seat_number: roomCode + '-' + String(nextNum).padStart(2, '0'),
    row_num: Math.ceil(nextNum / 6),
    col_num: ((nextNum - 1) % 6) + 1,
    status: 'available',
    has_power: 1
  })
}

function removeSeat(index) {
  seatList.value.splice(index, 1)
}

function toggleSeatStatus(index, status) {
  seatList.value[index].status = status
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除功能房"${row.name}"？`, '提示', { type: 'warning' })
    await deleteRoom(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {
    // cancelled
  }
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
    // handled
  } finally {
    submitLoading.value = false
  }
}

onMounted(() => {
  loadData()
  loadBuildings()
})
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.table-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.seat-info-bar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  font-size: 14px;
  color: #333;
}
</style>
