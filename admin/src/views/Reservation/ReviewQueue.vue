<template>
  <PageShell
    title="预约审核"
    eyebrow="审核队列"
    description="按房间和日期筛选待处理预约，支持详情抽屉、单条处理和批量处理。"
  >
    <template #actions>
      <el-button type="success" :loading="actionSubmitting" :disabled="actionSubmitting || !selectedIds.length" @click="handleBatch('approve')">批量通过 {{ selectedIds.length }}</el-button>
      <el-button type="warning" :loading="actionSubmitting" :disabled="actionSubmitting || !selectedIds.length" @click="batchReject">批量退回 {{ selectedIds.length }}</el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="待处理" :value="pagination.total" caption="符合当前筛选条件" icon="Clock" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="已选择" :value="selectedIds.length" caption="可执行批量处理" icon="Select" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="功能房" :value="roomOptions.length" caption="可筛选空间数量" icon="OfficeBuilding" tone="success" />
      </el-col>
    </el-row>

    <FilterBar @search="loadData" @reset="resetFilters">
      <el-select v-model="filters.roomId" placeholder="功能房" clearable filterable style="width: 220px">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
      <el-date-picker v-model="filters.date" type="date" placeholder="预约日期" value-format="YYYY-MM-DD" style="width: 180px" />
    </FilterBar>

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false">
      <template #default><el-button link type="primary" @click="loadData">重试</el-button></template>
    </el-alert>
    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" @selection-change="handleSelectionChange" stripe>
        <el-table-column type="selection" width="50" />
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="userName" label="预约人" width="110" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="roomName" label="功能房" min-width="150" />
        <el-table-column prop="date" label="预约日期" width="120" />
        <el-table-column prop="timeSlot" label="时间段" width="160" />
        <el-table-column prop="purpose" label="用途" min-width="180" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="提交时间" width="170" />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link :loading="actionSubmitting" :disabled="actionSubmitting" @click="handleApprove(row)">通过</el-button>
            <el-button type="warning" size="small" link :disabled="actionSubmitting" @click="openReturn(row)">退回</el-button>
            <el-button type="primary" size="small" link @click="openDetail(row)">详情</el-button>
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

    <el-dialog v-model="returnDialogVisible" title="退回预约" width="500px">
      <el-form :model="returnForm" label-width="90px">
        <el-form-item label="常用原因">
          <el-select v-model="returnTemplate" placeholder="选择后可继续修改" clearable style="width: 100%" @change="applyReturnTemplate">
            <el-option label="预约用途不符合空间使用规则" value="预约用途不符合空间使用规则" />
            <el-option label="该时间段空间另有安排" value="该时间段空间另有安排" />
            <el-option label="申请信息不完整，请补充后重新提交" value="申请信息不完整，请补充后重新提交" />
          </el-select>
        </el-form-item>
        <el-form-item label="退回原因">
          <el-input v-model="returnForm.reason" type="textarea" :rows="4" placeholder="请输入退回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="actionSubmitting" @click="returnDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="actionSubmitting" :disabled="actionSubmitting" @click="confirmReturn">确认退回</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="预约详情" size="520px">
      <el-descriptions :column="1" border v-if="currentRow">
        <el-descriptions-item label="预约人">{{ currentRow.userName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentRow.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.timeSlot }}</el-descriptions-item>
        <el-descriptions-item label="用途">{{ currentRow.purpose }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ currentRow.createdAt }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <div class="drawer-actions" v-if="currentRow">
          <el-button type="warning" :disabled="actionSubmitting" @click="openReturn(currentRow); detailVisible = false">退回</el-button>
          <el-button type="success" :loading="actionSubmitting" :disabled="actionSubmitting" @click="handleApprove(currentRow); detailVisible = false">通过</el-button>
        </div>
      </template>
    </el-drawer>
  </PageShell>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getPending, approve, reject as returnReservation, batchAudit } from '@/api/reservation'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import { normalizeRejectionReason } from '@/utils/approvalState'

const loading = ref(false)
const loadError = ref('')
const actionSubmitting = ref(false)
const tableData = ref([])
const selectedIds = ref([])
const roomOptions = ref([])
const returnDialogVisible = ref(false)
const detailVisible = ref(false)
const currentRow = ref(null)
const returnTemplate = ref('')

const filters = reactive({ roomId: '', date: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const returnForm = reactive({ reason: '', id: null, ids: [] })

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getPending({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    loadError.value = '列表加载失败，请重试'
  } finally {
    loading.value = false
  }
}

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    roomOptions.value = []
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
  if (actionSubmitting.value) return
  try {
    await ElMessageBox.confirm('确认通过该预约申请？', '提示', { type: 'success' })
    if (actionSubmitting.value) return
    actionSubmitting.value = true
    await approve(row.id)
    ElMessage.success('已通过')
    await loadData()
  } catch (e) {
    // cancelled or handled by interceptor
  } finally {
    actionSubmitting.value = false
  }
}

function openReturn(row) {
  returnForm.id = row.id
  returnForm.ids = []
  returnForm.reason = ''
  returnTemplate.value = ''
  returnDialogVisible.value = true
}

function applyReturnTemplate(value) {
  if (value) returnForm.reason = value
}

async function confirmReturn() {
  if (actionSubmitting.value) return
  let reason
  try {
    reason = normalizeRejectionReason(returnForm.reason)
  } catch (error) {
    ElMessage.warning(error.message)
    return
  }
  actionSubmitting.value = true
  try {
    if (returnForm.ids.length) await batchAudit({ ids: returnForm.ids, action: 'reject', reason })
    else await returnReservation(returnForm.id, { reason })
    ElMessage.success('已退回')
    returnDialogVisible.value = false
    if (returnForm.ids.length) selectedIds.value = []
    await loadData()
  } catch (e) {
    // handled by interceptor
  } finally {
    actionSubmitting.value = false
  }
}

function openDetail(row) {
  currentRow.value = row
  detailVisible.value = true
}

async function handleBatch(action) {
  if (actionSubmitting.value) return
  const text = action === 'approve' ? '通过' : '退回'
  try {
    await ElMessageBox.confirm(`确认批量${text}选中的 ${selectedIds.value.length} 条预约？`, '提示', { type: 'warning' })
    if (actionSubmitting.value) return
    actionSubmitting.value = true
    await batchAudit({ ids: selectedIds.value, action, reason: '' })
    ElMessage.success(`已批量${text}`)
    selectedIds.value = []
    await loadData()
  } catch (e) {
    // cancelled or handled by interceptor
  } finally {
    actionSubmitting.value = false
  }
}

function batchReject() {
  if (actionSubmitting.value || !selectedIds.value.length) return
  returnForm.id = null
  returnForm.ids = [...selectedIds.value]
  returnForm.reason = ''
  returnTemplate.value = ''
  returnDialogVisible.value = true
}

onMounted(() => {
  loadData()
  loadRooms()
})
</script>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>

