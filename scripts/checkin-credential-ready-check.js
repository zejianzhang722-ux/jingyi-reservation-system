process.env.NODE_ENV = 'test'
process.env.ALLOW_MOCK_REDIS = 'true'
process.env.REDIS_HOST = '127.0.0.1'
process.env.REDIS_PORT = '1'

const redis = require('../server/src/config/redis')

redis.ready().then(function() {
  require('./checkin-credential-check')
}).catch(function(err) {
  console.error(err && err.stack ? err.stack : err)
  process.exit(1)
})
