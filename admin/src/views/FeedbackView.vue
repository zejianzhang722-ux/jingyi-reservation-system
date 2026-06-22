<template>
  <div class="feedback-container">
    <el-card>
      <template #header>
        <div class="card-header">
          <span>反馈管理</span>
          <el-select v-model="statusFilter" placeholder="状态筛选" style="width: 150px" @change="loadFeedbacks">
            <el-option label="全部" value="" />
            <el-option label="待处理" value="pending" />
            <el-option label="已处理" value="resolved" />
          </el-select>
        </div>
      </template>
      <el-table :data="feedbacks" stripe>
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="userName" label="用户" width="100" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.type === 'bug' ? 'danger' : row.type === 'feature' ? 'success' : 'info'" size="small">
              {{ typeMap[row.type] || row.type }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="content" label="内容" min-width="200" show-overflow-tooltip />
        <el-table-column prop="contact" label="联系方式" width="120" />
        <el-table-column prop="status" label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'resolved' ? 'success' : 'warning'" size="small">
              {{ row.status === 'resolved' ? '已处理' : '待处理' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="提交时间" width="160" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'resolved'" type="primary" size="small" link @click="openResolve(row)">回复处理</el-button>
            <span v-else>{{ row.reply || '已处理' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="total > pageSize"
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="onPageChange"
        style="margin-top: 16px; text-align: right"
      />
    </el-card>

    <el-dialog v-model="resolveDialogVisible" title="回复反馈" width="480px">
      <el-input v-model="replyContent" type="textarea" :rows="4" placeholder="请输入回复内容" />
      <template #footer>
        <el-button @click="resolveDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitResolve">确认处理</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'

const feedbacks = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const statusFilter = ref('')
const resolveDialogVisible = ref(false)
const currentFeedback = ref(null)
const replyContent = ref('')
const typeMap = { suggestion: '建议', bug: '问题', feature: '功能请求', other: '其他' }

const loadFeedbacks = async () => {
  try {
    const res = await request.get('/feedback', {
      params: { page: page.value, pageSize: pageSize.value, status: statusFilter.value }
    })
    feedbacks.value = res.data.list
    total.value = res.data.total
  } catch (e) {
    feedbacks.value = []
  }
}

const onPageChange = (p) => {
  page.value = p
  loadFeedbacks()
}

const openResolve = (row) => {
  currentFeedback.value = row
  replyContent.value = row.reply || ''
  resolveDialogVisible.value = true
}

const submitResolve = async () => {
  if (!currentFeedback.value) return
  await request.put(`/feedback/${currentFeedback.value.id}/resolve`, { reply: replyContent.value })
  ElMessage.success('处理成功')
  resolveDialogVisible.value = false
  loadFeedbacks()
}

onMounted(() => { loadFeedbacks() })
</script>

<style scoped>
.feedback-container { padding: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
</style>
