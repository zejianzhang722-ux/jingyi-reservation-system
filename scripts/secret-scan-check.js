const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const tracked = childProcess.execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean)
const excluded = [
  /package-lock\.json$/,
  /\.png$/i,
  /\.jpe?g$/i,
  /\.gif$/i,
  /\.ico$/i,
  /\.zip$/i,
  /\.mp4$/i,
  /\.pdf$/i,
  /^scripts\/secret-scan-check\.js$/,
  /^scripts\/security-hardening-check\.js$/
]
const forbiddenFiles = tracked.filter(function(file) {
  const base = path.basename(file)
  return base === '.env' || /\.(pem|p12|pfx|key)$/i.test(base)
})
assert.deepStrictEqual(forbiddenFiles, [], 'tracked secret container files are forbidden: ' + forbiddenFiles.join(', '))

const patterns = [
  { name: 'private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'legacy JWT default', regex: /jingyi-reservation-jwt-secret-2026-dev/ },
  { name: 'legacy WeChat secret', regex: /wx_test_secret/ },
  { name: 'hard-coded MySQL password', regex: /MYSQL_PASSWORD\s*\|\|\s*['"]123456['"]/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/ }
]

const findings = []
for (const file of tracked) {
  if (excluded.some(function(rule) { return rule.test(file) })) continue
  const absolute = path.join(root, file)
  let content
  try {
    content = fs.readFileSync(absolute, 'utf8')
  } catch (err) {
    continue
  }
  for (const pattern of patterns) {
    if (pattern.regex.test(content)) findings.push(file + ': ' + pattern.name)
  }
}

assert.deepStrictEqual(findings, [], 'potential secrets or weak defaults found:\n' + findings.join('\n'))
console.log('secret-scan-check passed')
