<template>
  <PageShell
    title="黑名单与受限账号"
    eyebrow="信用管控"
    description="集中处理低信用、受限和封禁宿生，所有人工操作都需要填写原因，方便后续审计。"
  >
    <template #actions>
      <el-button type="danger" @click="handleManualBan">手动封禁</el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="当前名单" :value="total" caption="受限、封禁或低信用宿生" icon="CircleCloseFilled" tone="danger" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="处理方式" value="人工 + 自动" caption="支持学号封禁和列表解封" icon="Operation" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="处理要求" value="必须填原因" caption="原因将留存在操作记录中" icon="DocumentChecked" tone="primary" />
      </el-col>
    </el-row>

    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索学号/姓名"
      export-file-name="导出_黑名单列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    />

    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="userName" label="学生姓名" width="120" />
        <el-table-column prop="studentId" label="学号" width="140" />
        <el-table-column prop="creditScore" label="信用分" width="100">
          <template #default="{ row }">
            <span :class="['credit-score', { danger: Number(row.creditScore) < 60 }]">{{ row.creditScore ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">{{ statusMap[row.status]?.label || '状态待确认' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="进入原因" min-width="180" show-overflow-tooltip />
        <el-table-column prop="bannedAt" label="处理时间" width="170" show-overflow-tooltip />
        <el-table-column prop="banExpiresAt" label="预计恢复" width="170" show-overflow-tooltip />
        <el-table-column prop="violationCount" label="违规次数" width="100" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link @click="handleUnban(row)" :disabled="actionSubmitting">恢复正常</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
        />
      </div>
    </el-card>

    <el-dialog v-model="banDialogVisible" title="手动封禁宿生" width="500px">
      <el-alert title="请核对宿生学号并填写封禁原因；原因将留存在操作记录中，便于后续查询。" type="warning" show-icon :closable="false" class="form-alert" />
      <el-form ref="formRef" :model="banForm" :rules="rules" label-width="100px">
        <el-form-item label="学号" prop="studentId">
          <el-input v-model="banForm.studentId" placeholder="请输入学号" />
        </el-form-item>
        <el-form-item label="封禁原因" prop="reason">
          <el-input v-model="banForm.reason" type="textarea" :rows="3" placeholder="请输入封禁原因" />
        </el-form-item>
        <el-form-item label="封禁天数" prop="days">
          <el-input-number v-model="banForm.days" :min="1" :max="365" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="banDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="submitLoading" :disabled="actionSubmitting" @click="confirmBan">确认封禁</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getBlacklist, toggleBan } from '@/api/credit'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createActionLock } from '@/utils/approvalState'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx } from '@/utils/exportXlsx'

const loading = ref(false)
const submitLoading = ref(false)
const actionSubmitting = ref(false)
const actionLock = createActionLock()
const allRows = ref([])
const banDialogVisible = ref(false)
const formRef = ref(null)

const filters = reactive({ status: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10 })
const banForm = reactive({ studentId: '', reason: '', days: 7 })
const rules = {
  studentId: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  reason: [{ required: true, message: '请输入封禁原因', trigger: 'blur' }],
  days: [{ required: true, message: '请输入封禁天数', trigger: 'blur' }]
}

// 🔧 后端 GET /credit/blacklist 不支持 status 筛选，状态下拉由前端兜底
const statusOptions = [
  { label: '封禁', value: 'banned' },
  { label: '受限', value: 'restricted' },
  { label: '低信用', value: 'active' }
]

const statusMap = {
  banned: { label: '封禁', type: 'danger' },
  restricted: { label: '受限', type: 'warning' },
  active: { label: '低信用', type: 'info' }
}

// 导出列：与表格展示字段一致；R-14 取的是后端经 privacyAuditService 按数据域脱敏后的值，
// 绝不解掩码或拼接 PII。
const exportColumns = [
  { header: '学生姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '信用分', key: 'creditScore', formatter: row => (row.creditScore ?? '-') },
  { header: '状态', key: 'status', formatter: row => statusMap[row.status]?.label || '状态待确认' },
  { header: '进入原因', key: 'reason' },
  { header: '处理时间', key: 'bannedAt' },
  { header: '预计恢复', key: 'banExpiresAt' },
  { header: '违规次数', key: 'violationCount' }
]

function matchKeyword(row, keyword) {
  if (!keyword) return true
  const text = keyword.trim().toLowerCase()
  if (!text) return true
  return String(row.studentId || '').toLowerCase().includes(text) ||
    String(row.userName || '').toLowerCase().includes(text)
}

// 黑名单接口既不分页也不支持任何筛选（服务端一次性返回全量），
// 因此状态 / 关键词过滤与分页都在前端完成，保证「导出结果 == 当前筛选视图」。
const filteredRows = computed(() => allRows.value.filter(row => {
  if (filters.status && row.status !== filters.status) return false
  return matchKeyword(row, filters.keyword)
}))

const total = computed(() => filteredRows.value.length)

const tableData = computed(() => {
  const start = (pagination.page - 1) * pagination.pageSize
  return filteredRows.value.slice(start, start + pagination.pageSize)
})

async function loadData() {
  loading.value = true
  try {
    const res = await getBlacklist({}, { silentError: true })
    // 该接口用 response.success 直接回数组（不是 { list, total }），这里两种形态都兜住。
    const payload = res.data
    allRows.value = Array.isArray(payload?.list) ? payload.list : (Array.isArray(payload) ? payload : [])
    // 过滤/翻页都是前端行为，页码越界时回退到最后一页有效位置
    const maxPage = Math.max(1, Math.ceil(total.value / pagination.pageSize))
    if (pagination.page > maxPage) pagination.page = maxPage
  } catch (e) {
    // 失败时保留上一次成功快照，避免列表闪烁为空
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pagination.page = 1
}

function resetFilters() {
  filters.status = ''
  filters.keyword = ''
  pagination.page = 1
}

function handleManualBan() {
  Object.assign(banForm, { studentId: '', reason: '', days: 7 })
  banDialogVisible.value = true
}

async function confirmBan() {
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  try {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await toggleBan({ studentId: banForm.studentId, action: 'ban', reason: banForm.reason, days: banForm.days })
    ElMessage.success('封禁成功')
    banDialogVisible.value = false
    loadData()
  } catch (e) {
    // handled by interceptor
  } finally {
    submitLoading.value = false
    actionSubmitting.value = false
    actionLock.release(token)
  }
  } finally {
    if (actionLock.release(token)) actionSubmitting.value = false
  }
}

async function handleUnban(row) {
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  try {
    await ElMessageBox.confirm(`确认恢复 ${row.userName || row.studentId} 的账号状态？`, '提示', { type: 'success' })
    await toggleBan({ userId: row.userId || row.id, studentId: row.studentId, action: 'unban' })
    ElMessage.success('已恢复正常')
    loadData()
  } catch (e) {
    // cancelled
  } finally {
    actionSubmitting.value = false
    actionLock.release(token)
  }
}

// 非分页接口：服务端一次性返回全部黑名单成员，已加载行即全量，
// 无需（也无法）再用 fetchAllPages 翻页，导出直接基于 filteredRows。
function handleExport() {
  try {
    const rows = filteredRows.value
    if (!exportXlsx(exportColumns, rows, '导出_黑名单列表')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.form-alert {
  margin-bottom: 16px;
}

.credit-score {
  color: var(--jy-success, #52C41A);
  font-weight: 700;
}

.credit-score.danger {
  color: var(--jy-danger, #FF4D4F);
}
</style>
