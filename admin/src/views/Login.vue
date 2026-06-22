<template>
  <div class="login-container">
    <div class="login-bg-decoration">
      <div class="decoration-circle circle-1"></div>
      <div class="decoration-circle circle-2"></div>
      <div class="decoration-circle circle-3"></div>
    </div>
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">
          <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" class="login-logo-svg">
            <rect x="3" y="6" width="34" height="28" rx="4" stroke="#C4943A" stroke-width="1.8" fill="none"/>
            <path d="M10 14h20M10 19h20M10 24h12" stroke="#C4943A" stroke-width="1.4" stroke-linecap="round"/>
            <path d="M20 2v6M15 3v5M25 3v5" stroke="#C4943A" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </div>
        <h1 class="login-title">敬一书院</h1>
        <p class="login-subtitle">功能房预约管理系统</p>
        <div class="login-divider">
          <span class="divider-line"></span>
          <span class="divider-diamond">◆</span>
          <span class="divider-line"></span>
        </div>
      </div>
      <el-form ref="formRef" :model="form" :rules="rules" class="login-form" @keyup.enter="handleLogin">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入账号" size="large" prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="handleLogin">
            登 录
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref(null)
const loading = ref(false)

const form = reactive({
  username: '',
  password: ''
})

const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
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
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-container {
  width: 100%;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #003D7A 0%, #0066CC 40%, #004499 100%);
  position: relative;
  overflow: hidden;
}

.login-bg-decoration {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.decoration-circle {
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.circle-1 {
  width: 600px;
  height: 600px;
  top: -200px;
  right: -150px;
  background: radial-gradient(circle, rgba(196, 148, 58, 0.08) 0%, transparent 70%);
}

.circle-2 {
  width: 400px;
  height: 400px;
  bottom: -100px;
  left: -100px;
  background: radial-gradient(circle, rgba(0, 102, 204, 0.1) 0%, transparent 70%);
}

.circle-3 {
  width: 200px;
  height: 200px;
  top: 50%;
  left: 10%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.04) 0%, transparent 70%);
}

.login-card {
  width: 420px;
  padding: 48px 40px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  position: relative;
  z-index: 1;
}

.login-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #C4943A, #D4A94F, #C4943A);
  border-radius: 16px 16px 0 0;
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}

.login-logo {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.login-logo-svg {
  width: 48px;
  height: 48px;
}

.login-title {
  font-size: 28px;
  font-weight: 700;
  color: #0066CC;
  margin-bottom: 6px;
  letter-spacing: 4px;
}

.login-subtitle {
  font-size: 14px;
  color: #8C8C9A;
  letter-spacing: 1px;
}

.login-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 20px;
}

.divider-line {
  width: 40px;
  height: 1px;
  background: linear-gradient(90deg, transparent, #C4943A);
}

.divider-line:last-child {
  background: linear-gradient(90deg, #C4943A, transparent);
}

.divider-diamond {
  color: #C4943A;
  font-size: 8px;
  line-height: 1;
}

.login-form .el-form-item {
  margin-bottom: 24px;
}

.login-form :deep(.el-input__wrapper) {
  border-radius: 10px;
  padding: 4px 12px;
  box-shadow: 0 0 0 1px #E8E8EE inset;
  transition: all 0.3s ease;
}

.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #0066CC inset;
}

.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px #0066CC inset, 0 0 0 3px rgba(0, 102, 204, 0.1);
}

.login-btn {
  width: 100%;
  height: 44px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 4px;
  border-radius: 10px;
  background: linear-gradient(135deg, #0066CC 0%, #004499 100%);
  border: none;
  box-shadow: 0 4px 12px rgba(0, 102, 204, 0.3);
  transition: all 0.3s ease;
}

.login-btn:hover {
  background: linear-gradient(135deg, #C4943A 0%, #A67D2E 100%);
  box-shadow: 0 4px 16px rgba(196, 148, 58, 0.4);
  transform: translateY(-1px);
}

.login-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(196, 148, 58, 0.3);
}
</style>
