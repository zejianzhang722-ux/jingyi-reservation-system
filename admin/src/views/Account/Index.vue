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
        <el-table-column prop="username" :label="activeTab === 'student' ? '学号' : '账号'" width="150" />
        <el-table-column prop="realName" label="姓名" width="140" />
        <el-table-column v-if="activeTab === 'manager'" prop="role" label="角色" width="150">
          <template #default="{ row }">
            <el-tag :type="roleMap[row.role]?.type" size="small">{{ roleMap[row.role]?.label || row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="activeTab === 'manager'" prop="phone" label="联系电话" width="140">
          <template #default="{ row }">{{ row.phone || '-' }}</template>
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
        <el-table-column :label="activeTab === 'student' ? '所属楼栋' : '管理范围'" width="140">
          <template #default="{ row }">{{ activeTab === 'student' ? (row.buildingName || '未分配') : (row.scopeLabel || '待设置') }}</template>
        </el-table-column>
        <el-table-column v-if="activeTab === 'manager'" prop="lastLoginAt" label="最近登录" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.lastLoginAt || '暂无记录' }}</template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" min-width="170" show-overflow-tooltip />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" size="small" link @click="handleEdit(row)">编辑</el-button>
            <el-tag v-if="isCurrentAccount(row)" type="info" size="small">当前账号</el-tag>
            <el-button
              v-else
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
        :title="activeTab === 'student' ? '请使用宿生学号和一卡通号创建账号，并确认所属楼栋。' : '请根据实际职责选择管理角色和管理范围。'"
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
          <el-select v-model="form.role" style="width: 100%" :disabled="activeTab === 'student' || isEditingCurrentAccount" @change="handleRoleChange">
            <el-option v-for="opt in roleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="activeTab === 'student'" label="所属楼栋" prop="buildingId">
          <el-select v-model="form.buildingId" style="width: 100%" placeholder="请选择宿生所属楼栋">
            <el-option v-for="item in buildingOptions" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <template v-if="activeTab === 'manager'">
          <el-form-item label="数据范围" prop="scopeType">
            <el-select v-model="form.scopeType" style="width: 100%" :disabled="form.role !== 'admin'" @change="handleScopeChange">
              <el-option label="全院" value="global" />
              <el-option v-if="form.role === 'admin'" label="指定楼栋" value="building" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.role === 'admin' && form.scopeType === 'building'" label="指定楼栋" prop="buildingId">
            <el-select v-model="form.buildingId" style="width: 100%" placeholder="请选择楼栋">
              <el-option v-for="item in buildingOptions" :key="item.id" :label="item.name" :value="item.id" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item :label="activeTab === 'student' ? '一卡通号' : '密码'" :prop="isEdit ? '' : 'password'">
          <el-input v-model="form.password" type="password" :placeholder="isEdit ? '留空则不修改' : (activeTab === 'student' ? '请输入一卡通卡号' : '请输入初始密码')" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitLoading" :disabled="actionSubmitting" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" :title="activeTab === 'student' ? '导入宿生账号' : '导入管理账号'" width="620px">
      <el-upload ref="uploadRef" action="" :auto-upload="false" :on-change="handleFileChange" :on-remove="handleFileRemove" accept=".xlsx,.xls" :limit="1">
        <el-button type="primary">选择Excel文件</el-button>
        <template #tip>
          <div class="upload-tip">
            {{ activeTab === 'student'
              ? '宿生模板：账号（学号）、姓名、密码（一卡通卡号）、楼栋、电话。'
              : '管理账号模板：账号、姓名、密码、角色、管理范围（全院/指定楼栋）、楼栋、电话。辅导员和超级管理员固定为全院。' }}
          </div>
        </template>
      </el-upload>
      <div v-if="importResult" class="import-result">
        <el-alert
          :title="`导入完成：成功 ${importResult.successCount} 个，失败 ${importResult.failCount} 个`"
          :type="importFailures.length ? 'warning' : 'success'"
          :closable="false"
          show-icon
        >
          <template #default>成功项已保存，无需重复导入。</template>
        </el-alert>
        <div v-if="importFailures.length" class="import-failures">
          <div class="failure-heading">以下账号需要修改后重新导入</div>
          <div v-for="failure in importFailures" :key="`${failure.rowNumber}-${failure.username}`" class="failure-row">
            <span>第 {{ failure.rowNumber }} 行</span>
            <span>{{ failure.username || '未填写账号' }}</span>
            <span>{{ failure.reason }}</span>
          </div>
          <el-button class="reselect-button" @click="clearImportSelection">清空并重新选择</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="importLoading" :disabled="actionSubmitting || !!importResult" @click="doImport">确认导入</el-button>
      </template>
    </el-dialog>
  </PageShell>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue'
import { getList, create, update, remove, saveRows } from '@/api/account'
import { getBuildings } from '@/api/room'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/store/user'
import PageShell from '@/components/admin/PageShell.vue'
import FilterBar from '@/components/admin/FilterBar.vue'
import { createActionLock, runLockedConfirmedAction } from '@/utils/approvalState'
import { createLatestRequest } from '@/utils/latestRequest'
import { normalizeAccountImportRows, readAccountImportWorkbook } from '@/utils/accountImport'

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
const uploadRef = ref(null)
const importResult = ref(null)
const actionSubmitting = ref(false)
const actionLock = createActionLock()
const accountRequest = createLatestRequest()
const buildingOptions = ref([])
let importFile = null
const importFailures = computed(() => (importResult.value?.results || []).filter(item => item.status === 'failed'))

const filters = reactive({ keyword: '', role: '', status: '' })
const pagination = reactive({ page: 1, pageSize: 10, total: 0 })
const form = reactive({ id: null, username: '', realName: '', password: '', role: 'student', scopeType: 'global', buildingId: null })
const isEditingCurrentAccount = computed(() => isEdit.value && String(form.id) === `admin-${userStore.userInfo?.id}`)

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
  role: [{ required: true, message: '请选择角色', trigger: 'change' }],
  scopeType: [{ required: activeTab.value === 'manager', message: '请选择数据范围', trigger: 'change' }],
  buildingId: [{ required: activeTab.value === 'student' || (form.role === 'admin' && form.scopeType === 'building'), message: '请选择楼栋', trigger: 'change' }]
}))

async function loadData() {
  loading.value = true
  const params = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    accountType: activeTab.value === 'manager' ? 'manager' : 'student',
    role: activeTab.value === 'student' ? 'student' : (filters.role || undefined),
    status: filters.status || undefined,
    keyword: filters.keyword || undefined
  }
  return accountRequest.run(getList(params), res => {
    tableData.value = res.data?.list || []
    pagination.total = res.data?.total || 0
    loading.value = false
  }, () => {
    loading.value = false
  })
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
  Object.assign(form, { id: row.id, username: row.username, realName: row.realName, password: '', role: row.role, scopeType: row.scopeType || 'global', buildingId: row.buildingId || null })
  dialogVisible.value = true
}

async function handleDelete(row) {
  const impact = row.accountType === 'student'
    ? '停用后，该宿生将无法登录和发起预约，已有记录会保留。'
    : '停用后，该账号将无法登录后台和处理管理工作，已有记录会保留。'
  await runLockedConfirmedAction(actionLock, {
    confirm: () => ElMessageBox.confirm(`确认停用账号“${row.username}”？${impact}`, '停用账号', { type: 'warning', confirmButtonText: '确认停用' }),
    action: () => remove(row.id),
    onSuccess: () => {
      ElMessage.success('已停用')
      loadData()
    },
    onStateChange: value => { actionSubmitting.value = value }
  })
}

function isCurrentAccount(row) {
  return row.accountType === 'manager' && Number(row.rawId) === Number(userStore.userInfo?.id)
}

function resetForm() {
  Object.assign(form, { id: null, username: '', realName: '', password: '', role: defaultRole(), scopeType: 'global', buildingId: null })
}

function handleRoleChange(role) {
  if (role !== 'admin') Object.assign(form, { scopeType: 'global', buildingId: null })
}

function handleScopeChange(scopeType) {
  if (scopeType === 'global') form.buildingId = null
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
      const data = { realName: form.realName, scopeType: form.scopeType, buildingId: form.buildingId }
      if (!isEditingCurrentAccount.value) data.role = form.role
      if (form.password) data.password = form.password
      await update(form.id, data)
      ElMessage.success('更新成功')
    } else {
      await create({ accountType: activeTab.value, username: form.username, realName: form.realName, password: form.password, role: form.role, scopeType: form.scopeType, buildingId: form.buildingId })
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
  clearImportSelection()
}

function handleFileChange(file) {
  importFile = file.raw
  importResult.value = null
}

function handleFileRemove() {
  importFile = null
  importResult.value = null
}

function clearImportSelection() {
  importFile = null
  importResult.value = null
  uploadRef.value?.clearFiles()
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
    const rows = readAccountImportWorkbook(XLSX, dataBuffer)
    const normalizedRows = normalizeAccountImportRows(rows, activeTab.value)
    const res = await saveRows(normalizedRows)
    const data = res.data || {}
    const failures = (data.results || []).filter(item => item.status === 'failed')
    importResult.value = {
      successCount: data.successCount || 0,
      failCount: data.failCount || 0,
      results: data.results || []
    }
    if (failures.length === 0) {
      importDialogVisible.value = false
      ElMessage.success(`导入完成：成功 ${data.successCount || 0} 个`)
    } else {
      ElMessage.warning('部分账号未导入，请查看并修改失败项')
    }
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
  getBuildings({ pageSize: 100 }).then(res => { buildingOptions.value = res.data?.list || res.data || [] }).catch(() => {})
})

onBeforeUnmount(() => {
  accountRequest.invalidate()
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

.import-result {
  margin-top: 16px;
}

.import-failures {
  margin-top: 12px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--jy-border, #E8E8EF);
  border-radius: 8px;
  padding: 12px;
}

.failure-heading {
  margin-bottom: 8px;
  font-weight: 700;
}

.failure-row {
  display: grid;
  grid-template-columns: 76px 140px minmax(0, 1fr);
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--jy-border-light, #F0F0F5);
  font-size: 13px;
}

.failure-row:last-of-type {
  border-bottom: 0;
}

.reselect-button {
  margin-top: 12px;
}

.credit-score {
  color: var(--jy-success, #52C41A);
  font-weight: 700;
}

.credit-score.danger {
  color: var(--jy-danger, #FF4D4F);
}
</style>

