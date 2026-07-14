import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { getErrorPresentation } from './requestErrorPolicy'

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
    const presentation = getErrorPresentation(error)
    if (presentation.shouldNotify) ElMessage.error(presentation.message)
    if (presentation.clearSession) {
      localStorage.removeItem('token')
      localStorage.removeItem('userInfo')
    }
    if (presentation.redirectTo) router.push(presentation.redirectTo)
    return Promise.reject(error)
  }
)

export default request


