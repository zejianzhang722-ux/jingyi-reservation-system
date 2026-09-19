<template>
  <div class="page-container">
    <ListToolbar
      v-model:status="filters.status"
      v-model:keyword="filters.keyword"
      :status-options="statusOptions"
      status-placeholder="状态"
      keyword-placeholder="搜索学号/姓名"
      export-file-name="导出_阅览登记记录"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-date-picker
        v-model="filters.date"
        type="date"
        placeholder="选择日期"
        value-format="YYYY-MM-DD"
        style="width: 160px"
        @change="onSearch"
      />
    </ListToolbar>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">阅览室登记记录</span>
        <el-button type="success" @click="loadCurrent">查看当前在阅</el-button>
      </div>

      <el-table :data="filteredTableData" v-loading="loading" stripe>
        <el-table-column prop="userName" label="姓名" width="100" />
        <el-table-column prop="studentId" label="学号" width="130" />
        <el-table-column prop="enterTime" label="进入时间" width="170" />
        <el-table-column prop="leaveTime" label="离开时间" width="170" />
        <el-table-column prop="duration" label="停留时长" width="100" />
        <el-table-column prop="seatNumber" label="座位号" width="80" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'reading' ? 'success' : 'info'" size="small">
              {{ row.status === 'reading' ? '在阅' : '已离开' }}
            </el-tag>
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
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getCurrent, getHistory } from '@/api/readingRoom'
import { ElMessage } from 'element-plus'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const loading = ref(false)
const tableData = ref([])
const isCurrent = ref(false)

// 🔧 后端 GET /reading-room/history 只认 page / pageSize，不支持 date 与任何关键词，
// 状态下拉也需前端兜底；导出沿用同一套前端规则，保证「导出结果 == 当前筛选视图」。
const statusOptions = [
  { label: '在阅', value: 'reading' },
  { label: '已离开', value: 'left' }
]

// 导出列：与表格展示字段一致；用页面上已有的「在阅/已离开」映射做 formatter，
// R-14 不拼接 PII、不调用任何解掩码接口。
const exportColumns = [
  { header: '姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '进入时间', key: 'enterTime' },
  { header: '离开时间', key: 'leaveTime' },
  { header: '停留时长', key: 'duration' },
  { header: '座位号', key: 'seatNumber' },
  { header: '状态', key: 'status', formatter: row => (row.status === 'reading' ? '在阅' : '已离开') }
]

const filters = reactive({ date: '', status: '', keyword: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

function matchFilters(row) {
  // 状态：reading -> 在阅；其余（含已离开）-> left
  if (filters.status) {
    const rowStatus = row.status === 'reading' ? 'reading' : 'left'
    if (rowStatus !== filters.status) return false
  }
  if (filters.date && !String(row.enterTime || '').startsWith(filters.date)) return false
  const keyword = String(filters.keyword || '').trim().toLowerCase()
  if (keyword) {
    const hit = String(row.studentId || '').toLowerCase().includes(keyword) ||
      String(row.userName || '').toLowerCase().includes(keyword)
    if (!hit) return false
  }
  return true
}

const filteredTableData = computed(() => tableData.value.filter(row => matchFilters(row)))

async function loadData() {
  isCurrent.value = false
  loading.value = true
  try {
    const res = await getHistory({ page: pagination.page, pageSize: pagination.pageSize }, { silentError: true })
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

async function loadCurrent() {
  isCurrent.value = true
  loading.value = true
  try {
    const res = await getCurrent({ page: pagination.page, pageSize: pagination.pageSize })
    const payload = res.data
    tableData.value = Array.isArray(payload?.list) ? payload.list : (Array.isArray(payload) ? payload : [])
    pagination.total = res.data?.total || tableData.value.length
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  filters.date = ''
  filters.status = ''
  filters.keyword = ''
  pagination.page = 1
  loadData()
}

// 「当前在阅」接口不分页（一次性返回全部），直接导出当前已加载 + 已筛选的行；
// 历史记录是分页接口，必须按页循环拉取全量后再套同一套前端过滤规则。
async function handleExport() {
  try {
    let rows = []
    if (isCurrent.value) {
      rows = filteredTableData.value
    } else {
      const list = await fetchAllPages(getHistory, {}, {
        pageSize: 100,
        maxPages: 50,
        options: { silentError: true }
      })
      rows = list.filter(row => matchFilters(row))
    }
    if (!exportXlsx(exportColumns, rows, '导出_阅览登记记录')) return
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
