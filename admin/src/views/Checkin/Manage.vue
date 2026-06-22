<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="16">
        <el-card shadow="never">
          <div class="table-header">
            <span class="table-title">实时签到面板</span>
            <el-tag type="success">当前在用 {{ currentList.length }} 人</el-tag>
          </div>

          <el-table :data="currentList" v-loading="loading" stripe>
            <el-table-column prop="id" label="ID" width="70" />
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
            <span class="card-title">巡查记录</span>
          </template>
          <el-table :data="patrolList" size="small" max-height="300">
            <el-table-column prop="roomName" label="功能房" width="100" />
            <el-table-column prop="status" label="状态" width="70">
              <template #default="{ row }">
                <el-tag :type="row.status === 'normal' ? 'success' : 'warning'" size="small">
                  {{ row.status === 'normal' ? '正常' : '异常' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="patrolTime" label="巡查时间" width="130" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { manualCheckin, manualCheckout, getCurrentList, getPatrolList } from '@/api/checkin'
import { getList as getRoomList } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const currentList = ref([])
const patrolList = ref([])
const roomOptions = ref([])

const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const checkinForm = reactive({ studentId: '', roomId: '', seatNumber: '' })

async function loadCurrentList() {
  loading.value = true
  try {
    const res = await getCurrentList({ page: pagination.page, pageSize: pagination.pageSize })
    currentList.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

async function loadPatrolList() {
  try {
    const res = await getPatrolList({ pageSize: 20 })
    patrolList.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function loadRooms() {
  try {
    const res = await getRoomList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
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
  } catch (e) {
    // handled
  }
}

async function handleCheckout(row) {
  try {
    await ElMessageBox.confirm(`确认为 ${row.userName} 手动签退？`, '提示', { type: 'warning' })
    await manualCheckout({ reservationId: row.reservationId })
    ElMessage.success('签退成功')
    loadCurrentList()
  } catch (e) {
    // cancelled
  }
}

onMounted(() => {
  loadCurrentList()
  loadPatrolList()
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
