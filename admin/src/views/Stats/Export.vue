<template>
  <PageShell
    title="导出报表"
    eyebrow="报表导出"
    description="按报表类型、时间范围、功能房和所需内容导出运营数据；关闭页面后，本页记录将不再保留。"
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
        <MetricCard label="导出内容" :value="form.columns.length" caption="已选项目数量" icon="Tickets" tone="success" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="本页记录" :value="exportHistory.length" caption="本次打开页面后的导出" icon="Clock" tone="warning" />
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
        <el-form-item label="选择导出内容">
          <el-checkbox-group v-model="form.columns" class="column-grid">
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
          <el-tag size="small" type="info">关闭页面后不保留</el-tag>
        </div>
      </template>
      <el-table :data="exportHistory" stripe>
        <el-table-column prop="type" label="报表类型" width="150">
          <template #default="{ row }">{{ typeLabels[row.type] || '其他报表' }}</template>
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
      <el-empty v-if="!exportHistory.length" description="本页暂无导出记录" :image-size="90" />
    </el-card>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { exportData } from '@/api/stats'
import { getList as getRoomList } from '@/api/room'
import { ElMessage } from 'element-plus'
import dayjs from 'dayjs'
import { exportXlsx } from '@/utils/exportXlsx'
import { reservationStatusLabel } from '@/utils/reservationStatus'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

// 后端 /stats/export（scopedStatsController.exportData）返回结构化 JSON：
// { type, startDate, endDate, rows }，且字段是蛇形命名（real_name / student_id ...），
// 与前端勾选的 camelCase 列名、以及中文表头都不一致，因此这里做一层映射。
function fmtTime(value) {
  if (!value) return ''
  const text = String(value)
  return text.length >= 5 ? text.slice(0, 5) : text
}

function fmtDateTime(value) {
  if (!value) return ''
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : String(value)
}

// 预约类报表（reservations / usage / noshow / checkin 均走后端同一查询分支）
const RESERVATION_FIELDS = {
  userName: { header: '预约人', key: 'real_name' },
  studentId: { header: '学号', key: 'student_id' },
  roomName: { header: '功能房', key: 'room_name' },
  date: { header: '日期', key: 'date' },
  timeSlot: { header: '时间段', formatter: row => `${fmtTime(row.start_time)} - ${fmtTime(row.end_time)}` },
  status: { header: '状态', formatter: row => reservationStatusLabel(row.status) },
  purpose: { header: '用途', key: 'purpose' },
  createdAt: { header: '创建时间', formatter: row => fmtDateTime(row.created_at) }
}

// 用户类报表（type=users）：后端返回 users 表字段，与「导出内容」勾选项无关。
const USER_FIELDS = [
  { header: '用户ID', key: 'id' },
  { header: '姓名', key: 'real_name' },
  { header: '学号', key: 'student_id' },
  { header: '楼栋ID', key: 'building_id' },
  { header: '学院', key: 'college' },
  { header: '信用分', key: 'credit_score' },
  { header: '状态', key: 'status' },
  { header: '创建时间', formatter: row => fmtDateTime(row.created_at) }
]

// 违规类报表（type=violations）
const VIOLATION_FIELDS = [
  { header: '记录ID', key: 'id' },
  { header: '学号', key: 'student_id' },
  { header: '姓名', key: 'real_name' },
  { header: '楼栋ID', key: 'building_id' },
  { header: '违规类型', key: 'type' },
  { header: '描述', key: 'description' },
  { header: '扣分', key: 'score' },
  { header: '记录时间', formatter: row => fmtDateTime(row.created_at) }
]

function buildColumns(type, selected) {
  if (type === 'users') return USER_FIELDS
  if (type === 'violations') return VIOLATION_FIELDS
  const cols = (selected || []).map(key => RESERVATION_FIELDS[key]).filter(Boolean)
  return cols.length ? cols : Object.values(RESERVATION_FIELDS)
}

// CSV 生成：带 BOM 保证 Excel 打开中文不乱码；含分隔符/引号/换行的单元格做转义。
function toCsv(columns, rows) {
  const escape = value => {
    const text = value === null || value === undefined ? '' : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const header = columns.map(c => escape(c.header)).join(',')
  const body = rows.map(row =>
    columns.map(c => escape(c.formatter ? c.formatter(row) : (row?.[c.key] ?? ''))).join(',')
  )
  return '\ufeff' + [header].concat(body).join('\r\n')
}

function triggerDownload(blob, fileName) {
  const objectUrl = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = fileName
  a.click()
  // 立即 revoke 在部分浏览器会中断下载，延后释放。
  setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000)
}

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
  columns: ['userName', 'studentId', 'roomName', 'date', 'timeSlot', 'status', 'purpose', 'createdAt'],
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
    ElMessage.warning('请至少选择一项导出内容')
    return
  }

  exporting.value = true
  try {
    const params = {
      type: form.type,
      startDate: form.dateRange[0],
      endDate: form.dateRange[1],
      roomId: form.roomIds.length > 0 ? form.roomIds.join(',') : ''
    }
    // 拦截器已返回 response.data，业务载荷在 res.data 中。
    const res = await exportData(params)
    const rows = (res && res.data && res.data.rows) || []

    if (!rows.length) {
      ElMessage.warning('所选时间范围内暂无数据')
      exportResult.value = '所选时间范围内暂无数据，请调整报表类型或时间范围'
      return
    }

    const columns = buildColumns(form.type, form.columns)
    const baseName = `${typeLabels[form.type]}_${form.dateRange[0]}_${form.dateRange[1]}`
    const fileName = `${baseName}.${form.format}`
    let sizeKb

    if (form.format === 'xlsx') {
      if (!exportXlsx(columns, rows, baseName)) return
      sizeKb = ((JSON.stringify(rows).length) / 1024).toFixed(1)
      ElMessage.success(`导出成功，共 ${rows.length} 条`)
    } else {
      const blob = new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
      sizeKb = (blob.size / 1024).toFixed(1)
      triggerDownload(blob, fileName)
      ElMessage.success(`导出成功，共 ${rows.length} 条`)
    }

    exportResult.value = `已完成：${fileName}（${sizeKb} KB）`
    exportHistory.value.unshift({
      id: exportHistory.value.length + 1,
      type: form.type,
      dateRange: `${form.dateRange[0]} ~ ${form.dateRange[1]}`,
      format: form.format,
      createdAt: new Date().toLocaleString(),
      fileSize: `${sizeKb} KB`,
      fileName
    })
  } catch (e) {
    exportResult.value = '导出未完成，请检查网络后重试；当前选择已保留'
    ElMessage.error('导出未完成，请重试')
  } finally {
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

