<template>
  <div class="page-container">
    <!-- 操作日志无独立 status 字段：类目筛选沿用 category（「操作类型」），因此不额外渲染状态下拉 -->
    <ListToolbar
      v-model:keyword="filters.operator"
      keyword-placeholder="搜索操作人"
      export-file-name="导出_操作日志"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    >
      <el-select v-model="filters.action" placeholder="操作类型" clearable style="width: 140px" @change="onSearch">
        <el-option label="登录" value="login" />
        <el-option label="创建" value="create" />
        <el-option label="更新" value="update" />
        <el-option label="删除" value="delete" />
        <el-option label="审核" value="audit" />
        <el-option label="业务处理" value="operate" />
        <el-option label="导出" value="export" />
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

    <el-alert v-if="loadError && tableData.length" :title="loadError" type="warning" show-icon :closable="false" />

    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !tableData.length"
        :empty="!loading && !loadError && !tableData.length"
        empty-description="暂无操作记录"
        @retry="loadData"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table :data="tableData" stripe>
          <el-table-column prop="operatorName" label="操作人" width="100" />
          <el-table-column prop="actionLabel" label="具体操作" min-width="150">
            <template #default="{ row }">
              <el-tag :type="actionTypeMap[row.actionCategory] || 'info'" size="small">{{ row.actionLabel || '操作待确认' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="moduleLabel" label="业务范围" width="130" />
          <el-table-column prop="targetDescription" label="操作对象" min-width="180" show-overflow-tooltip />
          <el-table-column prop="detail" label="操作详情" min-width="200" show-overflow-tooltip />
          <el-table-column label="来源记录" width="100"><template #default="{ row }">{{ row.sourceRecorded ? '已记录' : '未记录' }}</template></el-table-column>
          <el-table-column prop="createdAt" label="操作时间" width="170" />
        </el-table>

        <div v-if="tableData.length" class="pagination-wrap">
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
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { getLogs } from '@/api/admin'
import { ElMessage } from 'element-plus'
import { createLatestRequestCoordinator } from '@/utils/latestRequest'
import AsyncState from '@/components/admin/AsyncState.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const loading = ref(false)
const loadError = ref('')
const tableData = ref([])

const actionTypeMap = { login: '', create: 'success', update: 'warning', operate: 'warning', delete: 'danger', audit: '', export: 'success', other: 'info' }

const filters = reactive({ operator: '', action: '', dateRange: null })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

// 操作日志为内部低敏记录（不含学生 PII），导出列与表格展示字段完全一致。
const exportColumns = [
  { header: '操作人', key: 'operatorName' },
  { header: '具体操作', formatter: row => row.actionLabel || '操作待确认', width: 20 },
  { header: '业务范围', key: 'moduleLabel' },
  { header: '操作对象', key: 'targetDescription', width: 30 },
  { header: '操作详情', key: 'detail', width: 36 },
  { header: '来源记录', formatter: row => (row.sourceRecorded ? '已记录' : '未记录') },
  { header: '操作时间', key: 'createdAt', width: 20 }
]

const logsRequest = createLatestRequestCoordinator({
  load: params => getLogs(params, { silentError: true }),
  onStart: () => { loading.value = true; loadError.value = '' },
  onSuccess: res => {
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  },
  onError: () => {
    loadError.value = tableData.value.length
      ? '操作记录加载失败，已保留上次结果，请重试'
      : '操作记录加载失败，请重试'
  },
  onFinish: () => { loading.value = false }
})

/**
 * 列表查询参数单一来源：列表加载与导出共用，保证「导出结果 == 当前筛选视图」。
 * 后端 /admin/operation-logs 支持 operator + category + startDate/endDate（见 adminController.operationLogs）。
 * @returns {{operator: string, category: string, startDate: string, endDate: string}}
 */
function buildParams() {
  return {
    operator: filters.operator || '',
    category: filters.action || '',
    startDate: filters.dateRange?.[0] || '',
    endDate: filters.dateRange?.[1] || ''
  }
}

async function loadData() {
  return logsRequest.run({
    ...buildParams(),
    page: pagination.page,
    pageSize: pagination.pageSize
  })
}

// 操作人/类目/日期变更后回到第 1 页再查询（服务端筛选）
function onSearch() {
  pagination.page = 1
  loadData()
}

function resetFilters() {
  Object.assign(filters, { operator: '', action: '', dateRange: null })
  pagination.page = 1
  loadData()
}

/**
 * 导出当前筛选条件下的全量操作日志。
 * 后端 adminController.operationLogs 内二次 Math.min(100, pageSize) 钳制，
 * 故必须按页循环拉取，不能一次性请求超大 pageSize（会被打回 400「每页数量无效」）。
 */
async function handleExport() {
  try {
    const list = await fetchAllPages(getLogs, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      options: { silentError: true }
    })
    if (!exportXlsx(exportColumns, list, '导出_操作日志')) return
    ElMessage.success(`导出成功，共 ${list.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

onMounted(() => {
  loadData()
})
onBeforeUnmount(() => { logsRequest.invalidate() })
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
