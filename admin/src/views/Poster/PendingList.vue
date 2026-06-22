<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="待审核" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">海报审核列表</span>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
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
import { ref, reactive, onMounted } from 'vue'
import { getPending, approve, reject, markClean, markViolation } from '@/api/poster'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const tableData = ref([])
const rejectDialogVisible = ref(false)

const statusMap = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' }
}

const filters = reactive({ status: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const rejectForm = reactive({ reason: '', id: null })

async function loadData() {
  loading.value = true
  try {
    const res = await getPending({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.status = ''
  pagination.page = 1
  loadData()
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
