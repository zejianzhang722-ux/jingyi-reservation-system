<template>
  <div class="page-container">
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">信用分配置</span>
        <el-button type="primary" :loading="saveLoading" @click="handleSave">保存配置</el-button>
      </div>

      <el-form :model="form" label-width="180px" class="config-form">
        <el-divider content-position="left">基础设置</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="初始信用分">
              <el-input-number v-model="form.initialScore" :min="0" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="满分">
              <el-input-number v-model="form.maxScore" :min="50" :max="200" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">扣分规则</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="爽约扣分">
              <el-input-number v-model="form.noshowDeduction" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="超时未签退扣分">
              <el-input-number v-model="form.overtimeDeduction" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="损坏设施扣分">
              <el-input-number v-model="form.damageDeduction" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="违规使用扣分">
              <el-input-number v-model="form.misuseDeduction" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="海报违规扣分">
              <el-input-number v-model="form.posterDeduction" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">封禁规则</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="封禁触发分数">
              <el-input-number v-model="form.banThreshold" :min="0" :max="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="默认封禁天数">
              <el-input-number v-model="form.defaultBanDays" :min="1" :max="365" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="爽约累计封禁次数">
              <el-input-number v-model="form.noshowBanCount" :min="1" :max="10" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="永久封禁分数">
              <el-input-number v-model="form.permanentBanScore" :min="0" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">恢复规则</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="每日自然恢复分">
              <el-input-number v-model="form.dailyRecovery" :min="0" :max="10" :precision="1" :step="0.5" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="正常使用奖励分">
              <el-input-number v-model="form.goodUsageBonus" :min="0" :max="5" :precision="1" :step="0.5" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getScoreConfig, updateScoreConfig } from '@/api/credit'
import { ElMessage } from 'element-plus'

const saveLoading = ref(false)

const form = reactive({
  initialScore: 100,
  maxScore: 100,
  noshowDeduction: 10,
  overtimeDeduction: 5,
  damageDeduction: 20,
  misuseDeduction: 15,
  posterDeduction: 10,
  banThreshold: 30,
  defaultBanDays: 7,
  noshowBanCount: 3,
  permanentBanScore: 0,
  dailyRecovery: 1,
  goodUsageBonus: 0.5
})

async function loadConfig() {
  try {
    const res = await getScoreConfig()
    if (res.data) {
      Object.assign(form, res.data)
    }
  } catch (e) {
    // handled
  }
}

async function handleSave() {
  saveLoading.value = true
  try {
    await updateScoreConfig(form)
    ElMessage.success('保存成功')
  } catch (e) {
    // handled
  } finally {
    saveLoading.value = false
  }
}

onMounted(() => {
  loadConfig()
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
</style>
