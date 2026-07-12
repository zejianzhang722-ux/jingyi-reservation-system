<template>
  <PageShell
    title="导出报表"
    eyebrow="报表导出"
    description="按报表类型、时间范围、功能房和字段导出运营数据；本页历史记录仅保留当前浏览器会话内的导出结果。"
  >
    <template #actions>
      <el-button type="primary" :loading="exporting" :disabled="exporting" @click="handleExport">
        <el-icon><Download /></el-icon>导出报表
      </el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="报表类型" :value="typeLabels[form.type]" caption="当前选择" icon="Document" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="导出字段" :value="form.columns.length" caption="已选择字段数量" icon="Tickets" tone="success" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="会话记录" :value="exportHistory.length" caption="本次打开页面后的导出" icon="Clock" tone="warning" />
      </el-col>
    </el-row>

    <el-alert class="export-status" :title="exportResult || `当前范围：${currentRangeLabel}`" :type="exportResult ? 'success' : 'info'" :closable="false" show-icon />

    <el-card shadow="never">
      <template #header><span class="card-title">导出配置</span></template>
      <el-form :model="form" label-width="120px" class="export-form">
        <el-form-item label="报表类型">
          <el-select v-model="form.type" placeholder="请选择报表类型" style="width: 320px">
            <el-option label="预约记录报表" value="reservations" />
            <el-option label="使用率统计报表" value="usage" />
            <el-option label="爽约统计报表" value="noshow" />
            <el-option label="用户活跃度报表" value="users" />
            <el-option label="违规记录报表" value="violations" />
            <el-option label="签到记录报表" value="checkin" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker v-model="form.dateRange" type="daterange" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" value-format="YYYY-MM-DD" style="width: 320px" />
        </el-form-item>
        <el-form-item label="功能房">
          <el-select v-model="form.roomIds" placeholder="全部功能房" clearable multiple collapse-tags style="width: 320px">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="导出数据列">
          <el-checkbox-group v-model="form.columns" class="column-grid">
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
      </el-form>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div class="history-header">
          <span class="card-title">历史导出记录</span>
          <el-tag size="small" type="info">会话临时记录</el-tag>
        </div>
      </template>
      <el-table :data="exportHistory" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="type" label="报表类型" width="150">
          <template #default="{ row }">{{ typeLabels[row.type] || row.type }}</template>
        </el-table-column>
        <el-table-column prop="dateRange" label="时间范围" width="220" />
        <el-table-column prop="format" label="格式" width="90" />
        <el-table-column prop="createdAt" label="导出时间" width="180" />
        <el-table-column prop="fileSize" label="文件大小" width="110" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleDownload(row)">重新导出</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!exportHistory.length" description="本次会话暂无导出记录" :image-size="90" />
    </el-card>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { exportData } from '@/api/stats'
import { getList as getRoomList } from '@/api/room'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

const exporting = ref(false)
const roomOptions = ref([])
const exportHistory = ref([])
const exportResult = ref('')

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
  roomIds: [],
  columns: ['id', 'userName', 'studentId', 'roomName', 'date', 'timeSlot', 'status', 'purpose', 'createdAt'],
  format: 'xlsx'
})
const currentRangeLabel = computed(() => form.dateRange?.length ? `${form.dateRange[0]} 至 ${form.dateRange[1]}` : '尚未选择')

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    roomOptions.value = []
  }
}

async function handleExport() {
  if (exporting.value) return
  if (!form.dateRange || !form.dateRange.length) {
    ElMessage.warning('请选择时间范围')
    return
  }
  if (!form.columns.length) {
    ElMessage.warning('请至少选择一个导出字段')
    return
  }

  exporting.value = true
  let objectUrl = ''
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
    const fileName = `${typeLabels[form.type]}_${form.dateRange[0]}_${form.dateRange[1]}.${form.format}`
    objectUrl = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = fileName
    a.click()
    ElMessage.success('导出成功')
    exportResult.value = `已完成：${fileName}（${(blob.size / 1024).toFixed(1)} KB）`

    exportHistory.value.unshift({
      id: exportHistory.value.length + 1,
      type: form.type,
      dateRange: `${form.dateRange[0]} ~ ${form.dateRange[1]}`,
      format: form.format,
      createdAt: new Date().toLocaleString(),
      fileSize: `${(blob.size / 1024).toFixed(1)} KB`,
      fileName
    })
  } catch (e) {
    exportResult.value = '导出失败，请稍后重试'
    ElMessage.error('导出失败')
  } finally {
    if (objectUrl) window.URL.revokeObjectURL(objectUrl)
    exporting.value = false
  }
}

function handleDownload() {
  handleExport()
}

onMounted(() => {
  loadRooms()
})
</script>

<style scoped>
.card-title {
  font-weight: 700;
  color: var(--jy-text-primary, #1A1A2E);
}

.export-status { margin-bottom: 16px; }

.export-form {
  max-width: 720px;
}

.column-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr));
  gap: 4px 12px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>

