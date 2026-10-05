<template>
  <PageShell
    title="组团预约审核"
    eyebrow="审核队列"
    description="按功能房和日期筛选待处理的组团预约，支持成员详情查看、通过与退回。"
  >
    <template #actions>
      <el-button
        type="success"
        :loading="actionSubmitting"
        :disabled="actionSubmitting || !selectedIds.length"
        @click="handleBatchApprove"
      >
        批量通过 {{ selectedIds.length }}
      </el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="待处理" :value="pagination.total" caption="符合当前筛选条件" icon="Clock" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="已选择" :value="selectedIds.length" caption="可执行批量通过" icon="Select" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="功能房" :value="roomOptions.length" caption="可筛选空间数量" icon="OfficeBuilding" tone="success" />
      </el-col>
    </el-row>

    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="审批状态"
      keyword-placeholder="搜索发起人/标题"
      export-file-name="导出_组团预约列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.roomId" placeholder="功能房" clearable filterable style="width: 220px" @change="onSearch">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
      <el-date-picker v-model="filters.date" type="date" placeholder="预约日期" value-format="YYYY-MM-DD" style="width: 180px" @change="onSearch" />
    </ListToolbar>

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false">
      <template #default><el-button link type="primary" @click="loadData">重试</el-button></template>
    </el-alert>
    <el-alert v-if="actionError" :title="actionError" type="error" show-icon closable @close="actionError = ''" />

    <el-card shadow="never">
      <el-table class="review-motion-table" :data="tableData" v-loading="loading" @selection-change="handleSelectionChange" stripe>
        <el-table-column type="selection" width="50" />
        <el-table-column prop="title" label="组团标题" min-width="160" show-overflow-tooltip />
        <el-table-column prop="creatorName" label="发起人" width="110" />
        <el-table-column prop="roomName" label="功能房" min-width="140" show-overflow-tooltip />
        <el-table-column prop="date" label="日期" width="115" />
        <el-table-column label="时间段" width="130">
          <template #default="{ row }">{{ row.startHour }} - {{ row.endHour }}</template>
        </el-table-column>
        <el-table-column label="人数" width="90">
          <template #default="{ row }">{{ row.memberCount }}/{{ row.maxMembers }}</template>
        </el-table-column>
        <el-table-column label="审批状态" width="130">
          <template #default="{ row }">
            <el-tag :type="approvalTagType(row.approvalStatus)" size="small">
              {{ approvalText(row.approvalStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link :loading="actionSubmitting" :disabled="actionSubmitting" @click="handleApprove(row)">通过</el-button>
            <el-button type="warning" size="small" link :disabled="actionSubmitting" @click="openReject(row)">退回</el-button>
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

    <el-dialog v-model="rejectDialogVisible" title="退回组团预约" width="500px">
      <el-form :model="rejectForm" label-width="90px">
        <el-form-item label="常用原因">
          <el-select v-model="rejectTemplate" placeholder="选择后可继续修改" clearable style="width: 100%" @change="applyRejectTemplate">
            <el-option label="组团用途不符合空间使用规则" value="组团用途不符合空间使用规则" />
            <el-option label="该时间段空间另有安排" value="该时间段空间另有安排" />
            <el-option label="申请信息不完整，请补充后重新提交" value="申请信息不完整，请补充后重新提交" />
          </el-select>
        </el-form-item>
        <el-form-item label="退回原因">
          <el-input v-model="rejectForm.reason" type="textarea" :rows="4" placeholder="请输入退回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="actionSubmitting" @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="warning" :loading="actionSubmitting" :disabled="actionSubmitting" @click="confirmReject">确认退回</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="组团详情" size="560px">
      <el-descriptions :column="1" border v-if="currentRow">
        <el-descriptions-item label="组团标题">{{ currentRow.title }}</el-descriptions-item>
        <el-descriptions-item label="发起人">{{ currentRow.creatorName }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.startHour }} - {{ currentRow.endHour }}</el-descriptions-item>
        <el-descriptions-item label="人数">{{ currentRow.memberCount }}/{{ currentRow.maxMembers }}</el-descriptions-item>
        <el-descriptions-item label="用途说明">{{ currentRow.description || '未填写' }}</el-descriptions-item>
        <el-descriptions-item label="审批状态">
          <el-tag :type="approvalTagType(currentRow.approvalStatus)" size="small">
            {{ approvalText(currentRow.approvalStatus) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="关联预约号">{{ currentRow.reservationId || '无' }}</el-descriptions-item>
      </el-descriptions>

      <div class="member-section" v-if="currentRow">
        <div class="member-title">成员列表（{{ currentRow.members.length }}）</div>
        <el-table :data="currentRow.members" size="small" stripe>
          <el-table-column prop="name" label="姓名" min-width="100" />
          <el-table-column prop="studentId" label="学号" min-width="130" />
          <el-table-column label="身份" width="100">
            <template #default="{ row }">
              <el-tag v-if="row.isCreator" type="warning" size="small">发起人</el-tag>
              <span v-else>成员</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <template #footer>
        <div class="drawer-actions" v-if="currentRow">
          <el-button type="warning" :disabled="actionSubmitting" @click="openReject(currentRow); detailVisible = false">退回</el-button>
          <el-button type="success" :loading="actionSubmitting" :disabled="actionSubmitting" @click="handleApprove(currentRow); detailVisible = false">通过</el-button>
        </div>
      </template>
    </el-drawer>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useUserStore } from '@/store/user'
import { listPending, approve, reject as rejectGroup } from '@/api/group'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'
import MetricCard from '@/components/admin/MetricCard.vue'
import { createActionLock, isConfirmationCancel, normalizeRejectionReason } from '@/utils/approvalState'

const APPROVAL_TEXT = {
  pending: '待审核',
  counselor_pending: '待辅导员审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消'
}

const APPROVAL_TAG = {
  pending: 'warning',
  counselor_pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'info'
}

const approvalText = function(status) {
  return APPROVAL_TEXT[status] || status || '未知'
}

const approvalTagType = function(status) {
  return APPROVAL_TAG[status] || 'info'
}

const userStore = useUserStore()
const statusOptions = computed(() => userStore.userInfo.role === 'admin'
  ? [{ label: '待审核', value: 'pending' }]
  : [{ label: '待审核', value: 'pending' }, { label: '待辅导员审核', value: 'counselor_pending' }])

// 导出列：仅组团级字段，与表格展示一致。
// R-14：不含成员姓名/学号 —— 成员明细属更敏感 PII，详情抽屉内可看但不随列表导出。
const exportColumns = [
  { header: '组团标题', key: 'title' },
  { header: '发起人', key: 'creatorName' },
  { header: '功能房', key: 'roomName' },
  { header: '日期', key: 'date' },
  { header: '时间段', key: 'startHour', formatter: row => `${row.startHour} - ${row.endHour}` },
  { header: '人数', key: 'memberCount', formatter: row => `${row.memberCount}/${row.maxMembers}` },
  { header: '审批状态', key: 'approvalStatus', formatter: row => approvalText(row.approvalStatus) }
]

const loading = ref(false)
const loadError = ref('')
const actionSubmitting = ref(false)
const actionError = ref('')
const actionLock = createActionLock(value => { actionSubmitting.value = value })
const tableData = ref([])
const selectedIds = ref([])
const selectedRows = ref([])
const roomOptions = ref([])
const rejectDialogVisible = ref(false)
const detailVisible = ref(false)
const currentRow = ref(null)
const rejectTemplate = ref('')
let loadRequestVersion = 0

const filters = reactive({ roomId: '', date: '', status: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', id: null })

// 列表与导出使用相同的服务端筛选条件，分页总数也与筛选结果一致。
function buildParams() {
  return {
    roomId: filters.roomId,
    date: filters.date,
    status: filters.status,
    keyword: filters.keyword.trim()
  }
}

async function loadData() {
  const requestVersion = ++loadRequestVersion
  loading.value = true
  loadError.value = ''
  try {
    const res = await listPending({
      ...buildParams(),
      page: pagination.page,
      pageSize: pagination.pageSize
    })
    if (requestVersion === loadRequestVersion) {
      tableData.value = res.data?.list || []
      pagination.total = res.data?.total || 0
      selectedIds.value = []
      selectedRows.value = []
    }
  } catch (e) {
    if (requestVersion === loadRequestVersion) loadError.value = '组团列表加载失败，请重试'
  } finally {
    if (requestVersion === loadRequestVersion) loading.value = false
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

// 筛选条件变化后回到第 1 页。
function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.roomId = ''
  filters.date = ''
  filters.status = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

// 导出「筛选后全量」：后端 paginationRules 限制 pageSize<=100，不能一次性要 10000；
// 且 /groups/pending 的 controller 与 service 都把 pageSize 钳到 50，
// 故这里按 50/页循环拉取（若传 100 会被服务端缩成 50，反而被 fetchAllPages 误判为最后一页而截断）。
async function handleExport() {
  try {
    const list = await fetchAllPages(listPending, buildParams(), {
      pageSize: 50,
      maxPages: 50,
      // 注：listPending 当前签名只有 (params)，options 暂不生效；保留以对齐其他页面约定。
      options: { silentError: true }
    })
    if (!exportXlsx(exportColumns, list, '导出_组团预约列表')) return
    ElMessage.success(`导出成功，共 ${list.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

function handleSelectionChange(rows) {
  selectedRows.value = rows
  selectedIds.value = rows.map(r => r.id)
}

async function handleApprove(row) {
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  try {
    await ElMessageBox.confirm('确认通过该组团预约？', '提示', { type: 'success' })
    await approve(row.id)
    ElMessage.success('已通过')
    await loadData()
  } catch (e) {
    if (!isConfirmationCancel(e)) actionError.value = '审批失败，请重试'
  } finally {
    actionLock.release(token)
  }
}

async function handleBatchApprove() {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  try {
    await ElMessageBox.confirm(`确认批量通过选中的 ${ids.length} 个组团？`, '提示', { type: 'warning' })
    // 后端暂无批量接口，逐个提交并统计结果。
    let succeeded = 0
    for (const id of ids) {
      try {
        await approve(id)
        succeeded += 1
      } catch (e) {
        // 单条失败不中断整体，继续处理其余项
      }
    }
    if (succeeded === ids.length) {
      ElMessage.success(`已批量通过 ${succeeded} 个组团`)
    } else {
      actionError.value = `批量通过完成，成功 ${succeeded} 个，失败 ${ids.length - succeeded} 个（可能已被其他管理员处理）`
    }
    selectedIds.value = []
    selectedRows.value = []
    await loadData()
  } catch (e) {
    if (!isConfirmationCancel(e)) actionError.value = '批量通过失败，请重试'
  } finally {
    actionLock.release(token)
  }
}

function openReject(row) {
  rejectForm.id = row.id
  rejectForm.reason = ''
  rejectTemplate.value = ''
  rejectDialogVisible.value = true
}

function applyRejectTemplate(value) {
  if (value) rejectForm.reason = value
}

async function confirmReject() {
  let reason
  try {
    reason = normalizeRejectionReason(rejectForm.reason)
  } catch (error) {
    ElMessage.warning(error.message)
    return
  }
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  try {
    await rejectGroup(rejectForm.id, { reason })
    ElMessage.success('已退回')
    rejectDialogVisible.value = false
    await loadData()
  } catch (e) {
    actionError.value = '退回失败，请重试'
  } finally {
    actionLock.release(token)
  }
}

function openDetail(row) {
  currentRow.value = row
  detailVisible.value = true
}

onMounted(() => {
  loadData()
  loadRooms()
})
onBeforeUnmount(() => { loadRequestVersion += 1 })
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

.member-section {
  margin-top: 20px;
}

.member-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
</style>
