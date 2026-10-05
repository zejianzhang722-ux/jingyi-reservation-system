<template>
  <div class="page-container">
    <ListToolbar
      v-model:keyword="filters.keyword"
      keyword-placeholder="搜索学生姓名/学号"
      export-file-name="导出_辅导员审批列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.buildingId" placeholder="楼栋" clearable style="width: 140px" @change="onSearch">
        <el-option v-for="b in buildingOptions" :key="b.id" :label="b.name" :value="b.id" />
      </el-select>
      <el-date-picker v-model="filters.date" type="date" placeholder="预约日期" value-format="YYYY-MM-DD" style="width: 160px" @change="onSearch" />
    </ListToolbar>

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" />
    <el-alert v-if="actionError" :title="actionError" type="error" show-icon closable @close="actionError = ''" />
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">辅导员审批列表</span>
        <el-tag type="warning">待审批 {{ pagination.total }} 条</el-tag>
      </div>

      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !filteredRows.length"
        empty-description="暂无待辅导员审批的预约"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table class="review-motion-table" :data="filteredRows" stripe>
          <el-table-column prop="userName" label="学生姓名" width="100" />
          <el-table-column prop="studentId" label="学号" width="130" />
          <el-table-column prop="roomName" label="功能房" width="130" />
          <el-table-column prop="date" label="预约日期" width="110" />
          <el-table-column prop="timeSlot" label="时间段" width="150" />
          <el-table-column prop="purpose" label="用途" min-width="140" show-overflow-tooltip />
          <el-table-column prop="counselorName" label="辅导员" width="100" />
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button type="success" size="small" link :loading="actionSubmitting" :disabled="actionSubmitting" @click="handleApprove(row)">通过</el-button>
              <el-button type="danger" size="small" link :disabled="actionSubmitting" @click="handleReject(row)">驳回</el-button>
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
      </AsyncState>
    </el-card>

    <el-dialog v-model="rejectDialogVisible" title="驳回预约" width="480px">
      <el-form :model="rejectForm" label-width="80px">
        <el-form-item label="驳回原因">
          <el-input v-model="rejectForm.reason" type="textarea" :rows="3" placeholder="请输入驳回原因" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button :disabled="actionSubmitting" @click="rejectDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="actionSubmitting" :disabled="actionSubmitting" @click="confirmReject">确认驳回</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailDialogVisible" title="预约详情" width="560px">
      <el-descriptions :column="2" border v-if="currentRow">
        <el-descriptions-item label="学生姓名">{{ currentRow.userName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentRow.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.timeSlot }}</el-descriptions-item>
        <el-descriptions-item label="辅导员">{{ currentRow.counselorName }}</el-descriptions-item>
        <el-descriptions-item label="用途" :span="2">{{ currentRow.purpose }}</el-descriptions-item>
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
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getCounselorPending, approve, reject, getReservationTrail } from '@/api/reservation'
import { getBuildings } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import AsyncState from '@/components/admin/AsyncState.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'
import { createActionLock, isConfirmationCancel, normalizeRejectionReason } from '@/utils/approvalState'

// 导出列：与表格展示字段一一对应（R-14：只导出页面已展示、后端已脱敏的字段）。
const exportColumns = [
  { header: '学生姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '功能房', key: 'roomName' },
  { header: '预约日期', key: 'date' },
  { header: '时间段', key: 'timeSlot' },
  { header: '用途', key: 'purpose' },
  { header: '辅导员', key: 'counselorName' }
]

const loading = ref(false)
const loadError = ref('')
const actionSubmitting = ref(false)
const actionError = ref('')
const actionLock = createActionLock(value => { actionSubmitting.value = value })
const tableData = ref([])
const buildingOptions = ref([])
const rejectDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const currentRow = ref(null)

// R-07 审核轨迹（只读）
const trailLoading = ref(false)
const trailError = ref('')
const trailList = ref([])
const TRAIL_STAGE_LABELS = { first: '一审', counselor: '二审' }
const TRAIL_ACTION_LABELS = { approve: '通过', reject: '驳回', remark: '批注', transfer: '转派' }
const TRAIL_ACTION_TYPES = { approve: 'success', reject: 'danger', remark: 'info', transfer: 'warning' }
const TRAIL_ROLE_LABELS = { admin: '管理员', super_admin: '超级管理员', counselor: '辅导员', system: '系统', student: '学生' }
const trailStageLabel = stage => TRAIL_STAGE_LABELS[stage] || '审核'
const trailActionLabel = action => TRAIL_ACTION_LABELS[action] || '记录'
const trailActionType = action => TRAIL_ACTION_TYPES[action] || 'info'
const trailRoleLabel = role => TRAIL_ROLE_LABELS[role] || '系统'

const filters = reactive({ buildingId: '', date: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', id: null })

// 查询参数单一来源：列表加载与导出共用，保证「导出结果 == 当前筛选视图」。
// 实测后端 GET /audit/counselor/pending 仅认 buildingId / date / page / pageSize
// （type 由 URL 推导为 counselor），**不认 keyword**，故关键词走前端兜底。
function buildParams() {
  return {
    buildingId: filters.buildingId,
    date: filters.date
  }
}

// 前端兜底过滤：后端不支持 keyword，按学生姓名 / 学号在本地数据里匹配。
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
    const res = await getCounselorPending({ ...buildParams(), page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    loadError.value = '列表加载失败，请重试'
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

// 筛选条件变化后回到第 1 页（buildingId / date 为服务端筛选，keyword 为前端过滤）。
function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.buildingId = ''
  filters.date = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

// 导出「筛选后全量」：后端 paginationRules 限制 pageSize<=100，不能一次性要 10000，
// 必须按页循环拉取；keyword 后端不认，拉全量后套用与列表完全一致的 matchFilters。
async function handleExport() {
  try {
    const list = await fetchAllPages(getCounselorPending, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      // 注：getCounselorPending 当前签名只有 (params)，options 暂不生效；保留以对齐其他页面约定。
      options: { silentError: true }
    })
    const rows = list.filter(row => matchFilters(row))
    if (!exportXlsx(exportColumns, rows, '导出_辅导员审批列表')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
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

function handleReject(row) {
  rejectForm.id = row.id
  rejectForm.reason = ''
  rejectDialogVisible.value = true
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
    await reject(rejectForm.id, { reason })
    ElMessage.success('已驳回')
    rejectDialogVisible.value = false
    await loadData()
  } catch (e) {
    actionError.value = '驳回失败，请重试'
  } finally {
    actionLock.release(token)
  }
}

function handleDetail(row) {
  currentRow.value = row
  trailList.value = []
  trailError.value = ''
  detailDialogVisible.value = true
  loadTrail(row.id)
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
