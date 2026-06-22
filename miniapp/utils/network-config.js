var DEFAULT_LOCAL_HOST = '127.0.0.1'
var DEFAULT_PORT = '3000'

var networkConfig = {
  localHost: DEFAULT_LOCAL_HOST,
  lanHost: '',
  port: DEFAULT_PORT,
  productionBaseUrl: '',
  apiPrefix: '/api/v1'
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '')
}

function normalizeBaseUrl(url) {
  var value = trimSlash(url)
  if (!value) return ''
  if (value.slice(-7) !== '/api/v1') {
    value += '/api/v1'
  }
  return value
}

function buildApiUrl(host, port) {
  return normalizeBaseUrl('http://' + host + ':' + (port || DEFAULT_PORT))
}

function getDefaultBaseUrl(systemInfo, overrides) {
  var options = Object.assign({}, networkConfig, overrides || {})
  var platform = systemInfo && systemInfo.platform

  if (platform === 'devtools') {
    return buildApiUrl(options.localHost || DEFAULT_LOCAL_HOST, options.port)
  }

  if (options.lanHost) {
    return buildApiUrl(options.lanHost, options.port)
  }

  return normalizeBaseUrl(options.productionBaseUrl)
}

function buildHealthUrl(baseUrl) {
  return normalizeBaseUrl(baseUrl) + '/health'
}

function getConfig() {
  return Object.assign({}, networkConfig)
}

function setRuntimeConfig(nextConfig) {
  networkConfig = Object.assign({}, networkConfig, nextConfig || {})
  return getConfig()
}

module.exports = {
  normalizeBaseUrl: normalizeBaseUrl,
  getDefaultBaseUrl: getDefaultBaseUrl,
  buildHealthUrl: buildHealthUrl,
  getConfig: getConfig,
  setRuntimeConfig: setRuntimeConfig
}
