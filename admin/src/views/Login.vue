<template>
  <div class="login-container" :style="loginVars" @mousemove="handlePointer" @mouseleave="resetPointer">
    <div class="aurora-layer"></div>
    <div class="grid-layer"></div>
    <div class="beam-layer"></div>
    <div class="constellation-layer">
      <span v-for="dot in dots" :key="dot.id" class="star-dot" :style="dot.style"></span>
    </div>

    <div class="login-stage">
      <section class="brand-panel">
        <div class="brand-kicker">
          <span class="kicker-dot"></span>
          JINGYI RESERVATION PLATFORM
        </div>

        <div class="hero-copy">
          <h1>
            敬一书院
            <span>功能房预约平台</span>
          </h1>
          <p>面向书院空间运营的统一后台：预约审核、签到核销、信用治理、空间维护与运营统计在一个界面内完成。</p>
        </div>

        <div class="brand-orbit" aria-hidden="true">
          <div class="orbit-ring ring-main"></div>
          <div class="orbit-ring ring-inner"></div>
          <div class="orbit-core">敬</div>
          <div class="orbit-node node-a"></div>
          <div class="orbit-node node-b"></div>
          <div class="orbit-node node-c"></div>
        </div>

        <div class="feature-stack">
          <div class="feature-card" v-for="(item, index) in featureCards" :key="item.title" :style="{ animationDelay: `${260 + index * 90}ms` }">
            <el-icon><component :is="item.icon" /></el-icon>
            <div>
              <strong>{{ item.title }}</strong>
              <span>{{ item.desc }}</span>
            </div>
          </div>
        </div>
      </section>

      <section class="login-card" :class="{ shake: loginError }">
        <div class="card-glow"></div>
        <div class="card-noise"></div>

        <div class="login-header">
          <div class="login-logo">
            <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="login-logo-svg">
              <rect x="3" y="6" width="34" height="28" rx="4" stroke="#C4943A" stroke-width="1.8" fill="none"/>
              <path d="M10 14h20M10 19h20M10 24h12" stroke="#C4943A" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M20 2v6M15 3v5M25 3v5" stroke="#C4943A" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="login-eyebrow">ADMIN CONSOLE</div>
          <h2 class="login-title">欢迎回来</h2>
          <p class="login-subtitle">继续管理预约、空间与书院运营数据</p>
        </div>

        <div class="secure-strip">
          <span><i></i>安全连接</span>
          <span><i></i>权限自动识别</span>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" class="login-form" @keyup.enter="handleLogin">
          <el-form-item prop="username" class="form-field">
            <label class="field-label">管理员账号</label>
            <el-input v-model="form.username" placeholder="请输入账号" size="large" prefix-icon="User" autocomplete="username" />
          </el-form-item>
          <el-form-item prop="password" class="form-field">
            <label class="field-label">登录密码</label>
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" prefix-icon="Lock" show-password autocomplete="current-password" />
          </el-form-item>

          <el-form-item class="submit-item">
            <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="handleLogin">
              <span class="btn-label">{{ loading ? '正在进入' : '进入后台' }}</span>
            </el-button>
          </el-form-item>
        </el-form>

        <div class="card-footer">
          <span>JINGYI COLLEGE</span>
          <span>Space Operations Center</span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)
const loginError = ref(false)
const pointer = reactive({ x: 0, y: 0 })

const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

const featureCards = [
  { title: '预约运营', desc: '审核、签到、冲突处理', icon: 'Calendar' },
  { title: '空间管理', desc: '楼栋、功能房、座位维护', icon: 'OfficeBuilding' },
  { title: '信用治理', desc: '信用分、限制与审计', icon: 'TrendCharts' }
]

const dots = Array.from({ length: 22 }).map((_, index) => ({
  id: index,
  style: {
    left: `${8 + (index * 37) % 88}%`,
    top: `${8 + (index * 53) % 84}%`,
    animationDelay: `${(index % 8) * 0.45}s`,
    animationDuration: `${3.8 + (index % 5) * 0.35}s`
  }
}))

const loginVars = computed(() => ({
  '--mx': pointer.x + 'px',
  '--my': pointer.y + 'px',
  '--tilt-x': `${pointer.y * -0.009}deg`,
  '--tilt-y': `${pointer.x * 0.009}deg`
}))

function handlePointer(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  pointer.x = event.clientX - rect.left - rect.width / 2
  pointer.y = event.clientY - rect.top - rect.height / 2
}

function resetPointer() {
  pointer.x = 0
  pointer.y = 0
}

async function handleLogin() {
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await userStore.login(form)
    ElMessage.success('登录成功')
    router.push('/dashboard')
  } catch (e) {
    loginError.value = true
    setTimeout(() => { loginError.value = false }, 520)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  width: 100%;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at calc(50% + var(--mx, 0px) * 0.026) calc(50% + var(--my, 0px) * 0.026), rgba(212, 169, 79, 0.2), transparent 28%),
    linear-gradient(135deg, #061A33 0%, #103B70 44%, #004499 100%);
  position: relative;
  overflow: hidden;
  padding: 42px;
}

.aurora-layer,
.grid-layer,
.beam-layer,
.constellation-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.aurora-layer {
  background:
    radial-gradient(circle at 18% 18%, rgba(196, 148, 58, 0.28), transparent 30%),
    radial-gradient(circle at 78% 26%, rgba(51, 153, 255, 0.24), transparent 32%),
    radial-gradient(circle at 50% 88%, rgba(82, 196, 26, 0.1), transparent 24%);
  filter: blur(9px);
  animation: auroraShift 11s ease-in-out infinite alternate;
}

.grid-layer {
  opacity: 0.14;
  background-image:
    linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px);
  background-size: 48px 48px;
  transform: perspective(900px) rotateX(63deg) translateY(96px);
  transform-origin: bottom;
  animation: gridDrift 16s linear infinite;
}

.beam-layer {
  background: linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.08) 42%, transparent 58%);
  transform: translateX(-42%);
  animation: beamMove 9s ease-in-out infinite;
  opacity: 0.7;
}

.constellation-layer {
  opacity: 0.78;
}

.star-dot {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: rgba(255,255,255,0.8);
  box-shadow: 0 0 14px rgba(255,255,255,0.6);
  animation: starPulse 4s ease-in-out infinite;
}

.login-stage {
  width: min(1180px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 430px;
  gap: clamp(36px, 5vw, 80px);
  align-items: center;
  position: relative;
  z-index: 1;
}

.brand-panel {
  color: #fff;
  min-height: 620px;
  position: relative;
  transform: translate3d(calc(var(--mx, 0px) * -0.009), calc(var(--my, 0px) * -0.009), 0);
  transition: transform 220ms ease-out;
  isolation: isolate;
}

.brand-kicker {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 8px 13px;
  border: 1px solid rgba(196, 148, 58, 0.5);
  border-radius: 999px;
  color: rgba(255,255,255,0.84);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.15em;
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(10px);
  animation: panelIn 680ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.kicker-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #C4943A;
  box-shadow: 0 0 0 6px rgba(196, 148, 58, 0.14), 0 0 18px rgba(196, 148, 58, 0.55);
}

.hero-copy {
  position: relative;
  z-index: 2;
  max-width: 660px;
  padding-top: 22px;
}

.brand-panel h1 {
  margin: 0 0 18px;
  font-size: clamp(42px, 4.35vw, 62px);
  line-height: 1.12;
  letter-spacing: 0.01em;
  text-shadow: 0 14px 36px rgba(0, 0, 0, 0.2);
  animation: panelIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 90ms both;
}

.brand-panel h1 span {
  display: block;
  margin-top: 4px;
  color: rgba(255,255,255,0.94);
}

.brand-panel p {
  width: min(620px, 100%);
  margin: 0;
  color: rgba(255,255,255,0.76);
  font-size: 16px;
  line-height: 1.9;
  animation: panelIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 180ms both;
}

.brand-orbit {
  position: absolute;
  right: 0;
  top: 43%;
  width: 300px;
  height: 300px;
  transform: translateY(-50%);
  opacity: 0.62;
  z-index: 1;
  filter: saturate(0.95);
}

.brand-orbit::before {
  content: '';
  position: absolute;
  inset: -34px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(0, 102, 204, 0.16), transparent 68%);
  filter: blur(2px);
}

.orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.14);
  box-shadow: inset 0 0 28px rgba(255,255,255,0.05);
}

.ring-main {
  animation: orbitSpin 20s linear infinite;
}

.ring-inner {
  inset: 58px;
  border-color: rgba(196, 148, 58, 0.26);
  animation: orbitSpin 14s linear infinite reverse;
}

.orbit-core {
  position: absolute;
  inset: 106px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 28px;
  background: linear-gradient(135deg, rgba(196,148,58,0.86), rgba(212,169,79,0.66));
  box-shadow: 0 18px 54px rgba(196, 148, 58, 0.22);
  font-size: 56px;
  font-weight: 900;
  animation: coreFloat 5.2s ease-in-out infinite;
}

.orbit-node {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 0 18px rgba(255,255,255,0.76);
}

.node-a { top: 18px; left: 52%; animation: nodePulse 2.4s ease-in-out infinite; }
.node-b { right: 25px; bottom: 74px; background: #C4943A; animation: nodePulse 2.8s ease-in-out infinite 0.4s; }
.node-c { left: 34px; bottom: 88px; background: #3399FF; animation: nodePulse 2.6s ease-in-out infinite 0.8s; }

.feature-stack {
  position: absolute;
  left: 0;
  bottom: 18px;
  display: grid;
  gap: 12px;
  width: min(470px, 100%);
  z-index: 3;
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(255,255,255,0.13), rgba(255,255,255,0.07));
  backdrop-filter: blur(18px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.16);
  animation: panelIn 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: transform 220ms ease, background 220ms ease, border-color 220ms ease;
}

.feature-card:nth-child(2) {
  transform: translateX(28px);
}

.feature-card:nth-child(3) {
  transform: translateX(58px);
}

.feature-card:hover {
  transform: translateX(10px) translateY(-2px);
  background: linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.1));
  border-color: rgba(196, 148, 58, 0.34);
}

.feature-card:nth-child(2):hover {
  transform: translateX(38px) translateY(-2px);
}

.feature-card:nth-child(3):hover {
  transform: translateX(68px) translateY(-2px);
}

.feature-card .el-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(196,148,58,0.22);
  color: #F5D38D;
  font-size: 19px;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
}

.feature-card strong {
  display: block;
  color: #fff;
  font-size: 14px;
}

.feature-card span {
  display: block;
  margin-top: 3px;
  color: rgba(255,255,255,0.66);
  font-size: 12px;
}

.login-card {
  width: 430px;
  padding: 34px 34px 28px;
  background: rgba(248, 251, 255, 0.92);
  backdrop-filter: blur(26px);
  -webkit-backdrop-filter: blur(26px);
  border-radius: 24px;
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  position: relative;
  z-index: 4;
  overflow: hidden;
  transform: perspective(1100px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transition: transform 180ms ease-out, box-shadow 260ms ease;
  animation: cardIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 160ms both;
}

.login-card:hover {
  box-shadow:
    0 34px 94px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.58),
    inset 0 1px 0 rgba(255, 255, 255, 0.82);
}

.login-card.shake {
  animation: shake 420ms ease;
}

.card-glow {
  position: absolute;
  inset: auto -70px -120px -70px;
  height: 210px;
  background: radial-gradient(circle, rgba(0,102,204,0.16), transparent 65%);
  pointer-events: none;
}

.card-noise {
  position: absolute;
  inset: 0;
  opacity: 0.28;
  pointer-events: none;
  background-image: radial-gradient(rgba(255,255,255,0.7) 0.6px, transparent 0.6px);
  background-size: 18px 18px;
}

.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, #C4943A, #D4A94F, #3399FF, #C4943A);
  background-size: 220% 100%;
  animation: shimmerBar 4s linear infinite;
}

.login-header {
  text-align: center;
  margin-bottom: 22px;
  position: relative;
  z-index: 1;
}

.login-logo {
  width: 62px;
  height: 62px;
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 19px;
  background: rgba(196,148,58,0.1);
  box-shadow: inset 0 0 0 1px rgba(196,148,58,0.22), 0 16px 36px rgba(196,148,58,0.16);
  animation: logoBreathe 3.6s ease-in-out infinite;
}

.login-logo-svg {
  width: 42px;
  height: 42px;
}

.login-eyebrow {
  color: var(--jy-accent, #C4943A);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.login-title {
  margin: 8px 0 6px;
  font-size: 28px;
  font-weight: 900;
  color: var(--jy-text-primary, #1A1A2E);
}

.login-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--jy-text-secondary, #8C8C9A);
}

.secure-strip {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 18px;
  border-radius: 14px;
  background: rgba(0, 102, 204, 0.055);
  border: 1px solid rgba(0, 102, 204, 0.08);
  color: var(--jy-text-secondary, #8C8C9A);
  font-size: 12px;
}

.secure-strip span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}

.secure-strip i {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--jy-success, #52C41A);
  box-shadow: 0 0 0 4px rgba(82,196,26,0.12);
  animation: securePulse 2.2s ease-in-out infinite;
}

.login-form {
  position: relative;
  z-index: 1;
}

.login-form .el-form-item {
  margin-bottom: 18px;
}

.form-field :deep(.el-form-item__content) {
  display: block;
}

.field-label {
  display: block;
  margin: 0 0 8px 2px;
  color: var(--jy-text-regular, #4A4A5A);
  font-size: 13px;
  font-weight: 700;
}

.login-form :deep(.el-input__wrapper) {
  min-height: 48px;
  border-radius: 14px;
  padding: 5px 14px;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 0 0 1px #E8E8EE inset, 0 8px 20px rgba(0, 21, 41, 0.04);
  transition: transform 220ms ease, box-shadow 220ms ease, background 220ms ease;
}

.login-form :deep(.el-input__wrapper:hover) {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgba(0,102,204,0.42) inset, 0 10px 22px rgba(0, 21, 41, 0.08);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  background: #fff;
  transform: translateY(-2px);
  box-shadow: 0 0 0 1px #0066CC inset, 0 0 0 4px rgba(0, 102, 204, 0.1), 0 14px 28px rgba(0, 21, 41, 0.1);
}

.login-form :deep(input:-webkit-autofill),
.login-form :deep(input:-webkit-autofill:hover),
.login-form :deep(input:-webkit-autofill:focus) {
  -webkit-box-shadow: 0 0 0 1000px #FFFFFF inset !important;
  -webkit-text-fill-color: var(--jy-text-primary, #1A1A2E) !important;
  caret-color: var(--jy-primary, #0066CC);
}

.submit-item {
  margin-top: 4px;
  margin-bottom: 0 !important;
}

.login-btn {
  width: 100%;
  height: 50px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 3px;
  border-radius: 15px;
  background: linear-gradient(135deg, #0066CC 0%, #004499 58%, #103B70 100%);
  border: none;
  box-shadow: 0 14px 26px rgba(0, 102, 204, 0.32);
  transition: transform 220ms ease, box-shadow 220ms ease, filter 220ms ease;
  position: relative;
  overflow: hidden;
}

.login-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 0%, rgba(255,255,255,0.28) 42%, transparent 68%);
  transform: translateX(-100%);
  transition: transform 720ms ease;
}

.login-btn:hover {
  background: linear-gradient(135deg, #C4943A 0%, #A67D2E 100%);
  box-shadow: 0 16px 32px rgba(196, 148, 58, 0.42);
  transform: translateY(-2px);
  filter: saturate(1.08);
}

.login-btn:hover::after {
  transform: translateX(100%);
}

.login-btn:active {
  transform: translateY(0);
  box-shadow: 0 8px 18px rgba(196, 148, 58, 0.32);
}

.btn-label {
  position: relative;
  z-index: 1;
}

.card-footer {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(0, 21, 41, 0.07);
  color: var(--jy-text-secondary, #8C8C9A);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

@keyframes auroraShift {
  from { transform: translate3d(-2%, -1%, 0) scale(1); filter: blur(9px) hue-rotate(0deg); }
  to { transform: translate3d(2%, 1.5%, 0) scale(1.06); filter: blur(11px) hue-rotate(8deg); }
}

@keyframes gridDrift {
  from { background-position: 0 0; }
  to { background-position: 48px 48px; }
}

@keyframes beamMove {
  0%, 100% { transform: translateX(-42%); opacity: 0.18; }
  50% { transform: translateX(42%); opacity: 0.32; }
}

@keyframes starPulse {
  0%, 100% { opacity: 0.25; transform: scale(0.72); }
  50% { opacity: 0.92; transform: scale(1.16); }
}

@keyframes panelIn {
  from { opacity: 0; transform: translateY(22px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes cardIn {
  from { opacity: 0; transform: perspective(1100px) translateY(34px) scale(0.96); }
  to { opacity: 1; transform: perspective(1100px) translateY(0) scale(1); }
}

@keyframes orbitSpin {
  to { transform: rotate(360deg); }
}

@keyframes coreFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-8px) rotate(-2deg); }
}

@keyframes nodePulse {
  0%, 100% { transform: scale(0.82); opacity: 0.65; }
  50% { transform: scale(1.28); opacity: 1; }
}

@keyframes shimmerBar {
  to { background-position: 220% 0; }
}

@keyframes logoBreathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

@keyframes securePulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(82,196,26,0.12); }
  50% { box-shadow: 0 0 0 7px rgba(82,196,26,0.05); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(4px); }
}

@media (max-width: 1100px) {
  .login-stage {
    grid-template-columns: 1fr 410px;
    gap: 34px;
  }

  .brand-panel h1 {
    font-size: clamp(38px, 4.8vw, 56px);
  }

  .brand-orbit {
    opacity: 0.38;
    right: -20px;
  }
}

@media (max-width: 960px) {
  .login-stage {
    grid-template-columns: 1fr;
    max-width: 540px;
  }

  .brand-panel {
    min-height: auto;
    text-align: center;
  }

  .hero-copy {
    margin: 0 auto;
  }

  .brand-panel p {
    margin: 0 auto;
  }

  .brand-orbit,
  .feature-stack {
    display: none;
  }

  .login-card {
    width: 100%;
  }
}

@media (max-width: 520px) {
  .login-container {
    padding: 20px;
  }

  .login-card {
    padding: 30px 22px 24px;
  }

  .secure-strip,
  .card-footer {
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-container *,
  .login-container *::before,
  .login-container *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }

  .login-card,
  .brand-panel {
    transform: none !important;
  }
}
</style>
