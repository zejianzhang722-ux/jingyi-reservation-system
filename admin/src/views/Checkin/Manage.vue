<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="16">
        <el-card shadow="never">
          <div class="table-header">
            <span class="table-title">实时签到面板</span>
            <el-tag type="success">当前在用 {{ currentList.length }} 人</el-tag>
          </div>

          <ListToolbar
            v-model:keyword="keyword"
            keyword-placeholder="搜索学号/姓名"
            export-file-name="导出_在场签到"
            @search="handleSearch"
            @reset="handleReset"
            @export="handleExport"
          />

          <el-table :data="filteredList" v-loading="loading" stripe>
            <el-table-column prop="userName" label="学生姓名" width="100" />
            <el-table-column prop="studentId" label="学号" width="130" />
            <el-table-column prop="roomName" label="功能房" width="130" />
            <el-table-column prop="seatNumber" label="座位号" width="80" />
            <el-table-column prop="checkinTime" label="签到时间" width="170" />
            <el-table-column prop="duration" label="已用时" width="90" />
            <el-table-column label="操作" width="160" fixed="right">
              <template #default="{ row }">
                <el-button type="warning" size="small" link @click="handleCheckout(row)">手动签退</el-button>
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
              @size-change="loadCurrentList"
              @current-change="loadCurrentList"
            />
          </div>
        </el-card>
      </el-col>

      <el-col :span="8">
        <el-card shadow="never">
          <template #header>
            <span class="card-title">手动签到</span>
          </template>
          <el-form :model="checkinForm" label-width="80px">
            <el-form-item label="学号">
              <el-input v-model="checkinForm.studentId" placeholder="输入学号" />
            </el-form-item>
            <el-form-item label="功能房">
              <el-select v-model="checkinForm.roomId" placeholder="选择功能房" style="width: 100%">
                <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="座位号">
              <el-input v-model="checkinForm.seatNumber" placeholder="座位号（可选）" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" style="width: 100%" @click="handleManualCheckin">签到</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <template #header>
            <span class="card-title">巡查操作</span>
          </template>
          <el-form :model="patrolForm" label-width="80px">
            <el-form-item label="在场记录">
              <el-select
                v-model="patrolForm.reservationId"
                placeholder="选择在场签到记录"
                filterable
                style="width: 100%"
              >
                <el-option
                  v-for="o in patrolOptions"
                  :key="o.reservationId"
                  :label="`${o.userName}（${o.roomName}${o.seatNumber ? ' / ' + o.seatNumber + '座' : ''}）`"
                  :value="o.reservationId"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="巡查状态">
              <el-select v-model="patrolForm.status" style="width: 100%">
                <el-option label="正常" value="normal" />
                <el-option label="缺席（爽约）" value="absent" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                style="width: 100%"
                :loading="patrolSubmitting"
                @click="handlePatrol"
              >提交巡查</el-button>
            </el-form-item>
          </el-form>
          <el-alert
            type="info"
            :closable="false"
            show-icon
            title="选择一条在场签到记录并提交。状态为「缺席」将标记为爽约并扣信用分。"
          />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { manualCheckin, manualCheckout, getCurrentList, submitPatrol } from '@/api/checkin'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'
import ListToolbar from '@/components/admin/ListToolbar.vue'

const loading = ref(false)
const patrolSubmitting = ref(false)
const currentList = ref([])
const roomOptions = ref([])
const patrolOptions = ref([])

const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const checkinForm = reactive({ studentId: '', roomId: '', seatNumber: '' })
const patrolForm = reactive({ reservationId: '', status: 'normal' })

// 基于签到时间实时计算在场时长。
function computeDuration(checkinTime) {
  if (!checkinTime) return ''
  const start = new Date(String(checkinTime).replace(' ', 'T'))
  if (Number.isNaN(start.getTime())) return ''
  const diffMs = Math.max(0, Date.now() - start.getTime())
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`
}

// 关键词搜索：后端 GET /checkin/current 仅支持分页、不支持 keyword，
// 因此对当前已加载列表做前端过滤（该路由未挂 paginationRules，pageSize 可自由取值）。
const keyword = ref('')
const filteredList = computed(function() {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return currentList.value
  return currentList.value.filter(function(item) {
    return String(item.userName || '').toLowerCase().indexOf(kw) >= 0 ||
      String(item.studentId || '').toLowerCase().indexOf(kw) >= 0
  })
})

function handleSearch() {
  pagination.page = 1
  loadCurrentList()
}

function handleReset() {
  keyword.value = ''
  pagination.page = 1
  loadCurrentList()
}

// R-14：导出列仅使用页面已展示、且后端已脱敏的字段。
const exportColumns = [
  { header: '学生姓名', key: 'userName' },
  { header: '学号', key: 'studentId' },
  { header: '功能房', key: 'roomName' },
  { header: '座位号', key: 'seatNumber' },
  { header: '签到时间', key: 'checkinTime' },
  { header: '已用时', formatter: row => computeDuration(row.checkinTime) }
]

async function handleExport() {
  try {
    const rows = await fetchAllPages(getCurrentList, {}, { pageSize: 100, maxPages: 20 })
    const list = rows.map(function(item) {
      return Object.assign({}, item, { duration: computeDuration(item.checkinTime) })
    })
    if (!exportXlsx(exportColumns, list, '导出_在场签到')) return
    ElMessage.success(`导出成功，共 ${list.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
}

async function loadCurrentList() {
  loading.value = true
  try {
    const res = await getCurrentList({ page: pagination.page, pageSize: pagination.pageSize })
    currentList.value = (res.data?.list || []).map(function(item) {
      return Object.assign({}, item, { duration: computeDuration(item.checkinTime) })
    })
    pagination.total = res.data?.total || 0
  } catch (e) {
    // 已由全局拦截器处理
  } finally {
    loading.value = false
  }
}

// 巡查操作的目标下拉：复用在场签到列表（大页），展示在巡记录供管理员选择。
async function loadCheckinOptions() {
  try {
    const res = await getCurrentList({ page: 1, pageSize: 100 })
    patrolOptions.value = res.data?.list || []
  } catch (e) {
    // 已由全局拦截器处理
  }
}

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // 已由全局拦截器处理
  }
}

async function handleManualCheckin() {
  if (!checkinForm.studentId || !checkinForm.roomId) {
    ElMessage.warning('请填写学号和功能房')
    return
  }
  try {
    await manualCheckin(checkinForm)
    ElMessage.success('签到成功')
    checkinForm.studentId = ''
    checkinForm.roomId = ''
    checkinForm.seatNumber = ''
    loadCurrentList()
    loadCheckinOptions()
  } catch (e) {
    // 已由全局拦截器处理
  }
}

async function handlePatrol() {
  if (!patrolForm.reservationId) {
    ElMessage.warning('请选择巡查的在场签到记录')
    return
  }
  const confirmText = patrolForm.status === 'absent'
    ? '确认将该记录标记为「缺席（爽约）」？将扣减信用分。'
    : '确认提交该记录的巡查结果？'
  try {
    await ElMessageBox.confirm(confirmText, '提示', { type: 'warning' })
  } catch (e) {
    return // 用户取消
  }
  patrolSubmitting.value = true
  try {
    await submitPatrol({
      reservationId: Number(patrolForm.reservationId),
      status: patrolForm.status
    })
    ElMessage.success('巡查记录已提交')
    patrolForm.reservationId = ''
    patrolForm.status = 'normal'
    loadCurrentList()
    loadCheckinOptions()
  } catch (e) {
    // 已由全局拦截器处理
  } finally {
    patrolSubmitting.value = false
  }
}

async function handleCheckout(row) {
  try {
    await ElMessageBox.confirm(`确认为 ${row.userName} 手动签退？`, '提示', { type: 'warning' })
    await manualCheckout({ reservationId: row.reservationId })
    ElMessage.success('签退成功')
    loadCurrentList()
    loadCheckinOptions()
  } catch (e) {
    // 取消或未处理
  }
}

onMounted(() => {
  loadCurrentList()
  loadCheckinOptions()
  loadRooms()
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

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #333;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
