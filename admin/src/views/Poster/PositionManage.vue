<template>
  <div class="page-container">
    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索位置名称"
      export-file-name="导出_海报位置"
      @search="loadData"
      @reset="resetFilters"
      @export="handleExport"
    />

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">海报位置管理</span>
        <el-button type="primary" @click="handleAdd">
          <el-icon><Plus /></el-icon>新增位置
        </el-button>
      </div>

      <el-table :data="filteredRows" v-loading="loading" stripe>
        <el-table-column prop="name" label="位置名称" width="180" />
        <el-table-column prop="building" label="所在楼栋" width="140" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column prop="maxPosters" label="最大海报数" width="120" />
        <el-table-column prop="currentPosters" label="当前海报数" width="120" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑位置' : '新增位置'" width="500px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="位置名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入位置名称" />
        </el-form-item>
        <el-form-item label="所在楼栋" prop="building">
          <el-input v-model="form.building" placeholder="请输入楼栋" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input-number v-model="form.floor" :min="1" :max="30" />
        </el-form-item>
        <el-form-item label="最大海报数" prop="maxPosters">
          <el-input-number v-model="form.maxPosters" :min="1" :max="50" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入描述" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getPositions, createPosition, updatePosition, deletePosition } from '@/api/poster'
import { ElMessage, ElMessageBox } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx } from '@/utils/exportXlsx'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)

const form = reactive({ id: null, name: '', building: '', floor: 1, maxPosters: 4, status: 'active', description: '' })
const rules = {
  name: [{ required: true, message: '请输入位置名称', trigger: 'blur' }],
  building: [{ required: true, message: '请输入楼栋', trigger: 'blur' }]
}

// 海报位置是配置类小表：后端不提供位置筛选参数（且无独立的位置分页接口），
// 状态与名称筛选统一由前端对已加载行兜底（🔧）。
const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' }
]

// R-14：位置为公共配置数据，不含任何个人敏感信息。
const exportColumns = [
  { header: '位置名称', key: 'name', width: 20 },
  { header: '所在楼栋', key: 'building' },
  { header: '楼层', key: 'floor' },
  { header: '最大海报数', key: 'maxPosters' },
  { header: '当前海报数', key: 'currentPosters' },
  { header: '状态', formatter: row => (row.status === 'active' ? '启用' : '停用') },
  { header: '描述', key: 'description', width: 30 }
]

const filters = reactive({ status: '', keyword: '' })

/**
 * 前端兜底筛选：状态精确匹配 + 名称包含匹配。
 * @param {object} row 位置行
 * @returns {boolean} 是否命中
 */
function matchFilters(row) {
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  const statusOk = !filters.status || row.status === filters.status
  const keywordOk = !keyword || String(row.name || '').toLowerCase().includes(keyword)
  return statusOk && keywordOk
}

const filteredRows = computed(() => tableData.value.filter(matchFilters))

async function loadData() {
  loading.value = true
  try {
    const res = await getPositions({ pageSize: 100 })
    tableData.value = res.data?.list || []
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

// 重置筛选后重新拉取一次，保证与后端最新数据一致
function resetFilters() {
  filters.status = ''
  filters.keyword = ''
  loadData()
}

/**
 * 非分页小表导出：后端一次以 pageSize:100 返回全部位置，且无分页/筛选参数，
 * 因此直接导出「当前已加载 + 已前端筛选」的行，无需分页循环拉取。
 */
async function handleExport() {
  try {
    const rows = filteredRows.value
    if (!exportXlsx(exportColumns, rows, '导出_海报位置')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

function handleAdd() {
  isEdit.value = false
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  Object.assign(form, { id: row.id, name: row.name, building: row.building, floor: row.floor, maxPosters: row.maxPosters, status: row.status, description: row.description || '' })
  dialogVisible.value = true
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除位置"${row.name}"？`, '提示', { type: 'warning' })
    await deletePosition(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {
    // cancelled
  }
}

function resetForm() {
  Object.assign(form, { id: null, name: '', building: '', floor: 1, maxPosters: 4, status: 'active', description: '' })
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updatePosition(form.id, form)
      ElMessage.success('更新成功')
    } else {
      await createPosition(form)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (e) {
    // handled
  } finally {
    submitLoading.value = false
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
</style>
