<template>
  <div class="page-container">
    <el-card shadow="never">
      <template #header><span class="card-title">报表导出</span></template>

      <el-form :model="form" label-width="120px" class="export-form">
        <el-form-item label="报表类型">
          <el-select v-model="form.type" placeholder="请选择报表类型" style="width: 300px">
            <el-option label="预约记录报表" value="reservations" />
            <el-option label="使用率统计报表" value="usage" />
            <el-option label="爽约统计报表" value="noshow" />
            <el-option label="用户活跃度报表" value="users" />
            <el-option label="违规记录报表" value="violations" />
            <el-option label="签到记录报表" value="checkin" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker v-model="form.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 300px" />
        </el-form-item>
        <el-form-item label="功能房">
          <el-select v-model="form.roomIds" placeholder="全部功能房" clearable multiple collapse-tags style="width: 300px">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="导出数据列">
          <el-checkbox-group v-model="form.columns">
            <el-checkbox label="id" value="id">预约ID</el-checkbox>
            <el-checkbox label="userName" value="userName">预约人</el-checkbox>
            <el-checkbox label="studentId" value="studentId">学号</el-checkbox>
            <el-checkbox label="roomName" value="roomName">功能房</el-checkbox>
            <el-checkbox label="date" value="date">日期</el-checkbox>
            <el-checkbox label="timeSlot" value="timeSlot">时间段</el-checkbox>
            <el-checkbox label="status" value="status">状态</el-checkbox>
            <el-checkbox label="purpose" value="purpose">用途</el-checkbox>
            <el-checkbox label="createdAt" value="createdAt">创建时间</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="导出格式">
          <el-radio-group v-model="form.format">
            <el-radio value="xlsx">Excel (.xlsx)</el-radio>
            <el-radio value="csv">CSV (.csv)</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="exporting" @click="handleExport">
            <el-icon><Download /></el-icon>导出报表
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="margin-top: 16px">
      <template #header><span class="card-title">历史导出记录</span></template>
      <el-table :data="exportHistory" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="type" label="报表类型" width="150">
          <template #default="{ row }">
            {{ typeLabels[row.type] || row.type }}
          </template>
        </el-table-column>
        <el-table-column prop="dateRange" label="时间范围" width="220" />
        <el-table-column prop="format" label="格式" width="80" />
        <el-table-column prop="createdAt" label="导出时间" width="170" />
        <el-table-column prop="operatorName" label="操作人" width="100" />
        <el-table-column prop="fileSize" label="文件大小" width="100" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleDownload(row)">下载</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { exportData } from '@/api/stats'
import { getList as getRoomList } from '@/api/room'
import { ElMessage } from 'element-plus'

const exporting = ref(false)
const roomOptions = ref([])
const exportHistory = ref([])

const typeLabels = {
  reservations: '预约记录报表',
  usage: '使用率统计报表',
  noshow: '爽约统计报表',
  users: '用户活跃度报表',
  violations: '违规记录报表',
  checkin: '签到记录报表'
}

const form = reactive({
  type: 'reservations',
  dateRange: null,
  roomId: '',
  roomIds: [],
  columns: ['id', 'userName', 'studentId', 'roomName', 'date', 'timeSlot', 'status', 'purpose', 'createdAt'],
  format: 'xlsx'
})

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function handleExport() {
  if (!form.dateRange || !form.dateRange.length) {
    ElMessage.warning('请选择时间范围')
    return
  }

  exporting.value = true
  try {
    const params = {
      type: form.type,
      startDate: form.dateRange[0],
      endDate: form.dateRange[1],
      roomId: form.roomIds.length > 0 ? form.roomIds.join(',') : '',
      columns: form.columns.join(','),
      format: form.format
    }
    const res = await exportData(params)
    const blob = new Blob([res], {
      type: form.format === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv'
    })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${typeLabels[form.type]}_${form.dateRange[0]}_${form.dateRange[1]}.${form.format}`
    a.click()
    window.URL.revokeObjectURL(url)
    ElMessage.success('导出成功')

    exportHistory.value.unshift({
      id: exportHistory.value.length + 1,
      type: form.type,
      dateRange: `${form.dateRange[0]} ~ ${form.dateRange[1]}`,
      format: form.format,
      createdAt: new Date().toLocaleString(),
      operatorName: '当前管理员',
      fileSize: `${(blob.size / 1024).toFixed(1)} KB`
    })
  } catch (e) {
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

function handleDownload(row) {
  ElMessage.info('请重新导出以获取文件')
}

onMounted(() => {
  loadRooms()
})
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.export-form {
  max-width: 600px;
}
</style>
