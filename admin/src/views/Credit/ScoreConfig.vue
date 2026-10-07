<template>
  <div class="page-container">
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">信用分配置</span>
        <el-button type="primary" :loading="saveLoading" @click="handleSave">保存配置</el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        class="tip"
        title="保存后立即写入 system_config，并在 30 秒内对所有服务实例生效。扣分请填正数。"
      />

      <el-alert title="信用分不限制登录，仅影响预约。良好：提前3天、每天3次；提醒：提前2天、每天2次；受限：提前1天、每天1次、08:00–20:00；严格受限：仅当天、每天1次、09:00–17:00。次数按同类功能房计算。" type="info" :closable="false" class="tip" />

      <el-form :model="form" label-width="180px" class="config-form">
        <el-divider content-position="left">基础设置</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="初始信用分">
              <el-input-number v-model="form.initialScore" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="信用分上限">
              <el-input-number v-model="form.maxScore" :min="50" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">扣分规则</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="爽约扣分">
              <el-input-number v-model="form.noshowPenalty" :min="0" :max="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="违规扣分">
              <el-input-number v-model="form.violationPenalty" :min="0" :max="100" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">加分规则</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="表扬奖励分">
              <el-input-number v-model="form.goodReward" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="有效反馈奖励分">
              <el-input-number v-model="form.feedbackReward" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="良好行为阈值">
              <el-input-number v-model="form.goodThreshold" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">预警与限制</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="预警阈值">
              <el-input-number v-model="form.warningThreshold" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="限制预约阈值">
              <el-input-number v-model="form.restrictThreshold" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>


        <el-divider content-position="left">预约严格限制区间</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="严格限制阈值">
              <el-input-number v-model="form.banThreshold" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>

        </el-row>
      </el-form>

      <el-divider content-position="left">当前生效值</el-divider>
      <el-descriptions :column="3" border size="small">
        <el-descriptions-item v-for="item in effectiveList" :key="item.key" :label="item.label">
          {{ item.value }}
        </el-descriptions-item>
      </el-descriptions>
      <div class="effective-tip">
        刷新时间：{{ effectiveLoadedAt || '尚未加载' }}
        <el-button link type="primary" @click="loadEffective">刷新</el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getScoreConfig, updateScoreConfig } from '@/api/credit'
import { snapshot as getEffectiveConfig } from '@/api/runtimeConfig'
import { ElMessage } from 'element-plus'

const CREDIT_FIELDS = [
  'initialScore', 'maxScore',
  'noshowPenalty', 'violationPenalty',
  'goodReward', 'feedbackReward', 'goodThreshold',
  'warningThreshold', 'restrictThreshold',
  'banThreshold'
]

const FIELD_LABELS = {
  initialScore: '初始信用分',
  maxScore: '信用分上限',
  noshowPenalty: '爽约扣分',
  violationPenalty: '违规扣分',
  goodReward: '表扬奖励分',
  feedbackReward: '有效反馈奖励分',
  goodThreshold: '良好行为阈值',
  warningThreshold: '预警阈值',
  restrictThreshold: '限制预约阈值',
  restrictDays: '限制天数',
  banThreshold: '严格限制阈值',
  banDays: '封禁天数'
}

const saveLoading = ref(false)
const effective = ref({})
const effectiveLoadedAt = ref('')

const form = reactive({
  initialScore: 100,
  maxScore: 120,
  noshowPenalty: 20,
  violationPenalty: 10,
  goodReward: 5,
  feedbackReward: 3,
  goodThreshold: 10,
  warningThreshold: 80,
  restrictThreshold: 60,
  restrictDays: 7,
  banThreshold: 30,
  banDays: 30
})

const effectiveList = computed(() => {
  return CREDIT_FIELDS
    .filter((key) => effective.value[key] !== undefined)
    .map((key) => ({ key, label: FIELD_LABELS[key], value: effective.value[key] }))
})

async function loadConfig() {
  try {
    const res = await getScoreConfig()
    const credit = res.data && res.data.credit ? res.data.credit : {}
    Object.assign(form, credit)
  } catch (e) {
    // handled by request interceptor
  }
}

async function loadEffective() {
  try {
    const res = await getEffectiveConfig()
    if (res.data) {
      effective.value = res.data.credit || {}
      effectiveLoadedAt.value = res.data.loadedAt || ''
    }
  } catch (e) {
    // handled by request interceptor
  }
}

async function handleSave() {
  if (saveLoading.value) return
  saveLoading.value = true
  try {
    const payload = {}
    CREDIT_FIELDS.forEach((key) => {
      payload[key] = form[key]
    })
    await updateScoreConfig({ credit: payload })
    ElMessage.success('保存成功，正在生效')
    await Promise.all([loadConfig(), loadEffective()])
  } catch (e) {
    // handled by request interceptor
  } finally {
    saveLoading.value = false
  }
}

onMounted(() => {
  loadConfig()
  loadEffective()
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

.config-form {
  max-width: 800px;
}

.tip {
  margin-bottom: 16px;
}

.effective-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
