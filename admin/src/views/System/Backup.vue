<template>
  <PageShell
    title="数据备份"
    eyebrow="BACKUP RECOVERY"
    description="创建加密备份、查看备份运行记录，并对已完成备份执行完整性校验。"
  >
    <template #actions>
      <el-button type="primary" @click="handleCreateBackup" :loading="backupLoading">
        <el-icon><Plus /></el-icon>立即备份
      </el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="备份记录" :value="backupList.length" caption="当前返回记录数" icon="FolderOpened" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="成功完成" :value="successCount" caption="本页成功备份" icon="CircleCheck" tone="success" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="运行/失败" :value="attentionCount" caption="需要关注的记录" icon="Warning" tone="warning" />
      </el-col>
    </el-row>

    <el-row :gutter="16">
      <el-col :xs="24" :lg="16">
        <el-card shadow="never">
          <template #header>
            <div class="panel-header">
              <span class="card-title">备份运行记录</span>
              <el-tag size="small" type="info">仅提供创建与完整性校验</el-tag>
            </div>
          </template>
          <el-table :data="backupList" v-loading="loading" stripe>
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column label="备份文件" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.fileName || '-' }}</template>
            </el-table-column>
            <el-table-column label="文件大小" width="120">
              <template #default="{ row }">{{ formatSize(row.sizeBytes) }}</template>
            </el-table-column>
            <el-table-column label="类型" width="90">
              <template #default="{ row }">
                <el-tag :type="row.triggerType === 'manual' ? '' : 'info'" size="small">{{ row.triggerType === 'manual' ? '手动' : '自动' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">{{ statusMap[row.status]?.label || row.status }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="开始时间" width="180">
              <template #default="{ row }">{{ row.startedAt || '-' }}</template>
            </el-table-column>
            <el-table-column label="完成时间" width="180">
              <template #default="{ row }">{{ row.finishedAt || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="130" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" size="small" link @click="handleVerify(row)" :disabled="row.status !== 'success' || !row.fileName">校验</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :xs="24" :lg="8">
        <el-card shadow="never">
          <template #header><span class="card-title">自动备份设置</span></template>
          <el-alert title="自动备份策略当前为本地配置展示，实际定时策略请通过后端环境变量或计划任务管理。" type="info" show-icon :closable="false" class="backup-alert" />
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
          </el-form>
        </el-card>

        <el-card shadow="never" class="side-card">
          <template #header><span class="card-title">存储信息</span></template>
          <div class="storage-info">
            <div class="storage-item"><span>已用空间</span><strong>{{ storageInfo.used }}</strong></div>
            <div class="storage-item"><span>可用空间</span><strong>{{ storageInfo.available }}</strong></div>
            <div class="storage-item"><span>备份文件数</span><strong>{{ backupList.length }}</strong></div>
            <el-progress :percentage="storageInfo.percentage" :color="storageInfo.percentage > 80 ? '#FF4D4F' : '#0066CC'" :stroke-width="10" />
          </div>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getBackupList, createBackup, verifyBackup } from '@/api/admin'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/admin/PageShell.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

const loading = ref(false)
const backupLoading = ref(false)
const backupList = ref([])

const autoBackupForm = reactive({ enabled: false, frequency: 'daily', time: '03:00', keepCount: 7 })
const storageInfo = reactive({ used: '0 MB', available: '1 GB', percentage: 0 })

const statusMap = {
  success: { label: '完成', type: 'success' },
  running: { label: '进行中', type: 'warning' },
  failed: { label: '失败', type: 'danger' }
}

const successCount = computed(() => backupList.value.filter(item => item.status === 'success').length)
const attentionCount = computed(() => backupList.value.filter(item => item.status !== 'success').length)

function normalizeBackup(row) {
  return {
    id: row.id,
    fileName: row.fileName || row.file_name || row.name || '',
    sizeBytes: row.sizeBytes || row.size_bytes || 0,
    triggerType: row.triggerType || row.trigger_type || row.type || 'manual',
    status: row.status || 'running',
    startedAt: row.startedAt || row.started_at || row.createdAt || row.created_at,
    finishedAt: row.finishedAt || row.finished_at,
    checksum: row.checksum || row.checksum_sha256
  }
}

function formatSize(sizeBytes) {
  const size = Number(sizeBytes || 0)
  if (size <= 0) return '-'
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function loadData() {
  loading.value = true
  try {
    const res = await getBackupList({ limit: 50 })
    const data = res.data || []
    backupList.value = Array.isArray(data) ? data.map(normalizeBackup) : (data.list || []).map(normalizeBackup)
    if (data.storage) Object.assign(storageInfo, data.storage)
  } catch (e) {
    backupList.value = []
  } finally {
    loading.value = false
  }
}

async function handleCreateBackup() {
  backupLoading.value = true
  try {
    await createBackup()
    ElMessage.success('备份已创建并完成校验')
    loadData()
  } catch (e) {
    // handled by interceptor
  } finally {
    backupLoading.value = false
  }
}

async function handleVerify(row) {
  try {
    await verifyBackup(row.fileName)
    ElMessage.success('备份完整性校验通过')
  } catch (e) {
    // handled by interceptor
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.card-title {
  font-weight: 700;
  color: var(--jy-text-primary, #1A1A2E);
}

.side-card {
  margin-top: 16px;
}

.backup-alert {
  margin-bottom: 16px;
}

.storage-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.storage-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--jy-text-secondary, #8C8C9A);
}

.storage-item strong {
  color: var(--jy-text-primary, #1A1A2E);
}
</style>
