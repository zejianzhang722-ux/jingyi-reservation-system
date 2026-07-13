import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

const request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000
})

request.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

request.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const { response } = error
    if (response) {
      switch (response.status) {
        case 401:
          ElMessage.error('登录已失效，请重新登录')
          localStorage.removeItem('token')
          localStorage.removeItem('userInfo')
          router.push('/login')
          break
        case 403:
          ElMessage.error('当前账号没有权限执行此操作')
          break
        case 404:
          ElMessage.error('所需内容暂时无法找到，可能已调整')
          break
        case 400:
          ElMessage.error(response.data?.message || '提交内容不完整，请检查后重试')
          break
        case 422:
          ElMessage.error(response.data?.message || '提交内容不完整，请检查后重试')
          break
        case 429:
          ElMessage.error(response.data?.message || '操作过快，请稍后再试')
          break
        case 500:
          ElMessage.error('服务暂时不可用，请稍后重试；持续出现请联系系统管理员')
          break
        default:
          ElMessage.error('操作未完成，请稍后重试')
      }
    } else {
      ElMessage.error('网络连接失败，请检查网络后重试')
    }
    return Promise.reject(error)
  }
)

export default request


