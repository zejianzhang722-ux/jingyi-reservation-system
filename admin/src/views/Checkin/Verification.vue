<template>
  <PageShell title="扫码核验与签到" eyebrow="扫码与现场服务" description="核对预约与现场身份，确认通过即办理签到，预约状态同步更新。异常不签到，重复扫码不重复办理。">
    <el-alert :title="scopeText" type="info" :closable="false" show-icon />
    <div class="day-summary">
      <div class="summary-cell"><span>当日预约</span><strong>{{ summary.total }}</strong><small>{{ reservationDate }} · 负责范围内</small></div>
      <button class="summary-cell waiting" @click="setStatus('approved')"><span>待签到</span><strong>{{ summary.waiting }}</strong><small>点击查看待到场预约</small></button>
      <button class="summary-cell checked" @click="setStatus('checked_in')"><span>使用中 · 已签到</span><strong>{{ summary.checkedIn }}</strong><small>已办理签到的预约</small></button>
      <button class="summary-cell" @click="setStatus('completed')"><span>已完成</span><strong>{{ summary.finished }}</strong><small>已结束使用的预约</small></button>
    </div>
    <el-card shadow="never" class="reservation-board">
      <div class="board-heading"><div><h3>负责楼栋的预约</h3><p>先了解预约安排，再扫描宿生出示的动态码办理签到。</p></div><el-button @click="refreshReservations" :loading="reservationBusy">刷新预约</el-button></div>
      <div class="filters">
        <el-date-picker v-model="reservationDate" type="date" value-format="YYYY-MM-DD" :clearable="false" @change="refreshReservations" />
        <el-select v-model="reservationStatus" clearable placeholder="全部预约状态" @change="refreshReservations"><el-option v-for="(label, value) in statusLabels" :key="value" :label="label" :value="value" /></el-select>
        <el-input v-model="reservationSearch" clearable placeholder="搜索预约人、学号、功能房或编号" @keyup.enter="refreshReservations" @clear="refreshReservations" class="reservation-search" />
        <el-button @click="refreshReservations">搜索</el-button>
      </div>
      <el-alert v-if="reservationError" :title="reservationError" type="error" :closable="false" />
      <div v-loading="reservationBusy" class="reservation-cards">
        <article v-for="item in reservations" :key="item.id" class="reservation-card" :class="item.status">
          <div class="reservation-top"><span class="reservation-number">预约 #{{ item.id }}</span><el-tag :type="statusTone(item.status)" effect="light">{{ statusLabels[item.status] || '状态待确认' }}</el-tag></div>
          <h4>{{ item.roomName }}</h4><div class="reservation-time">{{ item.startTime?.slice(0, 5) }} <span>—</span> {{ item.endTime?.slice(0, 5) }}</div>
          <div class="reservation-person">{{ item.name }} <span>{{ item.studentId }}</span></div>
          <div class="reservation-purpose">{{ item.purpose }} · {{ item.participants }} 人</div>
          <footer><span>{{ item.buildingName || '负责楼栋' }} · {{ item.date }}</span><el-button link type="primary" @click="showReservation(item)">查看详情</el-button></footer>
        </article>
      </div>
      <el-empty v-if="!reservationBusy && !reservationError && !reservations.length" description="当前条件下暂无预约，请调整日期或筛选条件" :image-size="80" />
      <el-pagination v-model:current-page="reservationPage" :total="reservationTotal" :page-size="12" layout="total, prev, pager, next" @current-change="fetchReservations" class="message" />
    </el-card>
    <el-dialog v-model="detailVisible" title="预约信息" width="min(520px, 92vw)">
      <el-descriptions v-if="selectedReservation" :column="1" border>
        <el-descriptions-item label="预约编号">#{{ selectedReservation.id }}</el-descriptions-item>
        <el-descriptions-item label="预约人">{{ selectedReservation.name }} · {{ selectedReservation.studentId }}</el-descriptions-item>
        <el-descriptions-item label="功能房">{{ selectedReservation.buildingName }} · {{ selectedReservation.roomName }}</el-descriptions-item>
        <el-descriptions-item label="时段">{{ selectedReservation.date }} {{ selectedReservation.startTime }}—{{ selectedReservation.endTime }}</el-descriptions-item>
        <el-descriptions-item label="用途 / 人数">{{ selectedReservation.purpose }} / {{ selectedReservation.participants }}人</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabels[selectedReservation.status] }}</el-descriptions-item>
      </el-descriptions><p>查看预约不等于签到，请现场核对身份并扫描当前动态二维码。</p>
    </el-dialog>
    <div class="verification-grid">
      <el-card shadow="never">
        <h3>扫描宿生动态预约码</h3>
        <p>请让宿生打开预约凭证。也可使用扫码枪，或粘贴完整二维码内容。</p>
        <video v-show="cameraActive" ref="video" class="camera" muted playsinline />
        <el-button @click="startCamera" :disabled="busy || cameraActive || uncertain">打开摄像头扫码</el-button>
        <el-button v-if="cameraActive" @click="stopCamera">停止摄像头</el-button>
        <el-input v-model="credential" type="textarea" :rows="3" placeholder="扫码枪输入或粘贴动态二维码内容" :disabled="busy || uncertain" class="credential-input" />
        <el-button type="primary" :loading="busy" :disabled="uncertain" @click="preview">读取预约</el-button>
        <el-alert v-if="error" :title="error" type="error" :closable="false" class="message" />
        <template v-if="result">
          <el-alert :title="result.message" :type="result.outcome === 'passed' || result.outcome === 'duplicate' ? 'success' : result.eligible ? 'info' : 'warning'" :closable="false" class="message" />
          <el-descriptions v-if="result.reservation" :column="1" border class="message">
            <el-descriptions-item label="预约编号">{{ result.reservation.id }}</el-descriptions-item>
            <el-descriptions-item label="预约人">{{ result.reservation.name }} · {{ result.reservation.studentId }}</el-descriptions-item>
            <el-descriptions-item label="功能房">{{ result.reservation.roomName }}</el-descriptions-item>
            <el-descriptions-item label="时段">{{ result.reservation.date }} {{ result.reservation.startTime }}—{{ result.reservation.endTime }}</el-descriptions-item>
            <el-descriptions-item label="预约状态">{{ statusLabels[result.reservation.status] || '状态待确认' }}</el-descriptions-item>
          </el-descriptions>
          <div v-if="result.reservation && !done" class="message">
            <el-checkbox v-model="identityConfirmed">已核对现场身份，与预约人一致</el-checkbox>
            <el-input v-model="note" maxlength="500" show-word-limit placeholder="异常情况或现场备注" />
            <div class="message">
              <el-button type="success" :disabled="!result.eligible || result.verified || !identityConfirmed" :loading="busy" @click="confirm('pass')">核验通过并签到</el-button>
              <el-button type="warning" :disabled="note.trim().length < 2" :loading="busy" @click="confirm('exception')">登记异常</el-button>
            </div>
          </div>
          <p v-if="uncertain">上次提交未收到结果。重试将查询原操作结果，不会重复签到。</p>
          <el-button v-if="uncertain" type="primary" :loading="busy" @click="confirm(pendingDecision)">重试上次操作</el-button>
        </template>
      </el-card>
      <el-card shadow="never">
        <h3>核验记录与异常跟进</h3>
        <div class="filters">
          <el-select v-model="outcome" clearable placeholder="全部结果" @change="loadRecords">
            <el-option v-for="(label, key) in labels" :key="key" :label="label" :value="key" />
          </el-select>
          <el-input v-model="reservationId" placeholder="预约编号" clearable @keyup.enter="loadRecords" />
          <el-date-picker v-model="dates" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" @change="loadRecords" />
          <el-button :loading="recordsBusy" @click="loadRecords">查询 / 刷新</el-button>
        </div>
        <el-alert v-if="recordsError" :title="recordsError" type="error" :closable="false" />
        <el-table :data="records" v-loading="recordsBusy">
          <el-table-column prop="createdAt" label="时间" min-width="170" />
          <el-table-column prop="reservationId" label="预约" width="75" />
          <el-table-column label="结果" width="95"><template #default="{ row }">{{ labels[row.outcome] || row.outcome }}</template></el-table-column>
          <el-table-column label="说明" min-width="180"><template #default="{ row }">{{ row.note || row.result?.message }}<p v-if="row.resolution">处理：{{ row.resolution }}</p></template></el-table-column>
          <el-table-column label="跟进" width="110"><template #default="{ row }">
            <span v-if="row.resolvedAt">已处理</span>
            <el-button v-else-if="canResolve && ['exception', 'rejected'].includes(row.outcome)" link type="primary" @click="resolve(row)">填写处理结果</el-button>
            <span v-else-if="['exception', 'rejected'].includes(row.outcome)">待上级处理</span>
          </template></el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="total, prev, pager, next" @current-change="fetchRecords" class="message" />
      </el-card>
    </div>
  </PageShell>
</template>
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { BrowserQRCodeReader } from '@zxing/browser'
import request from '@/utils/request'
import PageShell from '@/components/admin/PageShell.vue'
const credential = ref(''), busy = ref(false), error = ref(''), result = ref(null), identityConfirmed = ref(false), note = ref(''), done = ref(false), uncertain = ref(false)
const cameraActive = ref(false), video = ref(null), records = ref([]), recordsBusy = ref(false), recordsError = ref(''), outcome = ref(''), reservationId = ref(''), dates = ref([]), page = ref(1), total = ref(0), me = ref(null)
const canResolve = computed(() => me.value?.canResolve === true)
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const reservationDate = ref(localDate()), reservationStatus = ref(''), reservationSearch = ref(''), reservations = ref([]), summary = ref({ total: 0, waiting: 0, checkedIn: 0, finished: 0 }), reservationBusy = ref(false), reservationError = ref(''), reservationPage = ref(1), reservationTotal = ref(0), detailVisible = ref(false), selectedReservation = ref(null)
const statusLabels = { approved: '待签到', checked_in: '使用中 · 已签到', completed: '已完成', pending: '待审核', counselor_pending: '待辅导员审核', cancelled: '已取消', rejected: '未通过', noshow: '未到场' }
const statusTone = status => ({ approved: 'warning', checked_in: 'success', pending: 'info', counselor_pending: 'info', rejected: 'danger', noshow: 'danger' }[status] || 'info')
let reservationVersion = 0
function setStatus(status) { reservationStatus.value = status; refreshReservations() }
function showReservation(item) { selectedReservation.value = item; detailVisible.value = true }
function refreshReservations() { reservationPage.value = 1; return fetchReservations() }
async function fetchReservations() {
  const version = ++reservationVersion; reservationBusy.value = true; reservationError.value = ''
  try { const res = await request.get('/verification/reservations', { params: { date: reservationDate.value, status: reservationStatus.value, q: reservationSearch.value, page: reservationPage.value } }); if (!disposed && version === reservationVersion) { reservations.value = res.data.list; reservationTotal.value = res.data.total; summary.value = res.data.summary } }
  catch { if (!disposed && version === reservationVersion) { reservations.value = []; summary.value = { total: 0, waiting: 0, checkedIn: 0, finished: 0 }; reservationError.value = '预约加载失败，请刷新重试' } }
  finally { if (version === reservationVersion) reservationBusy.value = false }
}
const scopeText = computed(() => me.value ? me.value.isGlobal ? '可查看全院核验记录。异常处理必须填写说明。' : `仅可核验和查询 ${me.value.buildingName} 的功能房预约；其他楼栋不可见。` : '正在加载岗位权限…')
const labels = { ready: '待现场确认', passed: '核验通过', duplicate: '重复核验', exception: '现场异常', rejected: '核验失败' }
const key = () => 'web_' + crypto.randomUUID().replaceAll('-', '')
let scanKey = '', confirmKey = '', pendingDecision = '', pendingPayload = null, scanValue = '', controls, timer, disposed = false, recordVersion = 0
async function preview() {
  if (busy.value || !credential.value.trim()) return
  if (uncertain.value) { ElMessage.warning('请先重试上次签到操作，确认结果后再读取其他预约'); return }
  scanValue = credential.value.trim(); scanKey = key(); confirmKey = ''; pendingDecision = ''; pendingPayload = null
  busy.value = true; error.value = ''; done.value = false; result.value = null; identityConfirmed.value = false
  try { const res = await request.post('/verification/preview', { credential: scanValue, requestId: scanKey }); if (!disposed) result.value = res.data }
  catch (e) { if (!disposed) error.value = e.message || '读取失败，请检查网络后重试' }
  finally { busy.value = false; loadRecords(); fetchReservations() }
}
async function confirm(decision) {
  if (busy.value || done.value) return
  if (uncertain.value && pendingDecision !== decision) { ElMessage.warning('请先重试上次操作，确认其结果后再进行下一步'); return }
  if (!confirmKey) { confirmKey = key(); pendingDecision = decision; pendingPayload = { credential: scanValue, requestId: confirmKey, decision, identityConfirmed: identityConfirmed.value, note: note.value } }
  busy.value = true; error.value = ''
  try {
    const res = await request.post('/verification/confirm', pendingPayload)
    if (!disposed) { result.value = res.data; done.value = true; uncertain.value = false }
  } catch (e) { if (!disposed) { uncertain.value = true; error.value = '未确认提交结果，请使用同一按钮重试：' + (e.message || '网络异常') } }
  finally { busy.value = false; loadRecords(); fetchReservations() }
}
async function startCamera() {
  if (uncertain.value || busy.value) return
  error.value = ''; cameraActive.value = true
  try {
    const reader = new BrowserQRCodeReader()
    controls = await reader.decodeFromVideoDevice(undefined, video.value, (code, _, cameraControls) => {
      if (code && !busy.value && !disposed) { cameraControls.stop(); cameraActive.value = false; credential.value = code.getText(); scanKey = ''; preview() }
    })
    if (disposed || !cameraActive.value) controls.stop()
  } catch (e) { cameraActive.value = false; error.value = '摄像头不可用或未获授权，请用扫码枪或粘贴完整二维码内容'; request.post('/verification/failure', { requestId: key(), reason: 'camera_denied' }).catch(() => {}) }
}
function stopCamera() { controls?.stop(); controls = null; cameraActive.value = false }
function loadRecords() { page.value = 1; return fetchRecords() }
async function fetchRecords() {
  const version = ++recordVersion; recordsBusy.value = true; recordsError.value = ''
  try { const res = await request.get('/verification/records', { params: { page: page.value, outcome: outcome.value, reservationId: reservationId.value, from: dates.value?.[0], to: dates.value?.[1] } }); if (!disposed && version === recordVersion) { records.value = res.data.list; total.value = res.data.total } }
  catch { if (!disposed && version === recordVersion) recordsError.value = '记录加载失败，请点击刷新重试' }
  finally { if (version === recordVersion) recordsBusy.value = false }
}
async function resolve(row) {
  try { const answer = await ElMessageBox.prompt('填写处理经过与结论，原核验结果将继续留存。', '跟进异常', { inputValidator: value => value?.trim().length >= 2 && value.trim().length <= 500 || '请填写2至500字' }); await request.post(`/verification/records/${row.id}/resolve`, { note: answer.value }); await fetchRecords() } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(e.message || '处理未成功，请重试') }
}
onMounted(async () => { try { me.value = (await request.get('/verification/me')).data } catch { error.value = '岗位权限加载失败，请重新登录' }; await Promise.all([fetchRecords(), fetchReservations()]); timer = setInterval(() => { if (!document.hidden) { if (!recordsBusy.value) fetchRecords(); if (!reservationBusy.value) fetchReservations() } }, 15000) })
onBeforeUnmount(() => { disposed = true; clearInterval(timer); stopCamera() })
</script>
<style scoped>
.day-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.summary-cell{border:1px solid #dce6ec;border-radius:14px;padding:20px 22px;background:#fff;text-align:left;color:#234555;font:inherit;display:flex;flex-direction:column;gap:9px}button.summary-cell{cursor:pointer;transition:transform .15s,border-color .15s}button.summary-cell:hover{transform:translateY(-2px);border-color:#348b83}.summary-cell strong{font-size:34px;line-height:1;font-variant-numeric:tabular-nums}.summary-cell small{font-size:12px;color:#748a96}.summary-cell.waiting{background:#fff8e9;border-color:#f1dfb8}.summary-cell.checked{background:#eaf7f2;border-color:#c4e5d8}.board-heading{display:flex;justify-content:space-between;gap:16px;align-items:start}.board-heading p{margin:0 0 20px;font-size:13px}.reservation-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;min-height:80px}.reservation-card{padding:18px;border:1px solid #dce7ec;border-radius:14px;background:linear-gradient(135deg,#fff,#f7fafb);border-top:3px solid #bfd0d9}.reservation-card.approved{border-top-color:#d8a43b}.reservation-card.checked_in{border-top-color:#339984}.reservation-top{display:flex;align-items:center;justify-content:space-between;gap:10px}.reservation-number{font-size:12px;color:#82939c}.reservation-card h4{font-size:18px;margin:18px 0 10px;color:#193d51}.reservation-time{font-size:24px;letter-spacing:1px;font-weight:600;color:#234555}.reservation-time span{color:#9aacb5;font-size:17px}.reservation-person{margin-top:16px;font-size:15px;font-weight:600}.reservation-person span{font-size:12px;font-weight:400;color:#7a8e99;margin-left:8px}.reservation-purpose{font-size:13px;color:#607d8b;margin-top:8px}.reservation-card footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:18px;padding-top:12px;border-top:1px solid #e7eef2;font-size:12px;color:#82939c}.filters .reservation-search{width:280px}@media(max-width:1200px){.reservation-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:700px){.day-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.reservation-cards{grid-template-columns:1fr}.summary-cell{padding:16px}.board-heading{flex-direction:column}}
.verification-grid{display:grid;grid-template-columns:minmax(300px, .9fr) minmax(440px, 1.4fr);gap:20px;margin-top:20px}.camera{width:100%;max-height:300px;border-radius:12px;background:#102d3b}.credential-input,.message{margin-top:16px}.filters{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.filters .el-input{width:140px}.filters .el-select{width:145px}h3{margin:0 0 14px}p{color:#647887;line-height:1.7}@media(max-width:1100px){.verification-grid{grid-template-columns:1fr}}
</style>
