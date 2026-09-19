<template>
  <div class="page-container">
    <ListToolbar
      v-model:keyword="filters.keyword"
      keyword-placeholder="搜索学号/姓名"
      export-file-name="导出_违规记录"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.type" placeholder="违规类型" clearable style="width: 150px" @change="onSearch">
        <el-option label="爽约" value="noshow" />
        <el-option label="超时未签退" value="overtime" />
        <el-option label="损坏设施" value="damage" />
        <el-option label="违规使用" value="misuse" />
        <el-option label="海报违规" value="poster" />
        <el-option label="其他" value="other" />
      </el-select>

      <template #actions>
        <el-button type="primary" @click="handleCreate">创建违规记录</el-button>
      </template>
    </ListToolbar>

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" />

    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !filteredTableData.length"
        empty-description="暂无违规记录"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table :data="filteredTableData" stripe>
          <el-table-column prop="userName" label="学生姓名" width="100" />
          <el-table-column prop="studentId" label="学号" width="130" />
          <el-table-column prop="type" label="违规类型" width="110">
            <template #default="{ row }">
              <el-tag :type="typeMap[row.type]?.tagType || 'info'" size="small">{{ typeMap[row.type]?.label || '其他违规' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="description" label="描述" min-width="180" show-overflow-tooltip />
          <el-table-column prop="deduction" label="扣分" width="80">
            <template #default="{ row }">
              <span style="color: #FF4D4F; font-weight: 600;">-{{ row.deduction }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="createdAt" label="记录时间" width="170" />
          <el-table-column prop="operatorName" label="操作人" width="100" />
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

    <el-dialog v-model="createDialogVisible" title="创建违规记录" width="500px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="学号" prop="studentId">
          <el-input v-model="form.studentId" placeholder="请输入学号" />
        </el-form-item>
        <el-form-item label="违规类型" prop="type">
          <el-select v-model="form.type" placeholder="请选择" style="width: 100%">
            <el-option label="爽约" value="noshow" />
            <el-option label="超时未签退" value="overtime" />
            <el-option label="损坏设施" value="damage" />
            <el-option label="违规使用" value="misuse" />
            <el-option label="海报违规" value="poster" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="扣分" prop="deduction">
          <el-input-number v-model="form.deduction" :min="1" :max="100" />
        </el-form-item>
        <el-form-item label="描述" prop="description">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入违规描述" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="confirmCreate">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getViolations, createViolation } from '@/api/credit'
import { ElMessage } from 'element-plus'
import AsyncState from '@/components/admin/AsyncState.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const loading = ref(false)
const loadError = ref('')
const submitLoading = ref(false)
const tableData = ref([])
const createDialogVisible = ref(false)
const formRef = ref(null)

const typeMap = {
  noshow: { label: '爽约', tagType: 'danger' },
  overtime: { label: '超时未签退', tagType: 'warning' },
  damage: { label: '损坏设施', tagType: 'danger' },
  misuse: { label: '违规使用', tagType: 'warning' },
  poster: { label: '海报违规', tagType: 'warning' },
  other: { label: '其他', tagType: 'info' }
}

// 导出列：与表格展示字段一一对应；R-14 仅导出后端已按数据域脱敏的返回值，不调用任何解掩码接口。
const exportColumns = [
  { header: '学生姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '违规类型', key: 'type', formatter: row => typeMap[row.type]?.label || '其他违规' },
  { header: '描述', key: 'description' },
  { header: '扣分', key: 'deduction', formatter: row => `-${row.deduction}` },
  { header: '记录时间', key: 'createdAt' },
  { header: '操作人', key: 'operatorName' }
]

const filters = reactive({ type: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ studentId: '', type: '', deduction: 10, description: '' })
const rules = {
  studentId: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  type: [{ required: true, message: '请选择违规类型', trigger: 'change' }],
  deduction: [{ required: true, message: '请输入扣分', trigger: 'blur' }],
  description: [{ required: true, message: '请输入描述', trigger: 'blur' }]
}

// 🔧 后端 GET /credit/violations 只支持 type / userId / page / pageSize，不支持 keyword，
// 关键词改为对已加载数据做前端过滤；表格渲染与导出共用同一份过滤逻辑。
function matchKeyword(row, keyword) {
  if (!keyword) return true
  const text = keyword.trim().toLowerCase()
  if (!text) return true
  return String(row.studentId || '').toLowerCase().includes(text) ||
    String(row.userName || '').toLowerCase().includes(text)
}

const filteredTableData = computed(() => tableData.value.filter(row => matchKeyword(row, filters.keyword)))

// 列表查询参数单一来源；后端只认 type，keyword 不进请求参数。
function buildParams() {
  return { type: filters.type }
}

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getViolations({ ...buildParams(), page: pagination.page, pageSize: pagination.pageSize }, { silentError: true })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    loadError.value = '违规记录加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.type = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

function handleCreate() {
  Object.assign(form, { studentId: '', type: '', deduction: 10, description: '' })
  createDialogVisible.value = true
}

async function confirmCreate() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await createViolation(form)
    ElMessage.success('创建成功')
    createDialogVisible.value = false
    loadData()
  } catch (e) {
    // handled
  } finally {
    submitLoading.value = false
  }
}

// 导出「筛选后全量」：type 由服务端过滤，keyword 在拉全量后按同一套前端规则过滤。
// 该路由挂载了 paginationRules（pageSize<=100），必须按页循环拉取，不能一次性请求超大 pageSize。
async function handleExport() {
  try {
    const list = await fetchAllPages(getViolations, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      options: { silentError: true }
    })
    const rows = list.filter(row => matchKeyword(row, filters.keyword))
    if (!exportXlsx(exportColumns, rows, '导出_违规记录')) return
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
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
