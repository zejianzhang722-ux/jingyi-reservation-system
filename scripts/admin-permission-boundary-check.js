const { spawn } = require('child_process');

const PORT = Number(process.env.PERMISSION_TEST_PORT || 3207);
const BASE_URL = 'http://127.0.0.1:' + PORT + '/api/v1';

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function startServer() {
  const child = spawn(process.execPath, ['src/app.js'], {
    cwd: __dirname + '/../server',
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_ENV: 'test',
      ENABLE_SCHEDULER: 'false',
      MYSQL_HOST: '127.0.0.1',
      MYSQL_PORT: '1',
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', function(chunk) { output += chunk.toString(); });
  child.stderr.on('data', function(chunk) { output += chunk.toString(); });
  child.output = function() { return output; };
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('server exited early:\n' + child.output());
    try {
      const res = await fetch(BASE_URL + '/health');
      if (res.status === 200) return;
    } catch (err) {}
    await wait(300);
  }
  throw new Error('server did not become healthy:\n' + child.output());
}

async function api(path, options) {
  const res = await fetch(BASE_URL + path, Object.assign({
    headers: { 'Content-Type': 'application/json' }
  }, options || {}));
  const text = await res.text();
  return { status: res.status, json: JSON.parse(text) };
}

function headers(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}

async function login(username, password) {
  const result = await api('/auth/login/admin-miniapp', {
    method: 'POST',
    body: JSON.stringify({ username: username, password: password })
  });
  if (result.status !== 200) throw new Error(username + ' login failed');
  return result.json.data;
}

async function grant(superAdmin, adminId, capability) {
  return api('/admin/delegations/capabilities', {
    method: 'POST',
    headers: headers(superAdmin.token),
    body: JSON.stringify({
      adminId: adminId,
      capability: capability,
      validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
      validTo: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    })
  });
}

async function main() {
  const server = startServer();
  const failures = [];
  function check(condition, label, detail) {
    if (!condition) failures.push(label + ': ' + detail);
  }

  try {
    await waitForHealth(server);
    const buildingAdmin = await login('building_admin', 'admin123');
    const globalAdmin = await login('admin', 'admin123');
    const superAdmin = await login('superadmin', 'super123');

    const foreignCredit = await api('/credit/violation', {
      method: 'POST',
      headers: headers(buildingAdmin.token),
      body: JSON.stringify({ userId: 2, type: 'warning', description: 'permission-boundary-test', score: -1 })
    });
    check(foreignCredit.status === 403, 'cross-building credit mutation', 'expected 403, got ' + foreignCredit.status);

    const foreignPosterPositions = await api('/poster/positions', { headers: headers(buildingAdmin.token) });
    check(foreignPosterPositions.status === 403, 'poster position role boundary', 'expected 403, got ' + foreignPosterPositions.status);

    const supplementCreated = await api('/checkin/supplement', {
      method: 'POST',
      headers: headers(superAdmin.token),
      body: JSON.stringify({ reservationId: 6, type: 'signin', reason: 'permission-boundary-test' })
    });
    check(supplementCreated.status === 200, 'foreign supplement fixture', 'expected 200, got ' + supplementCreated.status);
    const supplementList = await api('/checkin/supplement', { headers: headers(buildingAdmin.token) });
    const supplementRows = supplementList.json && supplementList.json.data ? supplementList.json.data : [];
    check(
      supplementList.status === 200 && supplementRows.every(function(row) { return Number(row.building_id) === 1; }),
      'supplement list building scope',
      'foreign building rows were returned'
    );

    const manual = await api('/checkin/manual', {
      method: 'POST',
      headers: headers(superAdmin.token),
      body: JSON.stringify({ reservationId: 6 })
    });
    check(manual.status === 200, 'foreign checkout fixture', 'expected 200, got ' + manual.status);
    const foreignCheckout = await api('/checkin/checkout', {
      method: 'POST',
      headers: headers(buildingAdmin.token),
      body: JSON.stringify({ reservationId: 6 })
    });
    check(foreignCheckout.status === 403, 'cross-building checkout', 'expected 403, got ' + foreignCheckout.status);
    const foreignCheckinStatus = await api('/checkin/status/6', { headers: headers(buildingAdmin.token) });
    check(foreignCheckinStatus.status === 403, 'cross-building checkin status', 'expected 403, got ' + foreignCheckinStatus.status);

    const grants = [
      ['data_export', buildingAdmin.userInfo.id],
      ['rule_config', buildingAdmin.userInfo.id],
      ['audit', globalAdmin.userInfo.id]
    ];
    for (const item of grants) {
      const granted = await grant(superAdmin, item[1], item[0]);
      check(granted.status === 200, item[0] + ' grant fixture', 'expected 200, got ' + granted.status);
    }

    const refreshedBuildingAdmin = await login('building_admin', 'admin123');
    const refreshedGlobalAdmin = await login('admin', 'admin123');
    check(
      ['data_export', 'rule_config'].every(function(capability) {
        return (refreshedBuildingAdmin.userInfo.capabilities || []).includes(capability);
      }),
      'delegated capabilities in login session',
      'active grants were not returned to the web client'
    );
    check(
      (refreshedGlobalAdmin.userInfo.capabilities || []).includes('audit'),
      'audit capability in login session',
      'active audit grant was not returned to the web client'
    );

    const exported = await api('/stats/export?type=users', { headers: headers(refreshedBuildingAdmin.token) });
    check(exported.status === 200, 'data_export capability', 'expected 200, got ' + exported.status);
    const configRead = await api('/admin/config', { headers: headers(refreshedBuildingAdmin.token) });
    check(configRead.status === 200, 'rule_config capability', 'expected 200, got ' + configRead.status);
    const counselorQueue = await api('/audit/counselor/pending', { headers: headers(refreshedGlobalAdmin.token) });
    check(counselorQueue.status === 200, 'audit capability', 'expected 200, got ' + counselorQueue.status);
    const counselorApproval = await api('/audit/5/approve', {
      method: 'POST',
      headers: headers(refreshedGlobalAdmin.token),
      body: JSON.stringify({})
    });
    check(counselorApproval.status === 200, 'audit capability approval', 'expected 200, got ' + counselorApproval.status);

    if (failures.length) {
      throw new Error('permission boundary regressions:\n- ' + failures.join('\n- '));
    }
    console.log('admin-permission-boundary-check passed');
  } finally {
    server.kill();
    await wait(500);
  }
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
