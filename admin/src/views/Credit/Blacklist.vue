<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="学号/姓名">
          <el-input v-model="filters.keyword" placeholder="搜索" clearable style="width: 160px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">黑名单管理</span>
        <el-button type="danger" @click="handleManualBan">手动封禁</el-button>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="userName" label="学生姓名" width="100" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="creditScore" label="信用分" width="90">
          <template #default="{ row }">
            <span :style="{ color: row.creditScore < 60 ? '#FF4D4F' : '#52C41A', fontWeight: 600 }">{{ row.creditScore }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="封禁原因" min-width="180" show-overflow-tooltip />
        <el-table-column prop="bannedAt" label="封禁时间" width="170" />
        <el-table-column prop="banExpiresAt" label="解封时间" width="170" />
        <el-table-column prop="violationCount" label="违规次数" width="100" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link @click="handleUnban(row)">解封</el-button>
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

    <el-dialog v-model="banDialogVisible" title="手动封禁" width="480px">
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
        <el-button type="danger" :loading="submitLoading" @click="confirmBan">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getBlacklist, toggleBan } from '@/api/credit'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const banDialogVisible = ref(false)
const formRef = ref(null)

const filters = reactive({ keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const banForm = reactive({ studentId: '', reason: '', days: 7 })
const rules = {
  studentId: [{ required: true, message: '请输入学号', trigger: 'blur' }],
  reason: [{ required: true, message: '请输入封禁原因', trigger: 'blur' }],
  days: [{ required: true, message: '请输入封禁天数', trigger: 'blur' }]
}

async function loadData() {
  loading.value = true
  try {
    const res = await getBlacklist({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

function handleManualBan() {
  Object.assign(banForm, { studentId: '', reason: '', days: 7 })
  banDialogVisible.value = true
}

async function confirmBan() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    await toggleBan({ studentId: banForm.studentId, action: 'ban', reason: banForm.reason, days: banForm.days })
    ElMessage.success('封禁成功')
    banDialogVisible.value = false
    loadData()
  } catch (e) {
    // handled
  } finally {
    submitLoading.value = false
  }
}

async function handleUnban(row) {
  try {
    await ElMessageBox.confirm(`确认为 ${row.userName} 解封？`, '提示', { type: 'success' })
    await toggleBan({ studentId: row.studentId, action: 'unban' })
    ElMessage.success('解封成功')
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

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
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
