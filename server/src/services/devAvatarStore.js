const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');
const storeFile = path.join(dataDir, 'mock-avatars.json');

function isEnabled() {
  return process.env.NODE_ENV !== 'production' && String(process.env.ALLOW_MOCK_DB || '').toLowerCase() !== 'false';
}

function readStore() {
  if (!isEnabled()) return {};
  try {
    if (!fs.existsSync(storeFile)) return {};
    const parsed = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeStore(data) {
  if (!isEnabled()) return;
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(storeFile, JSON.stringify(data || {}, null, 2), 'utf8');
  } catch (err) {}
}

function safeAvatar(avatar) {
  const value = String(avatar || '').trim();
  if (!value) return '';
  if (/^\/uploads\/[A-Za-z0-9_-]{1,80}\.(png|jpg)$/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return '';
}

function keysForUser(user) {
  if (!user) return [];
  const keys = [];
  if (user.id !== undefined && user.id !== null) keys.push('id:' + user.id);
  if (user.student_no) keys.push('student_no:' + user.student_no);
  if (user.student_id) keys.push('student_id:' + user.student_id);
  if (user.openid) keys.push('openid:' + user.openid);
  return Array.from(new Set(keys));
}

function getAvatar(user) {
  if (!isEnabled()) return '';
  const store = readStore();
  const keys = keysForUser(user);
  for (let index = 0; index < keys.length; index += 1) {
    const avatar = safeAvatar(store[keys[index]]);
    if (avatar) return avatar;
  }
  return '';
}

function saveAvatar(user, avatar) {
  if (!isEnabled()) return;
  const cleanAvatar = safeAvatar(avatar);
  if (!cleanAvatar) return;
  const store = readStore();
  keysForUser(user).forEach(function(key) {
    store[key] = cleanAvatar;
  });
  writeStore(store);
}

function applyAvatar(user) {
  if (!user) return user;
  const avatar = getAvatar(user);
  if (!avatar) return user;
  return Object.assign({}, user, { avatar: avatar });
}

module.exports = {
  isEnabled,
  getAvatar,
  saveAvatar,
  applyAvatar
};
