const storage = {
  token: 'expired-token',
  refreshToken: 'refresh-token'
}

let profileCalls = 0
let redirected = false

global.wx = {
  getStorageSync: function(key) { return storage[key] },
  setStorageSync: function(key, value) { storage[key] = value },
  removeStorageSync: function(key) { delete storage[key] },
  getSystemInfoSync: function() { return { platform: 'devtools' } },
  redirectTo: function() { redirected = true },
  showToast: function() {},
  request: function(options) {
    if (options.url.indexOf('/auth/refresh') !== -1) {
      options.success({
        statusCode: 200,
        data: {
          code: 200,
          data: { token: 'fresh-token', refreshToken: 'fresh-refresh-token' }
        }
      })
      return
    }

    if (options.url.indexOf('/user/profile') !== -1) {
      profileCalls += 1
      if (profileCalls === 1) {
        options.success({
          statusCode: 200,
          data: { code: 401, message: '令牌已过期', data: null }
        })
        return
      }
      options.success({
        statusCode: 200,
        data: { code: 200, data: { id: 1, name: '张三' } }
      })
      return
    }

    options.fail({})
  }
}

global.getApp = function() { return { globalData: {} } }

const request = require('../miniapp/utils/request')

request.get('/user/profile').then(function(data) {
  if (!data || data.name !== '张三') throw new Error('刷新后没有重新请求成功')
  if (storage.token !== 'fresh-token') throw new Error('新令牌没有写入缓存')
  if (profileCalls !== 2) throw new Error('接口没有在刷新后重试')
  if (redirected) throw new Error('可刷新令牌时不应跳转登录')
  console.log('request-refresh-check passed')
}).catch(function(err) {
  console.error(err.message || err)
  process.exitCode = 1
})
