<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="日期">
          <el-date-picker v-model="filters.date" type="date" placeholder="选择日期" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="学号">
          <el-input v-model="filters.studentId" placeholder="输入学号" clearable style="width: 140px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">阅览室登记记录</span>
        <el-button type="success" @click="loadCurrent">查看当前在阅</el-button>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
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
import { ref, reactive, onMounted } from 'vue'
import { getCurrent, getHistory } from '@/api/readingRoom'

const loading = ref(false)
const tableData = ref([])
const isCurrent = ref(false)

const filters = reactive({ date: '', studentId: '' })
const pagination = reactive({ page: 1, pageSize: 20, total: 0 })

async function loadData() {
  isCurrent.value = false
  loading.value = true
  try {
    const res = await getHistory({ ...filters, page: pagination.page, pageSize: pagination.pageSize })
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
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.date = ''
  filters.studentId = ''
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
