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
        <MetricCard label="当前名单" :value="pagination.total" caption="受限、封禁或低信用宿生" icon="CircleCloseFilled" tone="danger" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="处理方式" value="人工 + 自动" caption="支持学号封禁和列表解封" icon="Operation" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="审计要求" value="必须填原因" caption="封禁原因会随请求提交" icon="DocumentChecked" tone="primary" />
      </el-col>
    </el-row>

    <FilterBar @search="loadData" @reset="resetFilters">
      <el-input v-model="filters.keyword" placeholder="搜索学号/姓名" clearable style="width: 220px" @keyup.enter="loadData" />
    </FilterBar>

    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="userName" label="学生姓名" width="120" />
        <el-table-column prop="studentId" label="学号" width="140" />
        <el-table-column prop="creditScore" label="信用分" width="100">
          <template #default="{ row }">
            <span :class="['credit-score', { danger: Number(row.creditScore) < 60 }]">{{ row.creditScore ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">{{ statusMap[row.status]?.label || row.status || '低信用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="进入原因" min-width="180" show-overflow-tooltip />
        <el-table-column prop="bannedAt" label="处理时间" width="170" show-overflow-tooltip />
        <el-table-column prop="banExpiresAt" label="预计恢复" width="170" show-overflow-tooltip />
        <el-table-column prop="violationCount" label="违规次数" width="100" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button type="success" size="small" link @click="handleUnban(row)">恢复正常</el-button>
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

    <el-dialog v-model="banDialogVisible" title="手动封禁宿生" width="500px">
      <el-alert title="请输入宿生学号，系统会通过接口定位对应用户；封禁原因将用于审计追踪。" type="warning" show-icon :closable="false" class="form-alert" />
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
  </PageShell>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getBlacklist, toggleBan } from '@/api/credit'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

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

const statusMap = {
  banned: { label: '封禁', type: 'danger' },
  restricted: { label: '受限', type: 'warning' },
  active: { label: '低信用', type: 'info' }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getBlacklist({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    tableData.value = []
    pagination.total = 0
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
    // handled by interceptor
  } finally {
    submitLoading.value = false
  }
}

async function handleUnban(row) {
  try {
    await ElMessageBox.confirm(`确认恢复 ${row.userName || row.studentId} 的账号状态？`, '提示', { type: 'success' })
    await toggleBan({ userId: row.userId || row.id, studentId: row.studentId, action: 'unban' })
    ElMessage.success('已恢复正常')
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

