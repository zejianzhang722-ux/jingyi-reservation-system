<template>
  <PageShell
    title="账号管理"
    eyebrow="账号与权限"
    description="宿生账号和管理账号分开维护，避免账号类型混淆，并按当前角色限制可操作范围。"
  >
    <template #actions>
      <el-button type="success" @click="handleImport">
        <el-icon><Upload /></el-icon>导入Excel
      </el-button>
      <el-button type="primary" @click="handleAdd">
        <el-icon><Plus /></el-icon>新增账号
      </el-button>
    </template>

    <el-row :gutter="16">
      <el-col :xs="24" :sm="8">
        <MetricCard label="当前角色" :value="roleLabel" caption="菜单和操作已按角色裁剪" icon="UserFilled" tone="primary" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="当前页签" :value="activeTab === 'student' ? '宿生账号' : '管理账号'" caption="不同账号写入不同数据表" icon="Tickets" tone="success" />
      </el-col>
      <el-col :xs="24" :sm="8">
        <MetricCard label="列表总数" :value="pagination.total" caption="按筛选条件实时统计" icon="DataAnalysis" tone="warning" />
      </el-col>
    </el-row>

    <el-card shadow="never" class="account-card">
      <el-tabs v-model="activeTab" @tab-change="handleTabChange">
        <el-tab-pane label="宿生账号" name="student" />
        <el-tab-pane label="管理账号" name="manager" />
      </el-tabs>

      <FilterBar @search="loadData" @reset="resetFilters">
        <el-input v-model="filters.keyword" placeholder="搜索账号/姓名/学号" clearable style="width: 220px" @keyup.enter="loadData" />
        <el-select v-if="activeTab === 'manager'" v-model="filters.role" placeholder="角色筛选" clearable style="width: 180px">
          <el-option label="超级管理员" value="super_admin" />
          <el-option label="导生管理员" value="admin" />
          <el-option label="书院辅导员" value="counselor" />
        </el-select>
        <el-select v-model="filters.status" placeholder="状态筛选" clearable style="width: 150px">
          <el-option label="正常" value="active" />
          <el-option label="停用/封禁" value="disabled" />
          <el-option label="受限" value="restricted" v-if="activeTab === 'student'" />
        </el-select>
      </FilterBar>

      <el-table :data="tableData" v-loading="loading" stripe class="account-table">
        <el-table-column prop="id" label="账号ID" width="110" />
        <el-table-column prop="username" :label="activeTab === 'student' ? '学号' : '账号'" width="150" />
        <el-table-column prop="realName" label="姓名" width="140" />
        <el-table-column prop="role" label="角色" width="150">
          <template #default="{ row }">
            <el-tag :type="roleMap[row.role]?.type" size="small">{{ roleMap[row.role]?.label || row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="activeTab === 'student'" prop="creditScore" label="信用分" width="100">
          <template #default="{ row }">
            <span :class="['credit-score', { danger: Number(row.creditScore) < 60 }]">{{ row.creditScore ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusMap[row.status]?.type || 'info'" size="small">{{ statusMap[row.status]?.label || row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="buildingId" label="楼栋范围" width="110">
          <template #default="{ row }">{{ row.buildingId || '全局/未分配' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="170" show-overflow-tooltip />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-button
              type="danger"
              size="small"
              link
              @click="handleDelete(row)"
              :disabled="actionSubmitting || row.role === 'super_admin'"
            >停用</el-button>
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

    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑账号' : '新增账号'" width="520px" @close="resetForm">
      <el-alert
        :title="activeTab === 'student' ? '宿生账号将写入 users 表，密码字段对应一卡通卡号。' : '管理账号将写入 admins 表，请按职责选择角色和楼栋范围。'"
        type="info"
        show-icon
        :closable="false"
        class="form-alert"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item :label="activeTab === 'student' ? '学号' : '账号'" prop="username">
          <el-input v-model="form.username" :placeholder="activeTab === 'student' ? '请输入宿生学号' : '请输入管理账号'" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="真实姓名" prop="realName">
          <el-input v-model="form.realName" placeholder="请输入真实姓名" />
        </el-form-item>
        <el-form-item label="角色" prop="role">
          <el-select v-model="form.role" style="width: 100%" :disabled="activeTab === 'student'">
            <el-option v-for="opt in roleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="activeTab === 'student' ? '一卡通号' : '密码'" :prop="isEdit ? '' : 'password'">
          <el-input v-model="form.password" type="password" :placeholder="isEdit ? '留空则不修改' : (activeTab === 'student' ? '请输入一卡通卡号' : '请输入初始密码')" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" :disabled="actionSubmitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" :title="activeTab === 'student' ? '导入宿生账号' : '导入管理账号'" width="520px">
      <el-upload ref="uploadRef" action="" :auto-upload="false" :on-change="handleFileChange" accept=".xlsx,.xls" :limit="1">
        <el-button type="primary">选择Excel文件</el-button>
        <template #tip>
          <div class="upload-tip">
            {{ activeTab === 'student'
              ? '宿生模板：真实姓名、账号（学号）、密码（一卡通卡号）。角色可省略，默认宿生。'
              : '管理账号模板：真实姓名、角色（超级管理员/导生管理员/书院辅导员）、账号、密码。' }}
          </div>
        </template>
      </el-upload>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importLoading" :disabled="actionSubmitting" @click="doImport">确认导入</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { getList, create, update, remove, saveRows } from '@/api/account'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import MetricCard from '@/components/admin/MetricCard.vue'
import { createActionLock } from '@/utils/approvalState'

const userStore = useUserStore()
const currentRole = computed(() => userStore.userInfo?.role || 'admin')
const activeTab = ref('student')
const loading = ref(false)
const submitLoading = ref(false)
const tableData = ref([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const formRef = ref(null)
const importDialogVisible = ref(false)
const importLoading = ref(false)
const actionSubmitting = ref(false)
const actionLock = createActionLock()
let importFile = null

const filters = reactive({ keyword: '', role: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ id: null, username: '', realName: '', password: '', role: 'student' })

const roleMap = {
  super_admin: { label: '超级管理员', type: 'danger' },
  admin: { label: '导生管理员', type: '' },
  counselor: { label: '辅导员', type: 'success' },
  student: { label: '宿生', type: 'info' }
}

const statusMap = {
  active: { label: '正常', type: 'success' },
  disabled: { label: '停用', type: 'danger' },
  inactive: { label: '停用', type: 'danger' },
  banned: { label: '封禁', type: 'danger' },
  restricted: { label: '受限', type: 'warning' }
}

const roleLabel = computed(() => roleMap[currentRole.value]?.label || '管理员')

const roleOptions = computed(() => {
  if (activeTab.value === 'student') return [{ label: '宿生', value: 'student' }]
  const all = [
    { label: '超级管理员', value: 'super_admin' },
    { label: '导生管理员', value: 'admin' },
    { label: '辅导员', value: 'counselor' }
  ]
  if (currentRole.value === 'super_admin') return all
  if (currentRole.value === 'counselor') return all.filter(r => r.value === 'admin')
  return []
})

const rules = computed(() => ({
  username: [{ required: true, message: activeTab.value === 'student' ? '请输入学号' : '请输入账号', trigger: 'blur' }],
  realName: [{ required: true, message: '请输入真实姓名', trigger: 'blur' }],
  password: [{ required: !isEdit.value, message: activeTab.value === 'student' ? '请输入一卡通卡号' : '请输入密码', trigger: 'blur' }],
  role: [{ required: true, message: '请选择角色', trigger: 'change' }]
}))

async function loadData() {
  loading.value = true
  try {
    const params = {
      page: pagination.page,
      pageSize: pagination.pageSize,
      role: activeTab.value === 'student' ? 'student' : (filters.role || undefined),
      status: filters.status || undefined,
      keyword: filters.keyword || undefined
    }
    const res = await getList(params)
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
  } catch (e) {
    // Keep the last successful total visible during a transient refresh failure.
  } finally {
    loading.value = false
  }
}

function handleTabChange() {
  filters.role = ''
  pagination.page = 1
  resetForm()
  loadData()
}

function resetFilters() {
  filters.keyword = ''
  filters.role = ''
  filters.status = ''
  pagination.page = 1
  loadData()
}

function defaultRole() {
  return activeTab.value === 'student' ? 'student' : (roleOptions.value[roleOptions.value.length - 1]?.value || 'admin')
}

function handleAdd() {
  isEdit.value = false
  resetForm()
  dialogVisible.value = true
}

function handleEdit(row) {
  isEdit.value = true
  Object.assign(form, { id: row.id, username: row.username, realName: row.realName, password: '', role: row.role })
  dialogVisible.value = true
}

async function handleDelete(row) {
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  try {
    await ElMessageBox.confirm(`确认停用账号“${row.username}”？`, '提示', { type: 'warning' })
    await remove(row.id)
    ElMessage.success('已停用')
    loadData()
  } catch (e) {
    // cancelled
  } finally {
    actionSubmitting.value = false
    actionLock.release(token)
  }
}

function resetForm() {
  Object.assign(form, { id: null, username: '', realName: '', password: '', role: defaultRole() })
}

async function handleSubmit() {
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  try {
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return
    submitLoading.value = true
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
    // handled by interceptor
  } finally {
    submitLoading.value = false
    actionSubmitting.value = false
    actionLock.release(token)
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
  const token = actionLock.acquire()
  if (!token) return
  actionSubmitting.value = true
  if (!importFile) {
    ElMessage.warning('请选择Excel文件')
    actionSubmitting.value = false
    actionLock.release(token)
    return
  }
  importLoading.value = true
  try {
    const XLSX = await import('xlsx')
    const dataBuffer = await importFile.arrayBuffer()
    const wb = XLSX.read(dataBuffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(ws)
    const excelRoleMap = { '超级管理员': 'super_admin', '导生管理员': 'admin', '书院辅导员': 'counselor', '宿生': 'student' }
    const normalizedRows = rows.map(row => ({
      username: row['账号'] || row['学号'] || '',
      realName: row['真实姓名'] || row['姓名'] || '',
      password: row['密码'] || row['一卡通卡号'] || '',
      role: activeTab.value === 'student' ? 'student' : (excelRoleMap[row['角色']] || row['角色'] || 'admin')
    }))
    const res = await saveRows(normalizedRows)
    const data = res.data || {}
    ElMessage.success(`导入完成：成功 ${data.successCount || 0} 个，失败 ${data.failCount || 0} 个`)
    importDialogVisible.value = false
    loadData()
  } catch (e) {
    ElMessage.error('导入失败')
  } finally {
    importLoading.value = false
    actionSubmitting.value = false
    actionLock.release(token)
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.account-card :deep(.el-card__body) {
  padding-top: 12px;
}

.account-table {
  margin-top: 16px;
}

.pagination-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.form-alert {
  margin-bottom: 16px;
}

.upload-tip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--jy-text-secondary, #8C8C9A);
  line-height: 1.6;
}

.credit-score {
  color: var(--jy-success, #52C41A);
  font-weight: 700;
}

.credit-score.danger {
  color: var(--jy-danger, #FF4D4F);
}
</style>

