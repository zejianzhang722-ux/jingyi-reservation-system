<template>
  <PageShell
    title="信用与预约权限"
    eyebrow="信用管控"
    description="低信用仅影响预约权限，不限制登录。可清理旧规则留下的信用限制记录。"
  >


    <template #actions><el-button type="primary" @click="handleSetCredit()">设置信用</el-button></template>
    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="当前名单" :value="total" caption="低信用及历史限制记录" icon="CircleCloseFilled" tone="danger" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="处理方式" value="人工 + 自动" caption="按当前信用区间自动调整预约" icon="Operation" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="处理要求" value="不影响登录" caption="已有预约仍可签到签退" icon="DocumentChecked" tone="primary" />
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
    ><el-select v-model="filters.range" placeholder="信用区间" clearable @change="onSearch"><el-option label="60–79分" value="warning" /><el-option label="30–59分" value="restricted" /><el-option label="0–29分" value="strict" /></el-select></ListToolbar>

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
        <el-table-column label="预约权限" min-width="210"><template #default="{ row }">{{ bookingLabel(row.creditScore) }}</template></el-table-column>

        <el-table-column prop="banExpiresAt" label="旧限制期限" width="170" show-overflow-tooltip />

        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleViewCredit(row)">详情</el-button><el-button type="primary" size="small" link @click="handleSetCredit(row)">设置</el-button><el-button v-if="row.banExpiresAt" type="success" size="small" link @click="handleUnban(row)" :disabled="actionSubmitting">清理旧限制</el-button>
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


    <el-dialog v-model="creditDialogVisible" title="设置信用与预约权限" width="520px" :close-on-click-modal="!creditSaving" :close-on-press-escape="!creditSaving" :show-close="!creditSaving"><el-alert title="信用仅调整预约权限，不限制登录" type="info" :closable="false" class="form-alert" /><el-form label-position="top"><el-form-item label="宿生学号"><el-input v-model="creditForm.studentId" placeholder="请输入学号" :disabled="creditSaving" /></el-form-item><el-form-item label="目标信用分"><el-input-number v-model="creditForm.score" :min="0" :max="120" :disabled="creditSaving" /><span class="permission-tip">{{ bookingLabel(creditForm.score) }}</span></el-form-item><el-form-item label="调整原因"><el-input v-model="creditForm.reason" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="请填写调整依据" :disabled="creditSaving" /></el-form-item></el-form><template #footer><el-button :disabled="creditSaving" @click="creditDialogVisible=false">取消</el-button><el-button type="primary" :loading="creditSaving" @click="saveCredit">保存设置</el-button></template></el-dialog>
    <el-dialog v-model="detailVisible" title="宿生信用详情" width="640px"><template v-if="creditDetail"><el-descriptions :column="2" border><el-descriptions-item label="姓名">{{ creditDetail.student.real_name }}</el-descriptions-item><el-descriptions-item label="学号">{{ creditDetail.student.student_id }}</el-descriptions-item><el-descriptions-item label="信用分">{{ creditDetail.student.credit_score }}</el-descriptions-item><el-descriptions-item label="预约权限">{{ bookingLabel(creditDetail.student.credit_score) }}</el-descriptions-item></el-descriptions><h3>最近信用记录</h3><el-table :data="creditDetail.logs" max-height="320"><el-table-column prop="created_at" label="时间" width="160" /><el-table-column prop="description" label="原因" /><el-table-column prop="score_change" label="变动" width="80" /><el-table-column prop="score_after" label="变动后" width="80" /></el-table></template></el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getBlacklist, toggleBan, getStudentCredit, setStudentCredit } from '@/api/credit'
import { ElMessage, ElMessageBox } from 'element-plus'
import { creditRow } from '@/utils/managementPresenter'
import { createActionLock } from '@/utils/approvalState'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx } from '@/utils/exportXlsx'

const loading = ref(false)
const actionSubmitting = ref(false)
const actionLock = createActionLock()
const allRows = ref([])

const filters = reactive({ status: '', keyword: '', range: '' })
const pagination = reactive({ page: 1, pageSize: 10 })

// 🔧 后端 GET /credit/blacklist 不支持 status 筛选，状态下拉由前端兜底
const statusOptions = [
  { label: '历史信用限制', value: 'banned' },
  { label: '预约受限', value: 'restricted' },
  { label: '低信用', value: 'active' }
]

const statusMap = {
  banned: { label: '历史信用限制', type: 'danger' },
  restricted: { label: '预约受限', type: 'warning' },
  active: { label: '低信用', type: 'info' }
}

// 导出列：与表格展示字段一致；R-14 取的是后端经 privacyAuditService 按数据域脱敏后的值，
// 绝不解掩码或拼接 PII。
const exportColumns = [
  { header: '学生姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '信用分', key: 'creditScore', formatter: row => (row.creditScore ?? '-') },
  { header: '状态', key: 'status', formatter: row => statusMap[row.status]?.label || '状态待确认' },
  { header: '预约权限', formatter: row => bookingLabel(row.creditScore) },
  { header: '旧限制期限', key: 'banExpiresAt' }
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
  const score=Number(row.creditScore)
  if (filters.range && !(filters.range === 'warning' ? score>=60 && score<80 : filters.range === 'restricted' ? score>=30 && score<60 : score<30)) return false
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
    allRows.value = allRows.value.map(creditRow)
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
  filters.range = ''
  filters.status = ''
  filters.keyword = ''
  pagination.page = 1
}

async function handleUnban(row) {
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  try {
    await ElMessageBox.confirm(`确认清理 ${row.userName || row.studentId} 的历史信用限制？预约权限仍按当前分数执行。`, '提示', { type: 'success' })
    await toggleBan({ userId: row.userId || row.id, studentId: row.studentId, action: 'unban' })
    ElMessage.success('旧限制已清理，预约权限按当前分数执行')
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

const creditDialogVisible=ref(false),creditSaving=ref(false),detailVisible=ref(false),creditDetail=ref(null)
const creditForm=reactive({studentId:'',score:100,reason:''})
function bookingLabel(value) { const score=Number(value);return score>=80?'提前3天 · 每天同类3次 · 房间开放时段':score>=60?'提前2天 · 每天同类2次 · 房间开放时段':score>=30?'提前1天 · 每天同类1次 · 08:00–20:00':'仅当天 · 每天同类1次 · 09:00–17:00' }
function handleSetCredit(row) {Object.assign(creditForm,{studentId:row?.studentId || '',score:row?.creditScore ?? 100,reason:''});creditDialogVisible.value=true}
async function handleViewCredit(row) { try { const res=await getStudentCredit(row.userId || row.id);creditDetail.value=res.data;detailVisible.value=true } catch (_) {} }
async function saveCredit() {
  if(creditSaving.value)return
  if(!/^\d{9,10}$/.test(creditForm.studentId.trim()) || !creditForm.reason.trim() || !Number.isInteger(creditForm.score)){ElMessage.warning('请填写有效学号、信用分和调整原因');return}
  creditSaving.value=true
  try {await setStudentCredit(creditForm.studentId.trim(),{score:creditForm.score,reason:creditForm.reason.trim()});ElMessage.success('信用分及预约权限已更新');creditDialogVisible.value=false;await loadData()} catch (_) {} finally {creditSaving.value=false}
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

.permission-tip { display:block; margin-left:16px; font-size:13px; color:#667a91; line-height:1.8 }
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
