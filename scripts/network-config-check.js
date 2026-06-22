const assert = require('assert');
const path = require('path');

const miniappConfig = require('../miniapp/utils/network-config');

function testMiniappConfig() {
  assert.strictEqual(typeof miniappConfig.normalizeBaseUrl, 'function');
  assert.strictEqual(typeof miniappConfig.getDefaultBaseUrl, 'function');
  assert.strictEqual(typeof miniappConfig.buildHealthUrl, 'function');

  assert.strictEqual(
    miniappConfig.normalizeBaseUrl('http://127.0.0.1:3000'),
    'http://127.0.0.1:3000/api/v1'
  );
  assert.strictEqual(
    miniappConfig.normalizeBaseUrl('https://example.edu.cn/api/v1/'),
    'https://example.edu.cn/api/v1'
  );
  assert.strictEqual(
    miniappConfig.buildHealthUrl('https://example.edu.cn/api/v1'),
    'https://example.edu.cn/api/v1/health'
  );
  assert.strictEqual(
    miniappConfig.getDefaultBaseUrl({ platform: 'devtools' }, { lanHost: '192.168.1.8' }),
    'http://127.0.0.1:3000/api/v1'
  );
  assert.strictEqual(
    miniappConfig.getDefaultBaseUrl({ platform: 'ios' }, { lanHost: '192.168.1.8' }),
    'http://192.168.1.8:3000/api/v1'
  );
}

function testSourceDoesNotUsePlaceholders() {
  const fs = require('fs');
  const requestSource = fs.readFileSync(path.join(__dirname, '../miniapp/utils/request.js'), 'utf8');
  assert(!requestSource.includes('your-api-domain.com'), 'miniapp request.js should not contain placeholder production domain');
  assert(!requestSource.includes("var LAN_IP = '"), 'miniapp request.js should not hard-code LAN IP');
}

testMiniappConfig();
testSourceDoesNotUsePlaceholders();
console.log('network-config-check passed');
