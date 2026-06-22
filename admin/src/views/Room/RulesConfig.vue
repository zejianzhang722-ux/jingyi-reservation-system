<template>
  <div class="page-container">
    <el-card shadow="never" class="filter-card">
      <el-form :model="filters" inline>
        <el-form-item label="功能房">
          <el-select v-model="filters.roomId" placeholder="请选择功能房" style="width: 200px" @change="loadRules">
            <el-option v-for="r in roomOptions" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" v-if="filters.roomId">
      <div class="table-header">
        <span class="table-title">规则配置</span>
        <el-button type="primary" :loading="saveLoading" @click="handleSave">保存配置</el-button>
      </div>

      <el-form :model="form" label-width="140px" class="rules-form">
        <el-divider content-position="left">开放时间</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="开放开始时间">
              <el-time-picker v-model="form.openTime" format="HH:mm" value-format="HH:mm" placeholder="选择时间" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="开放结束时间">
              <el-time-picker v-model="form.closeTime" format="HH:mm" value-format="HH:mm" placeholder="选择时间" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">预约限制</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="最短预约时长(分钟)">
              <el-input-number v-model="form.minDuration" :min="30" :step="30" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最长预约时长(分钟)">
              <el-input-number v-model="form.maxDuration" :min="30" :step="30" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="每日预约上限(次)">
              <el-input-number v-model="form.dailyLimit" :min="1" :max="10" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="提前预约天数">
              <el-input-number v-model="form.advanceDays" :min="0" :max="14" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="每周预约上限(次)">
              <el-input-number v-model="form.weeklyLimit" :min="1" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="时间槽间隔(分钟)">
              <el-input-number v-model="form.slotInterval" :min="30" :step="30" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">审核设置</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="是否需要审核">
              <el-switch v-model="form.needApproval" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="是否需要辅导员审批">
              <el-switch v-model="form.needCounselorApproval" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">签到设置</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="是否需要签到">
              <el-switch v-model="form.needCheckin" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="签到时间范围(分钟)">
              <el-input-number v-model="form.checkinWindow" :min="5" :max="60" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">爽约设置</el-divider>
        <el-row :gutter="20">
          <el-col :span="12">
            <el-form-item label="爽约扣分">
              <el-input-number v-model="form.noshowPenalty" :min="0" :max="100" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="爽约封禁次数">
              <el-input-number v-model="form.noshowBanThreshold" :min="1" :max="10" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-divider content-position="left">开放日期</el-divider>
        <el-form-item label="每周开放日">
          <el-checkbox-group v-model="form.openDays">
            <el-checkbox :label="1" value="1">周一</el-checkbox>
            <el-checkbox :label="2" value="2">周二</el-checkbox>
            <el-checkbox :label="3" value="3">周三</el-checkbox>
            <el-checkbox :label="4" value="4">周四</el-checkbox>
            <el-checkbox :label="5" value="5">周五</el-checkbox>
            <el-checkbox :label="6" value="6">周六</el-checkbox>
            <el-checkbox :label="0" value="0">周日</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" v-else>
      <el-empty description="请先选择功能房" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getList, updateRules } from '@/api/room'
import { ElMessage } from 'element-plus'

const roomOptions = ref([])
const saveLoading = ref(false)
const filters = reactive({ roomId: '' })

const form = reactive({
  openTime: '08:00',
  closeTime: '22:00',
  minDuration: 60,
  maxDuration: 180,
  dailyLimit: 2,
  advanceDays: 3,
  weeklyLimit: 10,
  slotInterval: 60,
  needApproval: true,
  needCounselorApproval: false,
  needCheckin: true,
  checkinWindow: 15,
  noshowPenalty: 10,
  noshowBanThreshold: 3,
  openDays: ['1', '2', '3', '4', '5']
})

async function loadRooms() {
  try {
    const res = await getList({ pageSize: 100 })
    roomOptions.value = res.data?.list || []
  } catch (e) {
    // handled
  }
}

async function loadRules() {
  if (!filters.roomId) return
  try {
    const res = await getList({ id: filters.roomId })
    const room = res.data
    if (room?.rules) {
      Object.assign(form, room.rules)
    }
  } catch (e) {
    // handled
  }
}

async function handleSave() {
  saveLoading.value = true
  try {
    await updateRules(filters.roomId, form)
    ElMessage.success('保存成功')
  } catch (e) {
    // handled
  } finally {
    saveLoading.value = false
  }
}

onMounted(() => {
  loadRooms()
})
</script>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.filter-card :deep(.el-card__body) {
  padding-bottom: 0;
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

.rules-form {
  max-width: 800px;
}
</style>
