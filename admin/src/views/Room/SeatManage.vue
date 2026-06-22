<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="功能房">
          <el-select v-model="filters.roomId" placeholder="请选择功能房" style="width: 200px" @change="loadSeats">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

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

      <el-table :data="seatList" v-loading="loading" stripe @selection-change="handleSelectionChange">
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="seat_number" label="座位号" width="120" />
        <el-table-column prop="row_num" label="行" width="80" />
        <el-table-column prop="col_num" label="列" width="80" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'available' ? 'success' : row.status === 'maintenance' ? 'warning' : row.status === 'disabled' ? 'danger' : 'info'" size="small">
              {{ row.status === 'available' ? '可用' : row.status === 'maintenance' ? '维护中' : row.status === 'disabled' ? '停用' : '占用' }}
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
import { ref, reactive, onMounted } from 'vue'
import { getSeats, createSeats, updateSeat, deleteSeat, getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const submitLoading = ref(false)
const seatList = ref([])
const roomOptions = ref([])
const selectedIds = ref([])
const batchDialogVisible = ref(false)

const filters = reactive({ roomId: '' })
const batchForm = reactive({ rows: 5, cols: 6, startNumber: 1 })

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
    seatList.value = res.data?.list || res.data || []
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
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

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
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
