<template>
  <div class="page-container">
    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索申请人/学号"
      export-file-name="导出_海报审核列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    />

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">海报审核列表</span>
      </div>

      <el-table class="review-motion-table" :data="filteredRows" v-loading="loading" stripe>
        <el-table-column prop="userName" label="申请人" width="100" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="title" label="海报标题" min-width="150" show-overflow-tooltip />
        <el-table-column prop="position" label="张贴位置" width="120" />
        <el-table-column prop="startDate" label="开始日期" width="110" />
        <el-table-column prop="endDate" label="结束日期" width="110" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type" size="small">{{ statusMap[row.status]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="申请时间" width="170" />
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link @click="handleApprove(row)" v-if="row.status === 'pending'">通过</el-button>
            <el-button type="danger" size="small" link @click="handleReject(row)" v-if="row.status === 'pending'">驳回</el-button>
            <el-button type="warning" size="small" link @click="handleClean(row)" v-if="row.status === 'approved'">已清理</el-button>
            <el-button type="danger" size="small" link @click="handleViolation(row)" v-if="row.status === 'approved'">违规</el-button>
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

    <el-dialog v-model="rejectDialogVisible" title="驳回海报" width="480px">
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getPending, approve, reject, markClean, markViolation } from '@/api/poster'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const loading = ref(false)
const tableData = ref([])
const rejectDialogVisible = ref(false)

const statusMap = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' }
}

// GET /poster 后端仅支持 status 过滤（scopedQueryController.posters），不支持 keyword → 关键词前端兜底（🔧）。
const statusOptions = [
  { label: '待审核', value: 'pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' }
]

// R-14：导出字段与表格展示字段一致，均取自后端出口已脱敏的海报行
//（scopedQueryController.posters → privacyAuditService.maskRowsForRequest），
// 不调用任何解掩码接口、不拼接 PII。
const exportColumns = [
  { header: '申请人', key: 'userName' },
  { header: '学号', key: 'studentId', width: 16 },
  { header: '海报标题', key: 'title', width: 24 },
  { header: '张贴位置', key: 'position' },
  { header: '开始日期', key: 'startDate' },
  { header: '结束日期', key: 'endDate' },
  { header: '状态', formatter: row => statusMap[row.status]?.label || row.status || '' },
  { header: '申请时间', key: 'createdAt', width: 20 }
]

const filters = reactive({ status: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', id: null })

/**
 * 关键词前端兜底：后端 /poster 无 keyword 参数，只能对已加载数据做包含匹配。
 * @param {object} row 海报行
 * @param {string} keyword 关键词
 * @returns {boolean} 是否命中
 */
function matchKeyword(row, keyword) {
  const text = String(keyword || '').trim().toLowerCase()
  if (!text) return true
  return [row.userName, row.studentId, row.title, row.position]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(text)
}

const filteredRows = computed(() => tableData.value.filter(row => matchKeyword(row, filters.keyword)))

// 列表查询参数单一来源：只带后端支持的 status；keyword 由前端兜底。
function buildParams() {
  return { status: filters.status || '' }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getPending({ ...buildParams(), page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

// 状态/关键词变更后回到第 1 页再查询
function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.status = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

/**
 * 导出当前筛选条件下的全量海报申请。
 * 后端 paginationRules 限制 pageSize<=100（scopedQueryController.pagination 亦二次 Math.min(100, ...)），
 * 故按页循环拉取；keyword 后端不支持，导出时对全量结果套用同一套前端过滤，保证「导出 == 当前筛选视图」。
 */
async function handleExport() {
  try {
    const list = await fetchAllPages(getPending, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      options: { silentError: true }
    })
    const rows = list.filter(row => matchKeyword(row, filters.keyword))
    if (!exportXlsx(exportColumns, rows, '导出_海报审核列表')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

async function handleApprove(row) {
  try {
    await ElMessageBox.confirm('确认通过该海报申请？', '提示', { type: 'success' })
    await approve(row.id)
    ElMessage.success('已通过')
    loadData()
  } catch (e) {
    // cancelled
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

async function handleClean(row) {
  try {
    await ElMessageBox.confirm('确认该海报已清理？', '提示')
    await markClean(row.id)
    ElMessage.success('已标记清理')
    loadData()
  } catch (e) {
    // cancelled
  }
}

async function handleViolation(row) {
  try {
    await ElMessageBox.confirm('确认标记该海报为违规？将扣除申请人信用分', '提示', { type: 'warning' })
    await markViolation(row.id, { reason: '海报违规' })
    ElMessage.success('已标记违规')
    loadData()
  } catch (e) {
    // cancelled
  }
}

onMounted(() => {
  loadData()
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
</style>
