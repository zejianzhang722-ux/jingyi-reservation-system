import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import Layout from '@/components/Layout.vue'
import { adminChildren, hasRouteRole } from './adminRoutes'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/views/Forbidden.vue'),
    meta: { title: '无权访问' }
  },
  {
    path: '/',
    component: Layout,
    redirect: '/dashboard',
    children: adminChildren
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/dashboard'
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.onError((error) => {
  console.error('Admin route navigation failed:', error)
  ElMessage.error('页面暂时未能打开，请稍后重试')
})

router.beforeEach((to, from, next) => {
  document.title = to.meta.title ? `${to.meta.title} - 敬一书院` : '敬一书院'
  const token = localStorage.getItem('token')
  const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}')

  if (to.path === '/login') {
    if (token) return next('/dashboard')
    return next()
  }

  if (!token) return next('/login')

  if (to.path !== '/403' && !hasRouteRole(to, userInfo.role)) {
    return next('/403')
  }

  next()
})

export default router
