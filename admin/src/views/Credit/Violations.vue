<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="违规类型">
          <el-select v-model="filters.type" placeholder="全部" clearable style="width: 140px">
            <el-option label="爽约" value="noshow" />
            <el-option label="超时未签退" value="overtime" />
            <el-option label="损坏设施" value="damage" />
            <el-option label="违规使用" value="misuse" />
            <el-option label="海报违规" value="poster" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="学号">
          <el-input v-model="filters.studentId" placeholder="输入学号" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
        <el-form-item class="create-item">
          <el-button type="primary" @click="handleCreate">创建违规记录</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" />

    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !tableData.length"
        empty-description="暂无违规记录"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table :data="tableData" stripe>
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
import { ref, reactive, onMounted } from 'vue'
import { getViolations, createViolation } from '@/api/credit'
import { ElMessage } from 'element-plus'
import AsyncState from '@/components/admin/AsyncState.vue'

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

const filters = reactive({ type: '', studentId: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ studentId: '', type: '', deduction: 10, description: '' })
const rules = {
  studentId: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  type: [{ required: true, message: '请选择违规类型', trigger: 'change' }],
  deduction: [{ required: true, message: '请输入扣分', trigger: 'blur' }],
  description: [{ required: true, message: '请输入描述', trigger: 'blur' }]
}

async function loadData() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getViolations({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    loadError.value = '违规记录加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.type = ''
  filters.studentId = ''
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

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
}

/* 写操作与查询筛选视觉分区：以竖分隔线拉开「查询/重置」与「创建违规记录」 */
.filter-card :deep(.create-item) {
  margin-left: 16px;
  padding-left: 16px;
  border-left: 1px solid var(--el-border-color-lighter, #EBEEF5);
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
