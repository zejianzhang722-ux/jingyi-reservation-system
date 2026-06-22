<template>
  <div class="page-container">
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">海报位置管理</span>
        <el-button type="primary" @click="handleAdd">
          <el-icon><Plus /></el-icon>新增位置
        </el-button>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="位置名称" width="180" />
        <el-table-column prop="building" label="所在楼栋" width="140" />
        <el-table-column prop="floor" label="楼层" width="80" />
        <el-table-column prop="maxPosters" label="最大海报数" width="120" />
        <el-table-column prop="currentPosters" label="当前海报数" width="120" />
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="150" show-overflow-tooltip />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑位置' : '新增位置'" width="500px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="位置名称" prop="name">
          <el-input v-model="form.name" placeholder="请输入位置名称" />
        </el-form-item>
        <el-form-item label="所在楼栋" prop="building">
          <el-input v-model="form.building" placeholder="请输入楼栋" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input-number v-model="form.floor" :min="1" :max="30" />
        </el-form-item>
        <el-form-item label="最大海报数" prop="maxPosters">
          <el-input-number v-model="form.maxPosters" :min="1" :max="50" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 100%">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="inactive" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="请输入描述" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { getPositions, createPosition, updatePosition, deletePosition } from '@/api/poster'
import { ElMessage, ElMessageBox } from 'element-plus'

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)

const form = reactive({ id: null, name: '', building: '', floor: 1, maxPosters: 4, status: 'active', description: '' })
const rules = {
  name: [{ required: true, message: '请输入位置名称', trigger: 'blur' }],
  building: [{ required: true, message: '请输入楼栋', trigger: 'blur' }]
}

async function loadData() {
  loading.value = true
  try {
    const res = await getPositions({ pageSize: 100 })
    tableData.value = res.data?.list || []
  } catch (e) {
    // handled
  } finally {
    loading.value = false
  }
}

function handleAdd() {
  isEdit.value = false
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  Object.assign(form, { id: row.id, name: row.name, building: row.building, floor: row.floor, maxPosters: row.maxPosters, status: row.status, description: row.description || '' })
  dialogVisible.value = true
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除位置"${row.name}"？`, '提示', { type: 'warning' })
    await deletePosition(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {
    // cancelled
  }
}

function resetForm() {
  Object.assign(form, { id: null, name: '', building: '', floor: 1, maxPosters: 4, status: 'active', description: '' })
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    if (isEdit.value) {
      await updatePosition(form.id, form)
      ElMessage.success('更新成功')
    } else {
      await createPosition(form)
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    loadData()
  } catch (e) {
    // handled
  } finally {
    submitLoading.value = false
  }
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
</style>
