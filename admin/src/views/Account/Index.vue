<template>
  <div class="page-container">
    <el-card shadow="never">
      <div class="table-header">
        <span class="table-title">账号管理</span>
        <div class="table-header-actions">
          <el-select v-model="filterRole" placeholder="角色筛选" clearable style="width: 150px; margin-right: 8px;">
            <el-option label="超级管理员" value="super_admin" />
            <el-option label="导生管理员" value="admin" />
            <el-option label="书院辅导员" value="counselor" />
            <el-option label="宿生" value="student" />
          </el-select>
          <el-input v-model="filterName" placeholder="搜索姓名" clearable style="width: 150px; margin-right: 8px;" @clear="loadData" @keyup.enter="loadData" />
          <el-button type="primary" @click="loadData">查询</el-button>
          <el-button type="success" @click="handleImport">
            <el-icon><Upload /></el-icon>导入Excel
          </el-button>
          <el-button type="primary" @click="handleAdd">
            <el-icon><Plus /></el-icon>新增账号
          </el-button>
        </div>
      </div>

      <el-table :data="tableData" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="username" label="用户名" width="140" />
        <el-table-column prop="realName" label="真实姓名" width="120" />
        <el-table-column prop="role" label="角色" width="130">
          <template #default="{ row }">
            <el-tag :type="roleMap[row.role]?.type" size="small">{{ roleMap[row.role]?.label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="170" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button type="danger" size="small" link @click="handleDelete(row)" :disabled="row.role === 'super_admin'">删除</el-button>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑账号' : '新增账号'" width="500px" @close="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="真实姓名" prop="realName">
          <el-input v-model="form.realName" placeholder="请输入真实姓名" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="opt in roleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="密码" :prop="isEdit ? '' : 'password'">
          <el-input v-model="form.password" type="password" :placeholder="isEdit ? '留空则不修改' : '请输入密码'" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="导入账号" width="500px">
      <el-upload ref="uploadRef" action="" :auto-upload="false" :on-change="handleFileChange" accept=".xlsx,.xls" :limit="1">
        <el-button type="primary">选择Excel文件</el-button>
        <template #tip>
          <div class="upload-tip">Excel格式：真实姓名、角色（超级管理员/导生管理员/书院辅导员/宿生）、账号（宿生为学号）、密码（宿生为一卡通卡号）</div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importLoading" @click="doImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { getList, create, update, remove } from '@/api/account'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
const currentRole = computed(() => userStore.userInfo?.role || 'admin')

const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)
const filterRole = ref('')
const filterName = ref('')
const importDialogVisible = ref(false)
const importLoading = ref(false)
const uploadRef = ref(null)
let importFile = null

const roleMap = {
  super_admin: { label: '超级管理员（导生会会长团）', type: 'danger' },
  admin: { label: '系统管理员（导生管理员）', type: '' },
  counselor: { label: '辅导员', type: 'success' },
  student: { label: '宿生', type: 'info' }
}

const roleOptions = computed(() => {
  const all = [
    { label: '超级管理员（导生会会长团）', value: 'super_admin' },
    { label: '系统管理员（导生管理员）', value: 'admin' },
    { label: '辅导员', value: 'counselor' },
    { label: '宿生', value: 'student' }
  ]
  if (currentRole.value === 'super_admin') return all
  if (currentRole.value === 'counselor') return all.filter(r => r.value === 'admin' || r.value === 'student')
  if (currentRole.value === 'admin') return all.filter(r => r.value === 'student')
  return all.filter(r => r.value === 'student')
})

const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ id: null, username: '', realName: '', password: '', role: 'admin' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  realName: [{ required: true, message: '请输入真实姓名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}

async function loadData() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      role: filterRole.value || undefined,
      keyword: filterName.value || undefined
    }
    const res = await getList(params)
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
  } finally {
    loading.value = false
  }
}

function handleAdd() {
  isEdit.value = false
  form.role = roleOptions.value.length > 0 ? roleOptions.value[roleOptions.value.length - 1].value : 'student'
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  Object.assign(form, { id: row.id, username: row.username, realName: row.realName, password: '', role: row.role })
  dialogVisible.value = true
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确认删除账号"${row.username}"？`, '提示', { type: 'warning' })
    await remove(row.id)
    ElMessage.success('删除成功')
    loadData()
  } catch (e) {
    // cancelled
  }
}

function resetForm() {
  Object.assign(form, { id: null, username: '', realName: '', password: '', role: roleOptions.value.length > 0 ? roleOptions.value[roleOptions.value.length - 1].value : 'student' })
}

async function handleSubmit() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  submitLoading.value = true
  try {
    if (isEdit.value) {
      const data = { realName: form.realName, role: form.role }
      if (form.password) data.password = form.password
      await update(form.id, data)
      ElMessage.success('更新成功')
    } else {
      await create({ username: form.username, realName: form.realName, password: form.password, role: form.role })
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

function handleImport() {
  importDialogVisible.value = true
  importFile = null
}

function handleFileChange(file) {
  importFile = file.raw
}

async function doImport() {
  if (!importFile) {
    ElMessage.warning('请选择Excel文件')
    return
  }
  importLoading.value = true
  try {
    const XLSX = await import('xlsx')
    const reader = new FileReader()
    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws)
      const roleMap = { '超级管理员': 'super_admin', '导生管理员': 'admin', '书院辅导员': 'counselor', '宿生': 'student' }
      let successCount = 0
      for (const row of rows) {
        try {
          const role = roleMap[row['角色']] || row['角色'] || 'student'
          await create({
            username: row['账号'] || '',
            realName: row['真实姓名'] || '',
            password: row['密码'] || '',
            role: role
          })
          successCount++
        } catch (e) {}
      }
      ElMessage.success(`成功导入 ${successCount} 个账号`)
      importDialogVisible.value = false
      loadData()
      importLoading.value = false
    }
    reader.readAsArrayBuffer(importFile)
  } catch (e) {
    ElMessage.error('导入失败')
    importLoading.value = false
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

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.table-header-actions {
  display: flex;
  align-items: center;
  gap: 0;
}

.upload-tip {
  font-size: 12px;
  color: #999;
  margin-top: 8px;
}
</style>
