<template>
  <div class="page-container">
    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索座位号"
      export-file-name="导出_座位列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.roomId" placeholder="请选择功能房" clearable filterable style="width: 200px" @change="loadSeats">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
    </ListToolbar>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">座位管理</span>
        <div class="table-actions">
          <el-button type="primary" @click="handleBatchAdd" :disabled="!filters.roomId">
            <el-icon><Plus /></el-icon>批量新增
          </el-button>
          <el-button type="danger" :disabled="!selectedIds.length" @click="handleBatchDelete">
            批量删除 ({{ selectedIds.length }})
          </el-button>
        </div>
      </div>

      <el-table :data="filteredSeatList" v-loading="loading" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="seat_number" label="座位号" width="120" />
        <el-table-column prop="row_num" label="行" width="80" />
        <el-table-column prop="col_num" label="列" width="80" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">
              {{ statusMap[row.status]?.label || '占用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="has_power" label="电源" width="80">
          <template #default="{ row }">
            <el-tag :type="row.has_power ? 'success' : 'info'" size="small">
              {{ row.has_power ? '有' : '无' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              :type="row.status === 'disabled' ? 'success' : row.status === 'maintenance' ? 'success' : 'warning'"
              size="small"
              link
              @click="toggleSeatStatus(row)"
            >
              {{ row.status === 'disabled' || row.status === 'maintenance' ? '启用' : '停用' }}
            </el-button>
            <el-button type="danger" size="small" link @click="handleDeleteSeat(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="batchDialogVisible" title="批量新增座位" width="500px">
      <el-form :model="batchForm" label-width="100px">
        <el-form-item label="行数">
          <el-input-number v-model="batchForm.rows" :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="每行列数">
          <el-input-number v-model="batchForm.cols" :min="1" :max="20" />
        </el-form-item>
        <el-form-item label="起始编号">
          <el-input-number v-model="batchForm.startNumber" :min="1" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="confirmBatchAdd">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getSeats, createSeats, updateSeat, deleteSeat, getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx } from '@/utils/exportXlsx'

const loading = ref(false)
const submitLoading = ref(false)
const seatList = ref([])
const roomOptions = ref([])
const selectedIds = ref([])
const batchDialogVisible = ref(false)

// 列表工具条的状态下拉（🔧 后端 GET /room/:id/seats 不支持筛选，状态由前端兜底过滤）
const statusOptions = [
  { label: '可用', value: 'available' },
  { label: '停用', value: 'disabled' },
  { label: '维护中', value: 'maintenance' }
]

const statusMap = {
  available: { label: '可用', type: 'success' },
  disabled: { label: '停用', type: 'danger' },
  maintenance: { label: '维护中', type: 'warning' },
  occupied: { label: '占用', type: 'info' }
}

// 导出列：与表格展示字段一致（座位无 PII）
const exportColumns = [
  { header: '座位号', key: 'seat_number' },
  { header: '行', key: 'row_num' },
  { header: '列', key: 'col_num' },
  { header: '状态', key: 'status', formatter: row => statusMap[row.status]?.label || '占用' },
  { header: '电源', key: 'has_power', formatter: row => (row.has_power ? '有' : '无') }
]

const filters = reactive({ roomId: '', status: '', keyword: '' })
const batchForm = reactive({ rows: 5, cols: 6, startNumber: 1 })

// 🔧 座位接口既不分页也不支持 status / keyword，因此在已加载行上做前端过滤，
// 表格渲染与导出都基于同一份 filteredSeatList，保证「导出结果 == 当前筛选视图」。
const filteredSeatList = computed(() => {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  return seatList.value.filter(seat => {
    if (filters.status && seat.status !== filters.status) return false
    if (keyword && !String(seat.seat_number || '').toLowerCase().includes(keyword)) return false
    return true
  })
})

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function loadSeats() {
  if (!filters.roomId) {
    seatList.value = []
    return
  }
  loading.value = true
  try {
    const res = await getSeats(filters.roomId, { pageSize: 200 })
    const payload = res.data
    seatList.value = Array.isArray(payload?.list) ? payload.list : (Array.isArray(payload) ? payload : [])
  } catch (e) {
    seatList.value = []
  } finally {
    loading.value = false
  }
}

// 状态/关键词均为纯前端过滤，computed 会自动生效，无需重新请求；
// 这里仅承接 ListToolbar 的 search 事件以保持工具条语义一致。
function onSearch() {
  // no-op: 过滤由 filteredSeatList 计算属性驱动
}

// 重置只清状态与关键词：功能房是本页的数据来源而非普通筛选项，清空会让整个列表消失。
function resetFilters() {
  filters.status = ''
  filters.keyword = ''
}

function handleSelectionChange(rows) {
  selectedIds.value = rows.map(r => r.id)
}

function handleBatchAdd() {
  batchForm.rows = 5
  batchForm.cols = 6
  batchForm.startNumber = 1
  batchDialogVisible.value = true
}

async function confirmBatchAdd() {
  submitLoading.value = true
  try {
    await createSeats(filters.roomId, batchForm)
    ElMessage.success('批量新增成功')
    batchDialogVisible.value = false
    loadSeats()
  } catch (e) {
    // handled
  } finally {
    submitLoading.value = false
  }
}

async function toggleSeatStatus(row) {
  const newStatus = (row.status === 'disabled' || row.status === 'maintenance') ? 'available' : 'disabled'
  try {
    await updateSeat(filters.roomId, row.id, { status: newStatus })
    ElMessage.success(newStatus === 'available' ? '已启用' : '已停用')
    loadSeats()
  } catch (e) {
    // handled
  }
}

async function handleDeleteSeat(row) {
  try {
    await ElMessageBox.confirm(`确认删除座位 ${row.seat_number}？`, '提示', { type: 'warning' })
    await deleteSeat(filters.roomId, row.id)
    ElMessage.success('删除成功')
    loadSeats()
  } catch (e) {
    // cancelled
  }
}

async function handleBatchDelete() {
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selectedIds.value.length} 个座位？`, '提示', { type: 'warning' })
    for (const id of selectedIds.value) {
      await deleteSeat(filters.roomId, id)
    }
    ElMessage.success('批量删除成功')
    loadSeats()
  } catch (e) {
    // cancelled
  }
}

// 非分页接口（GET /room/:id/seats 一次性返回该房间全部座位，后端既不接受 status/keyword
// 也不提供分页游标），因此导出「当前已加载 + 已筛选」的行，不能走 fetchAllPages 翻页。
function handleExport() {
  try {
    const list = filteredSeatList.value
    if (!exportXlsx(exportColumns, list, '导出_座位列表')) return
    ElMessage.success(`导出成功，共 ${list.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

onMounted(() => {
  loadRooms()
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

.table-actions {
  display: flex;
  gap: 8px;
}
</style>
