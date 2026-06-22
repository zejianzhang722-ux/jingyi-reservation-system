<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 120px">
            <el-option label="待审核" value="pending" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
            <el-option label="使用中" value="using" />
            <el-option label="已完成" value="completed" />
            <el-option label="已爽约" value="noshow" />
            <el-option label="已取消" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item label="功能房">
          <el-select v-model="filters.roomId" placeholder="全部" clearable style="width: 150px">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="预约人">
          <el-input v-model="filters.keyword" placeholder="姓名/学号" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width: 240px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
          <el-button type="success" @click="handleExport">导出Excel</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="userName" label="预约人" width="100" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="roomName" label="功能房" width="130" />
        <el-table-column prop="date" label="预约日期" width="110" />
        <el-table-column prop="timeSlot" label="时间段" width="150" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type" size="small">{{ statusMap[row.status]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="purpose" label="用途" min-width="140" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="创建时间" width="170" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleDetail(row)">详情</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="pagination.page"
          v-model:page-size="pagination.pageSize"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>

    <el-dialog v-model="detailDialogVisible" title="预约详情" width="600px">
      <el-descriptions :column="2" border v-if="currentRow">
        <el-descriptions-item label="预约人">{{ currentRow.userName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentRow.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.timeSlot }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="statusMap[currentRow.status]?.type" size="small">{{ statusMap[currentRow.status]?.label }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="用途" :span="2">{{ currentRow.purpose }}</el-descriptions-item>
        <el-descriptions-item label="创建时间" :span="2">{{ currentRow.createdAt }}</el-descriptions-item>
        <el-descriptions-item label="审核人" v-if="currentRow.auditor">{{ currentRow.auditor }}</el-descriptions-item>
        <el-descriptions-item label="审核时间" v-if="currentRow.auditedAt">{{ currentRow.auditedAt }}</el-descriptions-item>
        <el-descriptions-item label="驳回原因" v-if="currentRow.rejectReason" :span="2">{{ currentRow.rejectReason }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getAll } from '@/api/reservation'
import { getList as getRoomList } from '@/api/room'
import { ElMessage } from 'element-plus'

const loading = ref(false)
const tableData = ref([])
const roomOptions = ref([])
const detailDialogVisible = ref(false)
const currentRow = ref(null)

const statusMap = {
  pending: { label: '待审核', type: 'warning' },
  approved: { label: '已通过', type: 'success' },
  rejected: { label: '已驳回', type: 'danger' },
  using: { label: '使用中', type: '' },
  completed: { label: '已完成', type: 'info' },
  noshow: { label: '已爽约', type: 'danger' },
  cancelled: { label: '已取消', type: 'info' }
}

const filters = reactive({ status: '', roomId: '', keyword: '', dateRange: null })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

async function loadData() {
  loading.value = true
  try {
    const params = {
      status: filters.status,
      roomId: filters.roomId,
      keyword: filters.keyword,
      startDate: filters.dateRange?.[0] || '',
      endDate: filters.dateRange?.[1] || '',
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    const res = await getAll(params)
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

function resetFilters() {
  Object.assign(filters, { status: '', roomId: '', keyword: '', dateRange: null })
  pagination.page = 1
  loadData()
}

function handleDetail(row) {
  currentRow.value = row
  detailDialogVisible.value = true
}

async function handleExport() {
  try {
    const params = {
      status: filters.status,
      roomId: filters.roomId,
      keyword: filters.keyword,
      startDate: filters.dateRange?.[0] || '',
      endDate: filters.dateRange?.[1] || '',
      pageSize: 10000,
      page: 1
    }
    const res = await getAll(params)
    const list = res.data?.list || []
    if (list.length === 0) {
      ElMessage.warning('暂无数据可导出')
      return
    }
    const XLSX = await import('xlsx')
    const statusLabels = { pending: '待审核', approved: '已通过', rejected: '已驳回', using: '使用中', completed: '已完成', noshow: '已爽约', cancelled: '已取消' }
    const exportData = list.map(row => ({
      '预约ID': row.id,
      '预约人': row.userName,
      '学号': row.studentId,
      '功能房': row.roomName,
      '预约日期': row.date,
      '时间段': row.timeSlot,
      '状态': statusLabels[row.status] || row.status,
      '用途': row.purpose || '',
      '创建时间': row.createdAt
    }))
    const ws = XLSX.utils.json_to_sheet(exportData)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '预约记录')
    XLSX.writeFile(wb, `预约记录_${new Date().toISOString().slice(0, 10)}.xlsx`)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

onMounted(() => {
  loadData()
  loadRooms()
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

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
