const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', '..', 'package.json');
let packageVersion = 'unknown';
try { packageVersion = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || 'unknown'; } catch (err) {}

const normalize = function(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
};

const snapshot = function() {
  return {
    service: 'jingyi-reservation',
    version: normalize(process.env.APP_VERSION, packageVersion),
    gitSha: normalize(process.env.GIT_SHA, 'development'),
    buildTime: normalize(process.env.BUILD_TIME, 'development'),
    releaseId: normalize(process.env.RELEASE_ID, 'development'),
    deploymentSlot: normalize(process.env.DEPLOYMENT_SLOT, 'local'),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  };
};

module.exports = { snapshot };
