<template>
  <div class="login-container" :style="loginVars" @mousemove="handlePointer" @mouseleave="resetPointer">
    <div class="aurora-layer"></div>
    <div class="grid-layer"></div>
    <div class="constellation-layer">
      <span v-for="dot in dots" :key="dot.id" class="star-dot" :style="dot.style"></span>
    </div>

    <div class="login-stage">
      <section class="brand-panel">
        <div class="brand-kicker">JINGYI RESERVATION</div>
        <h1>敬一书院<br />功能房预约平台</h1>
        <p>把空间预约、审核、签到、信用与统计沉淀成一个清晰、可靠、可运营的书院空间管理中枢。</p>

        <div class="brand-orbit" aria-hidden="true">
          <div class="orbit-ring ring-main"></div>
          <div class="orbit-ring ring-inner"></div>
          <div class="orbit-core">敬</div>
          <div class="orbit-node node-a"></div>
          <div class="orbit-node node-b"></div>
          <div class="orbit-node node-c"></div>
        </div>

        <div class="feature-stack">
          <div class="feature-card" v-for="item in featureCards" :key="item.title">
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
          <p class="login-subtitle">登录后继续管理预约与书院空间运营</p>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" class="login-form" @keyup.enter="handleLogin">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="请输入账号" size="large" prefix-icon="User" />
          </el-form-item>
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" prefix-icon="Lock" show-password />
          </el-form-item>
          <div class="login-meta">
            <span>安全连接</span>
            <span>角色权限自动识别</span>
          </div>
          <el-form-item>
            <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="handleLogin">
              <span class="btn-label">{{ loading ? '登录中' : '进入后台' }}</span>
            </el-button>
          </el-form-item>
        </el-form>
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
  '--tilt-x': `${pointer.y * -0.012}deg`,
  '--tilt-y': `${pointer.x * 0.012}deg`
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
    radial-gradient(circle at calc(50% + var(--mx, 0px) * 0.03) calc(50% + var(--my, 0px) * 0.03), rgba(212, 169, 79, 0.24), transparent 28%),
    linear-gradient(135deg, #061A33 0%, #103B70 42%, #004499 100%);
  position: relative;
  overflow: hidden;
  padding: 36px;
}

.aurora-layer,
.grid-layer,
.constellation-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.aurora-layer {
  background:
    radial-gradient(circle at 18% 18%, rgba(196, 148, 58, 0.34), transparent 28%),
    radial-gradient(circle at 78% 26%, rgba(51, 153, 255, 0.28), transparent 30%),
    radial-gradient(circle at 52% 88%, rgba(82, 196, 26, 0.12), transparent 24%);
  filter: blur(8px);
  animation: auroraShift 10s ease-in-out infinite alternate;
}

.grid-layer {
  opacity: 0.18;
  background-image:
    linear-gradient(rgba(255,255,255,0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.14) 1px, transparent 1px);
  background-size: 46px 46px;
  transform: perspective(900px) rotateX(62deg) translateY(90px);
  transform-origin: bottom;
  animation: gridDrift 14s linear infinite;
}

.constellation-layer {
  opacity: 0.85;
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
  width: min(1120px, 100%);
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) 440px;
  gap: 42px;
  align-items: center;
  position: relative;
  z-index: 1;
}

.brand-panel {
  color: #fff;
  min-height: 620px;
  position: relative;
  transform: translate3d(calc(var(--mx, 0px) * -0.012), calc(var(--my, 0px) * -0.012), 0);
  transition: transform 220ms ease-out;
}

.brand-kicker {
  display: inline-flex;
  padding: 8px 12px;
  border: 1px solid rgba(196, 148, 58, 0.5);
  border-radius: 999px;
  color: rgba(255,255,255,0.84);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(10px);
  animation: panelIn 680ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.brand-panel h1 {
  margin: 24px 0 16px;
  font-size: clamp(42px, 5vw, 70px);
  line-height: 1.04;
  letter-spacing: 0.02em;
  animation: panelIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 90ms both;
}

.brand-panel p {
  width: min(560px, 100%);
  margin: 0;
  color: rgba(255,255,255,0.74);
  font-size: 16px;
  line-height: 1.9;
  animation: panelIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 180ms both;
}

.brand-orbit {
  position: absolute;
  right: 4%;
  top: 40%;
  width: 310px;
  height: 310px;
  transform: translateY(-50%);
  opacity: 0.92;
}

.orbit-ring {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.16);
  box-shadow: inset 0 0 28px rgba(255,255,255,0.06);
}

.ring-main {
  animation: orbitSpin 18s linear infinite;
}

.ring-inner {
  inset: 56px;
  border-color: rgba(196, 148, 58, 0.34);
  animation: orbitSpin 12s linear infinite reverse;
}

.orbit-core {
  position: absolute;
  inset: 105px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 30px;
  background: linear-gradient(135deg, rgba(196,148,58,0.94), rgba(212,169,79,0.72));
  box-shadow: 0 18px 60px rgba(196, 148, 58, 0.32);
  font-size: 58px;
  font-weight: 900;
  animation: coreFloat 4.8s ease-in-out infinite;
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
  bottom: 8px;
  display: grid;
  gap: 12px;
  width: min(460px, 100%);
}

.feature-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid rgba(255,255,255,0.14);
  border-radius: 16px;
  background: rgba(255,255,255,0.09);
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 34px rgba(0,0,0,0.14);
  animation: panelIn 720ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: transform 220ms ease, background 220ms ease;
}

.feature-card:nth-child(1) { animation-delay: 260ms; }
.feature-card:nth-child(2) { animation-delay: 340ms; }
.feature-card:nth-child(3) { animation-delay: 420ms; }
.feature-card:hover {
  transform: translateX(8px);
  background: rgba(255,255,255,0.14);
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
}

.feature-card strong {
  display: block;
  color: #fff;
  font-size: 14px;
}

.feature-card span {
  display: block;
  margin-top: 3px;
  color: rgba(255,255,255,0.62);
  font-size: 12px;
}

.login-card {
  width: 440px;
  padding: 42px 38px 36px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(26px);
  -webkit-backdrop-filter: blur(26px);
  border-radius: 24px;
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.24),
    0 0 0 1px rgba(255, 255, 255, 0.45),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);
  position: relative;
  z-index: 1;
  overflow: hidden;
  transform: perspective(1100px) rotateX(var(--tilt-x, 0deg)) rotateY(var(--tilt-y, 0deg));
  transition: transform 180ms ease-out, box-shadow 260ms ease;
  animation: cardIn 760ms cubic-bezier(0.16, 1, 0.3, 1) 160ms both;
}

.login-card:hover {
  box-shadow:
    0 34px 94px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(255, 255, 255, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
}

.login-card.shake {
  animation: shake 420ms ease;
}

.card-glow {
  position: absolute;
  inset: auto -80px -120px -80px;
  height: 220px;
  background: radial-gradient(circle, rgba(0,102,204,0.18), transparent 65%);
  pointer-events: none;
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
  margin-bottom: 30px;
  position: relative;
  z-index: 1;
}

.login-logo {
  width: 68px;
  height: 68px;
  margin: 0 auto 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 20px;
  background: rgba(196,148,58,0.1);
  box-shadow: inset 0 0 0 1px rgba(196,148,58,0.2), 0 16px 36px rgba(196,148,58,0.18);
  animation: logoBreathe 3.6s ease-in-out infinite;
}

.login-logo-svg {
  width: 46px;
  height: 46px;
}

.login-eyebrow {
  color: var(--jy-accent, #C4943A);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.16em;
}

.login-title {
  margin: 8px 0 6px;
  font-size: 30px;
  font-weight: 900;
  color: var(--jy-text-primary, #1A1A2E);
}

.login-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--jy-text-secondary, #8C8C9A);
}

.login-form {
  position: relative;
  z-index: 1;
}

.login-form .el-form-item {
  margin-bottom: 22px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 14px;
  padding: 5px 14px;
  background: rgba(255,255,255,0.88);
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

.login-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: -4px 2px 18px;
  color: var(--jy-text-secondary, #8C8C9A);
  font-size: 12px;
}

.login-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.login-meta span::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--jy-success, #52C41A);
  box-shadow: 0 0 0 4px rgba(82,196,26,0.12);
}

.login-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 3px;
  border-radius: 14px;
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

@keyframes auroraShift {
  from { transform: translate3d(-2%, -1%, 0) scale(1); filter: blur(8px) hue-rotate(0deg); }
  to { transform: translate3d(2%, 1.5%, 0) scale(1.06); filter: blur(10px) hue-rotate(8deg); }
}

@keyframes gridDrift {
  from { background-position: 0 0; }
  to { background-position: 46px 46px; }
}

@keyframes starPulse {
  0%, 100% { opacity: 0.28; transform: scale(0.72); }
  50% { opacity: 1; transform: scale(1.2); }
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

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(4px); }
}

@media (max-width: 960px) {
  .login-stage {
    grid-template-columns: 1fr;
    max-width: 520px;
  }

  .brand-panel {
    min-height: auto;
    text-align: center;
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
    padding: 34px 24px 28px;
  }

  .login-meta {
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
