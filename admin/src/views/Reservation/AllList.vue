<template>
  <div class="page-container">
    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索姓名/学号"
      export-file-name="导出_预约列表"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.roomId" placeholder="功能房" clearable filterable style="width: 150px" @change="onSearch">
        <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
      <el-date-picker
        v-model="filters.dateRange"
        type="daterange"
        range-separator="至"
        start-placeholder="开始"
        end-placeholder="结束"
        value-format="YYYY-MM-DD"
        style="width: 240px"
        @change="onSearch"
      />
    </ListToolbar>

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" class="stale-alert" />

    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !tableData.length"
        empty-description="暂无符合条件的预约"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table :data="tableData" stripe>
          <el-table-column prop="userName" label="预约人" width="100" />
          <el-table-column prop="studentId" label="学号" width="130" />
          <el-table-column prop="roomName" label="功能房" width="130" />
          <el-table-column prop="date" label="预约日期" width="110" />
          <el-table-column prop="timeSlot" label="时间段" width="150" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag :type="reservationStatusType(row.status)" size="small">{{ reservationStatusLabel(row.status) }}</el-tag>
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

        <div v-if="tableData.length" class="pagination-wrap">
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
      </AsyncState>
    </el-card>

    <el-dialog v-model="detailDialogVisible" title="预约详情" width="600px">
      <el-descriptions :column="2" border v-if="currentRow">
        <el-descriptions-item label="预约人">{{ currentRow.userName }}</el-descriptions-item>
        <el-descriptions-item label="学号">{{ currentRow.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ currentRow.roomName }}</el-descriptions-item>
        <el-descriptions-item label="预约日期">{{ currentRow.date }}</el-descriptions-item>
        <el-descriptions-item label="时间段">{{ currentRow.timeSlot }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="reservationStatusType(currentRow.status)" size="small">{{ reservationStatusLabel(currentRow.status) }}</el-tag>
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
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { getAll } from '@/api/reservation'
import { getList as getRoomList } from '@/api/room'
import { ElMessage } from 'element-plus'
import { createLatestRequestCoordinator } from '@/utils/latestRequest'
import { reservationStatusLabel, reservationStatusType } from '@/utils/reservationStatus'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'
import AsyncState from '@/components/admin/AsyncState.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'

// 9 项预约状态（与 @/utils/reservationStatus 保持一致）
const statusOptions = [
  { label: '待审核', value: 'pending' },
  { label: '辅导员审核', value: 'counselor_pending' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' },
  { label: '使用中', value: 'checked_in' },
  { label: '已完成', value: 'completed' },
  { label: '已爽约', value: 'noshow' },
  { label: '已取消', value: 'cancelled' }
]

// 导出列（状态用 reservationStatusLabel 映射，与列表展示一致；R-14：仅用页面已展示字段）
const exportColumns = [
  { header: '预约人', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '功能房', key: 'roomName' },
  { header: '预约日期', key: 'date' },
  { header: '时间段', key: 'timeSlot' },
  { header: '状态', key: 'status', formatter: row => reservationStatusLabel(row.status) },
  { header: '用途', key: 'purpose' },
  { header: '创建时间', key: 'createdAt' }
]

const loading = ref(false)
const loadError = ref('')
const tableData = ref([])
const roomOptions = ref([])
const detailDialogVisible = ref(false)
const currentRow = ref(null)

const filters = reactive({ status: '', roomId: '', keyword: '', dateRange: null })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

const listRequest = createLatestRequestCoordinator({
  load: params => getAll(params, { silentError: true }),
  onStart: () => { loading.value = true; loadError.value = '' },
  onSuccess: res => {
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  },
  onError: () => {
    loadError.value = tableData.value.length
      ? '预约列表加载失败，已保留上次结果，请重试'
      : '预约列表加载失败，请重试'
  },
  onFinish: () => { loading.value = false }
})

// 列表查询参数单一来源：列表加载与导出均复用，保证导出结果与当前筛选视图一致。
function buildParams() {
  return {
    status: filters.status,
    roomId: filters.roomId,
    keyword: filters.keyword,
    startDate: filters.dateRange?.[0] || '',
    endDate: filters.dateRange?.[1] || ''
  }
}

async function loadData() {
  return listRequest.run({
    ...buildParams(),
    page: pagination.page,
    pageSize: pagination.pageSize
  })
}

// 状态/关键词/功能房/日期变更后回到第 1 页再查询（服务端筛选）
function onSearch() {
  pagination.page = 1
  loadData()
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

// R-14：导出仅使用「服务端已脱敏 + 屏幕已展示」的字段。
// 导出「筛选后全量」：后端 paginationRules 限制 pageSize<=100，故按页循环拉取，不能一次性要 10000。
async function handleExport() {
  try {
    const list = await fetchAllPages(getAll, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      options: { silentError: true }
    })
    if (!exportXlsx(exportColumns, list, '导出_预约列表')) return
    ElMessage.success(`导出成功，共 ${list.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

onMounted(() => {
  loadData()
  loadRooms()
})
onBeforeUnmount(() => { listRequest.invalidate() })
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
