<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="功能房">
          <el-select v-model="filters.roomId" placeholder="全部" clearable style="width: 160px">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="预约日期">
          <el-date-picker v-model="filters.date" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">待审核预约</span>
        <div class="table-actions">
          <el-button type="success" :disabled="!selectedIds.length" @click="handleBatchAudit('approve')">
            批量通过 ({{ selectedIds.length }})
          </el-button>
          <el-button type="danger" :disabled="!selectedIds.length" @click="handleBatchAudit('reject')">
            批量驳回 ({{ selectedIds.length }})
          </el-button>
        </div>
      </div>

      <el-table :data="tableData" v-loading="loading" @selection-change="handleSelectionChange" stripe>
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="userName" label="预约人" width="100" />
        <el-table-column prop="roomName" label="功能房" width="140" />
        <el-table-column prop="date" label="预约日期" width="120" />
        <el-table-column prop="timeSlot" label="时间段" width="160" />
        <el-table-column prop="purpose" label="用途" min-width="150" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="提交时间" width="170" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link @click="handleApprove(row)">通过</el-button>
            <el-button type="danger" size="small" link @click="handleReject(row)">驳回</el-button>
            <el-button type="primary" size="small" link @click="handleDetail(row)">详情</el-button>
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

    <el-dialog v-model="rejectDialogVisible" title="驳回预约" width="480px">
      <el-form :model="rejectForm" label-width="80px">
        <el-form-item label="驳回原因">
          <el-input v-model="rejectForm.reason" type="textarea" :rows="3" placeholder="请输入驳回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailDialogVisible" title="预约详情" width="560px">
      <el-descriptions :column="2" border v-if="currentRow">
        <el-descriptions-item label="预约人">{{ currentRow.userName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentRow.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.timeSlot }}</el-descriptions-item>
        <el-descriptions-item label="用途">{{ currentRow.purpose }}</el-descriptions-item>
        <el-descriptions-item label="提交时间" :span="2">{{ currentRow.createdAt }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getPending, approve, reject, batchAudit } from '@/api/reservation'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const tableData = ref([])
const selectedIds = ref([])
const roomOptions = ref([])
const rejectDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const currentRow = ref(null)

const filters = reactive({ roomId: '', date: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', id: null })

async function loadData() {
  loading.value = true
  try {
    const res = await getPending({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

function resetFilters() {
  filters.roomId = ''
  filters.date = ''
  pagination.page = 1
  loadData()
}

function handleSelectionChange(rows) {
  selectedIds.value = rows.map(r => r.id)
}

async function handleApprove(row) {
  try {
    await ElMessageBox.confirm('确认通过该预约申请？', '提示', { type: 'success' })
    await approve(row.id)
    ElMessage.success('已通过')
    loadData()
  } catch (e) {
    // cancelled or error
  }
}

function handleReject(row) {
  rejectForm.id = row.id
  rejectForm.reason = ''
  rejectDialogVisible.value = true
}

async function confirmReject() {
  if (!rejectForm.reason) {
    ElMessage.warning('请输入驳回原因')
    return
  }
  try {
    await reject(rejectForm.id, { reason: rejectForm.reason })
    ElMessage.success('已驳回')
    rejectDialogVisible.value = false
    loadData()
  } catch (e) {
    // handled
  }
}

function handleDetail(row) {
  currentRow.value = row
  detailDialogVisible.value = true
}

async function handleBatchAudit(action) {
  const actionText = action === 'approve' ? '通过' : '驳回'
  try {
    await ElMessageBox.confirm(`确认批量${actionText}选中的 ${selectedIds.value.length} 条预约？`, '提示', { type: 'warning' })
    await batchAudit({ ids: selectedIds.value, action, reason: '' })
    ElMessage.success(`已批量${actionText}`)
    loadData()
  } catch (e) {
    // cancelled or error
  }
}

onMounted(() => {
  loadData()
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

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
