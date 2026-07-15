import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'path'

const apiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:3000'

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    ...(mode === 'test' ? [] : [
      AutoImport({
        resolvers: [ElementPlusResolver({ importStyle: false })],
        imports: ['vue', 'vue-router', 'pinia']
      })
    ])
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true
      },
      '/socket.io': {
        target: apiTarget,
        ws: true
      }
    }
  }
}))
