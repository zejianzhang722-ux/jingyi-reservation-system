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

    <el-card shadow="never">
      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="operatorName" label="操作人" width="100" />
        <el-table-column prop="action" label="操作类型" width="90">
          <template #default="{ row }">
            <el-tag :type="actionMap[row.action]?.type || 'info'" size="small">{{ actionMap[row.action]?.label || row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="100" />
        <el-table-column prop="target" label="操作对象" min-width="180" show-overflow-tooltip />
        <el-table-column prop="detail" label="操作详情" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ip" label="IP地址" width="130" />
        <el-table-column prop="createdAt" label="操作时间" width="170" />
      </el-table>

      <div class="pagination-wrap">
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
import { ref, reactive, onMounted } from 'vue'
import { getLogs } from '@/api/admin'

const loading = ref(false)
const tableData = ref([])

const actionMap = {
  login: { label: '登录', type: '' },
  create: { label: '创建', type: 'success' },
  update: { label: '更新', type: 'warning' },
  delete: { label: '删除', type: 'danger' },
  audit: { label: '审核', type: '' },
  export: { label: '导出', type: 'success' }
}

const filters = reactive({ operator: '', action: '', dateRange: null })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

async function loadData() {
  loading.value = true
  try {
    const params = {
      operator: filters.operator,
      action: filters.action,
      startDate: filters.dateRange?.[0] || '',
      endDate: filters.dateRange?.[1] || '',
      page: pagination.page,
      pageSize: pagination.pageSize
    }
    const res = await getLogs(params)
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { operator: '', action: '', dateRange: null })
  pagination.page = 1
  loadData()
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

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
