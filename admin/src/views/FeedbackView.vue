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

    <ListToolbar
      v-model:status="statusFilter"
      v-model:keyword="keyword"
      :status-options="statusOptions"
      status-placeholder="状态筛选"
      keyword-placeholder="搜索用户/反馈内容"
      export-file-name="导出_用户反馈"
      @search="onSearch"
      @reset="resetFilters"
      @export="handleExport"
    />

    <el-alert v-if="loadError && feedbacks.length" :title="loadError" type="warning" show-icon :closable="false" class="load-alert" />

    <el-card shadow="never">
      <AsyncState
        :loading="loading"
        :error="!!loadError && !feedbacks.length"
        :empty="!loading && !loadError && !feedbacks.length"
        empty-description="暂无用户反馈"
        @retry="loadFeedbacks"
      >
        <template #empty-action>
          <el-button type="primary" @click="resetFilters">重置筛选</el-button>
        </template>

        <el-table :data="filteredRows" stripe>
          <el-table-column prop="userName" label="用户" width="110" />
          <el-table-column prop="type" label="类型" width="110">
            <template #default="{ row }">
              <el-tag :type="row.type === 'bug' ? 'danger' : row.type === 'feature' ? 'success' : 'info'" size="small">
                {{ typeMap[row.type] || '类型待确认' }}
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
        <div v-if="feedbacks.length" class="pagination-wrap">
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
      </AsyncState>
    </el-card>

    <el-dialog v-model="resolveDialogVisible" title="回复反馈" width="520px">
      <el-descriptions v-if="currentFeedback" :column="1" border class="feedback-detail">
        <el-descriptions-item label="用户">{{ currentFeedback.userName }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeMap[currentFeedback.type] || '类型待确认' }}</el-descriptions-item>
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
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import PageShell from '@/components/admin/PageShell.vue'
import ListToolbar from '@/components/admin/ListToolbar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import AsyncState from '@/components/admin/AsyncState.vue'
import { createLatestRequestCoordinator } from '@/utils/latestRequest'
import { exportXlsx, fetchAllPages } from '@/utils/exportXlsx'

const feedbacks = ref([])
const loading = ref(false)
const loadError = ref('')
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const statusFilter = ref('')
// GET /feedback 后端仅支持 status，不支持 keyword → 关键词前端兜底（🔧）。
const keyword = ref('')
const resolveDialogVisible = ref(false)
const currentFeedback = ref(null)
const replyContent = ref('')
const typeMap = { suggestion: '建议', bug: '问题', feature: '功能建议', other: '其他' }

const statusOptions = [
  { label: '待处理', value: 'pending' },
  { label: '已处理', value: 'resolved' }
]

/**
 * R-14（红线）：feedbackController.list 未经过 privacyAuditService.maskRowsForRequest，
 * 返回的 contact（联系方式）是没有任何脱敏层的明文 PII，因此【导出不含联系方式】。
 * 其余列与表格展示字段一致。是否放开需后端先补齐脱敏 + 产品确认。
 */
const exportColumns = [
  { header: '用户', key: 'userName' },
  { header: '类型', formatter: row => typeMap[row.type] || '类型待确认' },
  { header: '内容', key: 'content', width: 40 },
  { header: '状态', formatter: row => (row.status === 'resolved' ? '已处理' : '待处理') },
  { header: '提交时间', key: 'createdAt', width: 20 }
]

/**
 * 关键词前端兜底：后端无 keyword 参数，只能对已加载数据做包含匹配。
 * @param {object} row 反馈行
 * @returns {boolean} 是否命中
 */
function matchKeyword(row) {
  const text = String(keyword.value || '').trim().toLowerCase()
  if (!text) return true
  return [row.userName, row.content]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(text)
}

const filteredRows = computed(() => feedbacks.value.filter(matchKeyword))

const pendingCount = computed(() => feedbacks.value.filter(item => item.status !== 'resolved').length)
const resolvedCount = computed(() => feedbacks.value.filter(item => item.status === 'resolved').length)

// 导出专用的取数函数：与列表加载共用同一条 /feedback 请求，仅多传 silentError。
const fetchFeedbacks = (params, options = {}) => request.get('/feedback', { ...options, params })

// 列表查询参数单一来源：只带后端支持的 status；keyword 由前端兜底。
function buildParams() {
  return { status: statusFilter.value || '' }
}

const feedbackRequest = createLatestRequestCoordinator({
  load: params => request.get('/feedback', { params, silentError: true }),
  onStart: () => { loading.value = true; loadError.value = '' },
  onSuccess: res => {
    feedbacks.value = res.data?.list || []
    total.value = res.data?.total || 0
  },
  onError: () => {
    loadError.value = feedbacks.value.length
      ? '反馈列表加载失败，已保留上次结果，请重试'
      : '反馈列表加载失败，请重试'
  },
  onFinish: () => { loading.value = false }
})

async function loadFeedbacks() {
  return feedbackRequest.run({ ...buildParams(), page: page.value, pageSize: pageSize.value })
}

// 状态/关键词变更后回到第 1 页再查询
function onSearch() {
  page.value = 1
  loadFeedbacks()
}

function resetFilters() {
  statusFilter.value = ''
  keyword.value = ''
  page.value = 1
  loadFeedbacks()
}

/**
 * 导出当前筛选条件下的全量反馈。
 * 后端 /feedback 未挂 pageSize 上限校验，但统一按 100/页循环拉取，避免单次请求过大；
 * keyword 后端不支持，导出时对全量结果套用同一套前端过滤，保证「导出 == 当前筛选视图」。
 */
async function handleExport() {
  try {
    const list = await fetchAllPages(fetchFeedbacks, buildParams(), {
      pageSize: 100,
      maxPages: 50,
      options: { silentError: true }
    })
    const rows = list.filter(row => matchKeyword(row))
    if (!exportXlsx(exportColumns, rows, '导出_用户反馈')) return
    ElMessage.success(`导出成功，共 ${rows.length} 条`)
  } catch (e) {
    ElMessage.error('导出失败，请重试')
  }
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
onBeforeUnmount(() => { feedbackRequest.invalidate() })
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

.load-alert {
  margin-bottom: 0;
}
</style>
