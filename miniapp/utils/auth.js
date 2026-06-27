var request = require('./request')

function getAssetBaseUrl() {
  var baseUrl = request.getBaseUrl() || ''
  return String(baseUrl).replace(/\/+$/, '').replace(/\/api\/v\d+$/i, '')
}

function isRemoteUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

function normalizeAssetUrl(url) {
  var value = String(url || '').trim()
  if (!value) return ''
  if (isRemoteUrl(value)) return value
  var assetBaseUrl = getAssetBaseUrl()
  if (!assetBaseUrl) return value
  if (value.indexOf('/uploads/') === 0) return assetBaseUrl + value
  if (value.indexOf('uploads/') === 0) return assetBaseUrl + '/' + value
  return value
}

function normalizeUserInfo(userInfo) {
  var data = Object.assign({}, userInfo || {})
  if (!data.name && data.real_name) data.name = data.real_name
  if (!data.name && data.realName) data.name = data.realName
  if (!data.student_no && data.student_id) data.student_no = data.student_id
  if (!data.student_no && data.studentNo) data.student_no = data.studentNo
  if (data.avatar) data.avatar = normalizeAssetUrl(data.avatar)
  if (data.avatarUrl) data.avatarUrl = normalizeAssetUrl(data.avatarUrl)
  return data
}

function setUserInfo(userInfo) {
  var data = normalizeUserInfo(userInfo)
  wx.setStorageSync('userInfo', data)
  var app = getApp()
  if (app) {
    app.globalData.userInfo = data
  }
  return data
}

function setAuthData(data) {
  data = data || {}
  if (data.token) wx.setStorageSync('token', data.token)
  if (data.refreshToken) wx.setStorageSync('refreshToken', data.refreshToken)
  var userInfo = data.userInfo ? setUserInfo(data.userInfo) : wx.getStorageSync('userInfo')
  var app = getApp()
  if (app) {
    app.globalData.token = data.token || wx.getStorageSync('token') || null
    app.globalData.refreshToken = data.refreshToken || wx.getStorageSync('refreshToken') || null
    app.globalData.userInfo = userInfo || null
  }
  return {
    token: data.token || wx.getStorageSync('token') || null,
    refreshToken: data.refreshToken || wx.getStorageSync('refreshToken') || null,
    userInfo: userInfo || null
  }
}

function login() {
  return new Promise(function (resolve, reject) {
    wx.login({
      success: function (res) {
        if (res.code) {
          request.post('/auth/login/wechat', { code: res.code }, { silent: true }).then(function (data) {
            if (data && data.token) {
              setAuthData(data)
              resolve(data)
            } else {
              reject(new Error('登录返回数据异常'))
            }
          }).catch(function () {
            reject(new Error('微信登录接口调用失败'))
          })
        } else {
          reject(new Error('wx.login失败'))
        }
      },
      fail: function () {
        reject(new Error('wx.login调用失败'))
      }
    })
  })
}

function mockLogin(studentNo, name) {
  return new Promise(function (resolve, reject) {
    request.post('/auth/login/wechat', {
      code: 'mock_code_' + studentNo,
      studentNo: studentNo,
      name: name
    }, { silent: true }).then(function (data) {
      if (data && data.token) {
        setAuthData(data)
        resolve(data)
      } else {
        var fallbackUser = {
          id: Date.now(),
          openid: 'mock_' + studentNo,
          student_no: studentNo,
          name: name,
          credit_score: 100,
          status: 'active'
        }
        wx.setStorageSync('userInfo', fallbackUser)
        var app2 = getApp()
        if (app2) {
          app2.globalData.userInfo = fallbackUser
        }
        resolve({ token: null, userInfo: fallbackUser })
      }
    }).catch(function () {
      var fallbackUser = {
        id: Date.now(),
        openid: 'mock_' + studentNo,
        student_no: studentNo,
        name: name,
        credit_score: 100,
        status: 'active'
      }
      wx.setStorageSync('userInfo', fallbackUser)
      var app = getApp()
      if (app) {
        app.globalData.userInfo = fallbackUser
      }
      resolve({ token: null, userInfo: fallbackUser })
    })
  })
}

function getToken() {
  return wx.getStorageSync('token')
}

function getRefreshToken() {
  return wx.getStorageSync('refreshToken')
}

function getUserInfo() {
  return wx.getStorageSync('userInfo')
}

function isLoggedIn() {
  return !!wx.getStorageSync('token') && !!wx.getStorageSync('userInfo')
}

function logout() {
  wx.removeStorageSync('token')
  wx.removeStorageSync('refreshToken')
  wx.removeStorageSync('userInfo')
  var app = getApp()
  if (app) {
    app.globalData.token = null
    app.globalData.refreshToken = null
    app.globalData.userInfo = null
  }
  wx.reLaunch({ url: '/pages/login/login' })
}

function checkAuth() {
  if (!isLoggedIn()) {
    wx.redirectTo({ url: '/pages/login/login' })
    return false
  }
  return true
}

function isAdmin() {
  var userInfo = getUserInfo()
  if (!userInfo) return false
  var role = userInfo.role || ''
  return role === 'admin' || role === 'super_admin' || role === 'counselor'
}

function getUserRole() {
  var userInfo = getUserInfo()
  return userInfo ? (userInfo.role || 'student') : 'student'
}

module.exports = {
  login: login,
  mockLogin: mockLogin,
  setAuthData: setAuthData,
  setUserInfo: setUserInfo,
  normalizeUserInfo: normalizeUserInfo,
  normalizeAssetUrl: normalizeAssetUrl,
  getAssetBaseUrl: getAssetBaseUrl,
  getToken: getToken,
  getRefreshToken: getRefreshToken,
  getUserInfo: getUserInfo,
  isLoggedIn: isLoggedIn,
  logout: logout,
  checkAuth: checkAuth,
  isAdmin: isAdmin,
  getUserRole: getUserRole
}
