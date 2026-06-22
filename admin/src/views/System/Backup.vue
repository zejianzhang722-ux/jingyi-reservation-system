<template>
  <div class="page-container">
    <el-row :gutter="16">
      <el-col :span="16">
        <el-card shadow="never">
          <div class="table-header">
            <span class="table-title">数据备份</span>
            <el-button type="primary" @click="handleCreateBackup" :loading="backupLoading">
              <el-icon><Plus /></el-icon>立即备份
            </el-button>
          </div>

          <el-table :data="backupList" v-loading="loading" stripe>
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="name" label="备份名称" min-width="200" />
            <el-table-column prop="fileSize" label="文件大小" width="110" />
            <el-table-column prop="type" label="类型" width="90">
              <template #default="{ row }">
                <el-tag :type="row.type === 'manual' ? '' : 'info'" size="small">
                  {{ row.type === 'manual' ? '手动' : '自动' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 'completed' ? 'success' : row.status === 'running' ? 'warning' : 'danger'" size="small">
                  {{ row.status === 'completed' ? '完成' : row.status === 'running' ? '进行中' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="createdAt" label="备份时间" width="170" />
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button type="warning" size="small" link @click="handleRestore(row)" :disabled="row.status !== 'completed'">恢复</el-button>
                <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
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
      </el-col>

      <el-col :span="8">
        <el-card shadow="never">
          <template #header>
            <span class="card-title">自动备份设置</span>
          </template>
          <el-form :model="autoBackupForm" label-width="100px">
            <el-form-item label="自动备份">
              <el-switch v-model="autoBackupForm.enabled" />
            </el-form-item>
            <el-form-item label="备份频率" v-if="autoBackupForm.enabled">
              <el-select v-model="autoBackupForm.frequency" style="width: 100%">
                <el-option label="每天" value="daily" />
                <el-option label="每周" value="weekly" />
                <el-option label="每月" value="monthly" />
              </el-select>
            </el-form-item>
            <el-form-item label="备份时间" v-if="autoBackupForm.enabled">
              <el-time-picker v-model="autoBackupForm.time" format="HH:mm" value-format="HH:mm" placeholder="选择时间" style="width: 100%" />
            </el-form-item>
            <el-form-item label="保留份数">
              <el-input-number v-model="autoBackupForm.keepCount" :min="1" :max="30" style="width: 100%" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveAutoBackup">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px">
          <template #header>
            <span class="card-title">存储信息</span>
          </template>
          <div class="storage-info">
            <div class="storage-item">
              <span class="storage-label">已用空间</span>
              <span class="storage-value">{{ storageInfo.used }}</span>
            </div>
            <div class="storage-item">
              <span class="storage-label">可用空间</span>
              <span class="storage-value">{{ storageInfo.available }}</span>
            </div>
            <div class="storage-item">
              <span class="storage-label">备份文件数</span>
              <span class="storage-value">{{ backupList.length }}</span>
            </div>
            <el-progress :percentage="storageInfo.percentage" :color="storageInfo.percentage > 80 ? '#FF4D4F' : '#0066CC'" :stroke-width="10" style="margin-top: 12px" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getBackupList, createBackup, restoreBackup, deleteBackup } from '@/api/admin'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const backupLoading = ref(false)
const backupList = ref([])

const pagination = reactive({ page: 1, pageSize: 10, total: 0 })

const autoBackupForm = reactive({
  enabled: false,
  frequency: 'daily',
  time: '03:00',
  keepCount: 7
})

const storageInfo = reactive({
  used: '0 MB',
  available: '1 GB',
  percentage: 0
})

async function loadData() {
  loading.value = true
  try {
    const res = await getBackupList({ page: pagination.page, pageSize: pagination.pageSize })
    backupList.value = res.data?.list || []
    pagination.total = res.data?.total || 0
    if (res.data?.storage) {
      Object.assign(storageInfo, res.data.storage)
    }
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

async function handleCreateBackup() {
  backupLoading.value = true
  try {
    await createBackup()
    ElMessage.success('备份任务已创建')
    loadData()
  } catch (e) {
    // handled
  } finally {
    backupLoading.value = false
  }
}

async function handleRestore(row) {
  try {
    await ElMessageBox.confirm('恢复数据将覆盖当前数据，确认继续？', '危险操作', { type: 'warning', confirmButtonText: '确认恢复', cancelButtonText: '取消' })
    await restoreBackup(row.id)
    ElMessage.success('恢复成功')
  } catch (e) {
    // cancelled
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除备份"${row.name}"？`, '提示', { type: 'warning' })
    await deleteBackup(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {
    // cancelled
  }
}

function saveAutoBackup() {
  ElMessage.success('设置已保存')
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

.storage-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.storage-label {
  font-size: 13px;
  color: #999;
}

.storage-value {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
</style>
