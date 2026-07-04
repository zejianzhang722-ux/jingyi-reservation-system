<template>
  <PageShell
    title="反馈管理"
    eyebrow="用户反馈"
    description="集中查看用户反馈、问题上报和功能建议，并记录处理回复。"
  >
    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="反馈总数" :value="total" caption="当前筛选条件" icon="ChatDotRound" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="待处理" :value="pendingCount" caption="本页待处理反馈" icon="Clock" tone="warning" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="已处理" :value="resolvedCount" caption="本页已处理反馈" icon="CircleCheck" tone="success" />
      </el-col>
    </el-row>

    <FilterBar @search="loadFeedbacks" @reset="resetFilters">
      <el-select v-model="statusFilter" placeholder="状态筛选" clearable style="width: 160px">
        <el-option label="待处理" value="pending" />
        <el-option label="已处理" value="resolved" />
      </el-select>
    </FilterBar>

    <el-card shadow="never">
      <el-table :data="feedbacks" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="userName" label="用户" width="110" />
        <el-table-column prop="type" label="类型" width="110">
          <template #default="{ row }">
            <el-tag :type="row.type === 'bug' ? 'danger' : row.type === 'feature' ? 'success' : 'info'" size="small">
              {{ typeMap[row.type] || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="内容" min-width="220" show-overflow-tooltip />
        <el-table-column prop="contact" label="联系方式" width="140" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'resolved' ? 'success' : 'warning'" size="small">
              {{ row.status === 'resolved' ? '已处理' : '待处理' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="提交时间" width="170" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'resolved'" type="primary" size="small" link @click="openResolve(row)">回复处理</el-button>
            <el-button v-else type="info" size="small" link @click="openResolve(row)">查看回复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-wrap">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="loadFeedbacks"
          @current-change="loadFeedbacks"
        />
      </div>
    </el-card>

    <el-dialog v-model="resolveDialogVisible" title="回复反馈" width="520px">
      <el-descriptions v-if="currentFeedback" :column="1" border class="feedback-detail">
        <el-descriptions-item label="用户">{{ currentFeedback.userName }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeMap[currentFeedback.type] || currentFeedback.type }}</el-descriptions-item>
        <el-descriptions-item label="内容">{{ currentFeedback.content }}</el-descriptions-item>
        <el-descriptions-item label="联系方式">{{ currentFeedback.contact || '未填写' }}</el-descriptions-item>
      </el-descriptions>
      <el-input v-model="replyContent" type="textarea" :rows="4" placeholder="请输入回复内容" />
      <template #footer>
        <el-button @click="resolveDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitResolve">确认处理</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'

const feedbacks = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('')
const resolveDialogVisible = ref(false)
const currentFeedback = ref(null)
const replyContent = ref('')
const typeMap = { suggestion: '建议', bug: '问题', feature: '功能请求', other: '其他' }

const pendingCount = computed(() => feedbacks.value.filter(item => item.status !== 'resolved').length)
const resolvedCount = computed(() => feedbacks.value.filter(item => item.status === 'resolved').length)

async function loadFeedbacks() {
  try {
    const res = await request.get('/feedback', {
      params: { page: page.value, pageSize: pageSize.value, status: statusFilter.value }
    })
    feedbacks.value = res.data?.list || []
    total.value = res.data?.total || 0
  } catch (e) {
    feedbacks.value = []
    total.value = 0
  }
}

function resetFilters() {
  statusFilter.value = ''
  page.value = 1
  loadFeedbacks()
}

function openResolve(row) {
  currentFeedback.value = row
  replyContent.value = row.reply || ''
  resolveDialogVisible.value = true
}

async function submitResolve() {
  if (!currentFeedback.value) return
  if (!replyContent.value.trim()) {
    ElMessage.warning('请输入回复内容')
    return
  }
  await request.put(`/feedback/${currentFeedback.value.id}/resolve`, { reply: replyContent.value })
  ElMessage.success('处理成功')
  resolveDialogVisible.value = false
  loadFeedbacks()
}

onMounted(() => { loadFeedbacks() })
</script>

<style scoped>
.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.feedback-detail {
  margin-bottom: 16px;
}
</style>

