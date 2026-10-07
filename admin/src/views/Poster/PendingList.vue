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
        <el-table-column label="海报图片" width="100"><template #default="{ row }"><el-image v-if="row.imageUrl" :src="row.imageUrl" :preview-src-list="[row.imageUrl]" preview-teleported fit="cover" style="width:64px;height:80px;border-radius:8px"><template #error><span class="image-note">加载失败</span></template></el-image><span v-else class="image-note">未上传</span></template></el-table-column>
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
            <el-button type="primary" size="small" link @click="handleDetail(row)">详情</el-button>
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

    <el-dialog v-model="detailVisible" :title="detail?.title || '海报申请详情'" width="680px"><template v-if="detail"><el-image v-if="detail.imageUrl" :src="detail.imageUrl" :preview-src-list="[detail.imageUrl]" preview-teleported fit="contain" class="poster-full-image"><template #error><el-alert title="海报图片暂时无法加载" type="warning" :closable="false" /></template></el-image><el-alert v-else title="申请人未上传海报图片，可退回补充" type="info" :closable="false" /><el-descriptions :column="2" border class="poster-detail-fields"><el-descriptions-item label="申请人">{{ detail.userName }}</el-descriptions-item><el-descriptions-item label="学号">{{ detail.studentId }}</el-descriptions-item><el-descriptions-item label="申请组织">{{ detail.organization || '未填写' }}</el-descriptions-item><el-descriptions-item label="投放位置">{{ detail.position }}</el-descriptions-item><el-descriptions-item label="开始日期">{{ detail.startDate }}</el-descriptions-item><el-descriptions-item label="结束日期">{{ detail.endDate }}</el-descriptions-item><el-descriptions-item label="内容说明" :span="2">{{ detail.description || '未填写' }}</el-descriptions-item></el-descriptions></template></el-dialog>
    <el-dialog v-model="rejectDialogVisible" title="驳回海报" width="520px" :close-on-click-modal="!rejectSubmitting" :close-on-press-escape="!rejectSubmitting" :show-close="!rejectSubmitting">
      <el-form :model="rejectForm" label-width="80px">
        <el-form-item label="常用原因"><el-select v-model="rejectForm.preset" placeholder="选择常用原因" clearable @change="value => rejectForm.reason=value || ''"><el-option v-for="reason in rejectReasons" :key="reason" :label="reason" :value="reason" /></el-select></el-form-item>
        <el-form-item label="具体说明">
          <el-input v-model="rejectForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请说明需要修改的内容" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rejectDialogVisible = false" :disabled="rejectSubmitting">取消</el-button>
        <el-button type="danger" :loading="rejectSubmitting" @click="confirmReject">确认驳回</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { posterRow } from '@/utils/managementPresenter'
import { ref, reactive, computed, onMounted } from 'vue'
import { getPending, approve, reject, markClean, markViolation } from '@/api/poster'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const detailVisible=ref(false),detail=ref(null),rejectSubmitting=ref(false)
const rejectReasons=['未提供海报图片','图片内容需调整','投放时间需调整','申请信息不完整']
function handleDetail(row) {detail.value=row;detailVisible.value=true}
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
  { header: '状态', formatter: row => statusMap[row.status]?.label || '状态待确认' },
  { header: '申请时间', key: 'createdAt', width: 20 }
]

const filters = reactive({ status: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', preset: '', id: null })

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
    tableData.value = (res.data?.list || []).map(posterRow)
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
    const rows = list.map(posterRow).filter(row => matchKeyword(row, filters.keyword))
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
  rejectForm.reason = ''; rejectForm.preset = ''
  rejectDialogVisible.value = true
}

async function confirmReject() {
  if (rejectSubmitting.value) return
  if (!rejectForm.reason.trim()) {
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
.poster-full-image{width:100%;max-height:420px;background:#f3f7fb;border-radius:12px}.poster-detail-fields{margin-top:20px}.image-note{font-size:12px;color:#8492a6}
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
