<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="操作人">
          <el-input v-model="filters.operator" placeholder="操作人" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item label="操作类型">
          <el-select v-model="filters.action" placeholder="全部" clearable style="width: 140px">
            <el-option label="登录" value="login" />
            <el-option label="创建" value="create" />
            <el-option label="更新" value="update" />
            <el-option label="删除" value="delete" />
            <el-option label="审核" value="audit" />
            <el-option label="导出" value="export" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期范围">
          <el-date-picker v-model="filters.dateRange" type="daterange" range-separator="至" start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" style="width: 240px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-alert v-if="loadError" :title="loadError" type="error" show-icon :closable="false"><template #default><el-button link type="primary" @click="loadData">重试</el-button></template></el-alert>

    <el-card shadow="never">
      <el-empty v-if="!loading && !loadError && !tableData.length" description="暂无操作记录" />
      <el-table v-else-if="tableData.length || loading" :data="tableData" v-loading="loading" stripe>
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
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadData"
          @current-change="loadData"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount } from 'vue'
import { getLogs } from '@/api/admin'
import { createLatestRequestCoordinator } from '@/utils/latestRequest'

const loading = ref(false)
const loadError = ref('')
const tableData = ref([])

const actionTypeMap = { login: '', create: 'success', update: 'warning', delete: 'danger', audit: '', export: 'success', other: 'info' }

const filters = reactive({ operator: '', action: '', dateRange: null })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

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

async function loadData() {
  return logsRequest.run({
    operator: filters.operator,
    category: filters.action,
    startDate: filters.dateRange?.[0] || '',
    endDate: filters.dateRange?.[1] || '',
    page: pagination.page,
    pageSize: pagination.pageSize
  })
}

function resetFilters() {
  Object.assign(filters, { operator: '', action: '', dateRange: null })
  pagination.page = 1
  loadData()
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

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
