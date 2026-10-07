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

    <ListToolbar
      v-model:keyword="filters.keyword"
      keyword-placeholder="搜索预约人/学号"
      export-file-name="导出_预约审核队列"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.roomId" placeholder="功能房" clearable filterable style="width: 220px" @change="onSearch">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
      <el-date-picker v-model="filters.date" type="date" placeholder="预约日期" value-format="YYYY-MM-DD" style="width: 180px" @change="onSearch" />
    </ListToolbar>

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" />
    <el-alert v-if="actionError" :title="actionError" type="error" show-icon closable @close="actionError = ''" />
    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !filteredRows.length"
        empty-description="暂无待处理预约"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table class="review-motion-table" :data="filteredRows" @selection-change="handleSelectionChange" stripe>
          <el-table-column type="selection" width="50" />
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
      </AsyncState>
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

      <div class="trail-section" v-if="currentRow">
        <div class="trail-title">审核轨迹 · 一审 / 二审进度</div>
        <AsyncState
          :loading="trailLoading"
          :error="!!trailError"
          :empty="!trailLoading && !trailError && !trailList.length"
          :error-message="trailError"
          empty-description="暂无审核轨迹"
          @retry="loadTrail(currentRow.id)"
        >
          <el-timeline>
            <el-timeline-item
              v-for="item in trailList"
              :key="item.id"
              :timestamp="item.createdAt || ''"
              :type="trailActionType(item.action)"
              placement="top"
            >
              <div class="trail-line">
                <el-tag size="small" :type="trailActionType(item.action)">{{ trailStageLabel(item.stage) }} · {{ trailActionLabel(item.action) }}</el-tag>
                <span class="trail-actor">{{ trailRoleLabel(item.actorRole) }}</span>
              </div>
              <div v-if="item.remark" class="trail-remark">{{ item.remark }}</div>
            </el-timeline-item>
          </el-timeline>
        </AsyncState>
      </div>

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
import { ref, reactive, computed, onMounted } from 'vue'
import { getPending, approve, reject as returnReservation, batchAudit, getReservationTrail } from '@/api/reservation'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'
import MetricCard from '@/components/admin/MetricCard.vue'
import AsyncState from '@/components/admin/AsyncState.vue'
import { createActionLock, isConfirmationCancel, normalizeRejectionReason } from '@/utils/approvalState'

// 导出列：与表格展示字段一一对应（R-14：只导出页面已展示、后端已脱敏的字段）。
const exportColumns = [
  { header: '预约人', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '功能房', key: 'roomName' },
  { header: '预约日期', key: 'date' },
  { header: '时间段', key: 'timeSlot' },
  { header: '用途', key: 'purpose' },
  { header: '提交时间', key: 'createdAt' }
]

const loading = ref(false)
const loadError = ref('')
const actionSubmitting = ref(false)
const actionError = ref('')
const actionLock = createActionLock(value => { actionSubmitting.value = value })
const tableData = ref([])
const selectedIds = ref([])
const roomOptions = ref([])
const returnDialogVisible = ref(false)
const detailVisible = ref(false)
const currentRow = ref(null)
const returnTemplate = ref('')

// R-07 审核轨迹（只读）
const trailLoading = ref(false)
const trailError = ref('')
const trailList = ref([])
const TRAIL_STAGE_LABELS = { first: '一审', counselor: '二审' }
const TRAIL_ACTION_LABELS = { approve: '通过', reject: '驳回', remark: '批注', transfer: '转派' }
const TRAIL_ACTION_TYPES = { approve: 'success', reject: 'danger', remark: 'info', transfer: 'warning' }
const TRAIL_ROLE_LABELS = { admin: '管理员', super_admin: '导生会会长团', counselor: '辅导员', system: '系统', student: '学生' }
const trailStageLabel = stage => TRAIL_STAGE_LABELS[stage] || '审核'
const trailActionLabel = action => TRAIL_ACTION_LABELS[action] || '记录'
const trailActionType = action => TRAIL_ACTION_TYPES[action] || 'info'
const trailRoleLabel = role => TRAIL_ROLE_LABELS[role] || '系统'

const filters = reactive({ roomId: '', date: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const returnForm = reactive({ reason: '', id: null, ids: [] })

// 查询参数单一来源：列表加载与导出共用，保证「导出结果 == 当前筛选视图」。
// 实测后端 GET /audit/pending（scopedQueryController.pendingAuditList）仅认
// type / buildingId / roomId / date / page / pageSize，**不认 keyword**，故关键词走前端兜底。
function buildParams() {
  return {
    type: 'admin',
    roomId: filters.roomId,
    date: filters.date
  }
}

// 前端兜底过滤：后端不支持 keyword，按预约人 / 学号在本地数据里匹配。
function matchFilters(row) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  if (!keyword) return true
  return String(row.userName || '').toLowerCase().includes(keyword) ||
    String(row.studentId || '').toLowerCase().includes(keyword)
}

// 表格数据源：服务端筛选后的当页数据 + 关键词前端过滤。
const filteredRows = computed(() => tableData.value.filter(row => matchFilters(row)))

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getPending({ ...buildParams(), page: pagination.page, pageSize: pagination.pageSize })
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

async function loadTrail(id) {
  if (!id) return
  trailLoading.value = true
  trailError.value = ''
  try {
    const res = await getReservationTrail(id)
    trailList.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    trailList.value = []
    trailError.value = '审核轨迹加载失败，请重试'
  } finally {
    trailLoading.value = false
  }
}

// 筛选条件变化后回到第 1 页（roomId / date 为服务端筛选，keyword 为前端过滤）。
function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.roomId = ''
  filters.date = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

// 导出「筛选后全量」：后端 paginationRules 限制 pageSize<=100，不能一次性要 10000，
// 必须按页循环拉取；keyword 后端不认，拉全量后套用与列表完全一致的 matchFilters。
async function handleExport() {
  try {
    const list = await fetchAllPages(getPending, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      // 注：getPending 当前签名只有 (params)，options 暂不生效；保留以对齐其他页面约定。
      options: { silentError: true }
    })
    const rows = list.filter(row => matchFilters(row))
    if (!exportXlsx(exportColumns, rows, '导出_预约审核队列')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

function handleSelectionChange(rows) {
  selectedIds.value = rows.map(r => r.id)
}

async function handleApprove(row) {
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  try {
    await ElMessageBox.confirm('确认通过该预约申请？', '提示', { type: 'success' })
    await approve(row.id)
    ElMessage.success('已通过')
    await loadData()
  } catch (e) {
    if (!isConfirmationCancel(e)) actionError.value = '审批失败，请重试'
  } finally {
    actionLock.release(token)
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
  let reason
  try {
    reason = normalizeRejectionReason(returnForm.reason)
  } catch (error) {
    ElMessage.warning(error.message)
    return
  }
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  try {
    if (returnForm.ids.length) await batchAudit({ ids: returnForm.ids, action: 'reject', reason })
    else await returnReservation(returnForm.id, { reason })
    ElMessage.success('已退回')
    returnDialogVisible.value = false
    if (returnForm.ids.length) selectedIds.value = []
    await loadData()
  } catch (e) {
    actionError.value = '退回失败，请重试'
  } finally {
    actionLock.release(token)
  }
}

function openDetail(row) {
  currentRow.value = row
  trailList.value = []
  trailError.value = ''
  detailVisible.value = true
  loadTrail(row.id)
}

async function handleBatch(action) {
  const ids = [...selectedIds.value]
  if (!ids.length) return
  const token = actionLock.acquire()
  if (!token) return
  actionError.value = ''
  const text = action === 'approve' ? '通过' : '退回'
  try {
    await ElMessageBox.confirm(`确认批量${text}选中的 ${ids.length} 条预约？`, '提示', { type: 'warning' })
    await batchAudit({ ids, action, reason: '' })
    ElMessage.success(`已批量${text}`)
    selectedIds.value = []
    await loadData()
  } catch (e) {
    if (!isConfirmationCancel(e)) actionError.value = `批量${text}失败，请重试`
  } finally {
    actionLock.release(token)
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

.trail-section {
  margin-top: 20px;
}

.trail-title {
  font-weight: 600;
  color: var(--jy-text-primary, #1A1A2E);
  margin-bottom: 12px;
}

.trail-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.trail-actor {
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
}

.trail-remark {
  margin-top: 6px;
  font-size: 13px;
  color: var(--jy-text-secondary, #475569);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
