const crypto = require('crypto');
const config = require('../config');
const redis = require('../config/redis');

const PREFIX = 'JY1';
const CLOCK_SKEW_SECONDS = 15;
const CREDENTIAL_SECRET = process.env.CHECKIN_CREDENTIAL_SECRET || config.jwt.secret;
const CREDENTIAL_TTL_SECONDS = Math.max(
  30,
  Math.min(90, Number(process.env.CHECKIN_CREDENTIAL_TTL_SECONDS) || 60)
);
const REFRESH_BEFORE_SECONDS = Math.max(
  10,
  Math.min(30, Number(process.env.CHECKIN_CREDENTIAL_REFRESH_BEFORE_SECONDS) || 15)
);

class CredentialError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'CredentialError';
    this.httpStatus = status || 400;
  }
}

const toBase64Url = function(value) {
  return Buffer.from(value).toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const fromBase64Url = function(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
};

const sign = function(encodedPayload) {
  return toBase64Url(
    crypto.createHmac('sha256', CREDENTIAL_SECRET)
      .update(encodedPayload)
      .digest()
  );
};

const safeEqual = function(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const nonceKey = function(nonce) {
  return 'checkin:credential:nonce:' + nonce;
};

const activeKey = function(reservationId) {
  return 'checkin:credential:active:' + reservationId;
};

const parseInput = function(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new CredentialError('请提供动态签到凭证', 400);

  if (raw.charAt(0) === '{') {
    try {
      const parsed = JSON.parse(raw);
      raw = String(parsed.credential || parsed.code || '').trim();
    } catch (err) {
      throw new CredentialError('签到凭证格式无效', 400);
    }
  }

  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new CredentialError('签到凭证格式无效', 400);
  }

  const encodedPayload = parts[1];
  const signature = parts[2];
  const expectedSignature = sign(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    throw new CredentialError('签到凭证签名无效', 403);
  }

  let payload;
  try {
    payload = JSON.parse(fromBase64Url(encodedPayload));
  } catch (err) {
    throw new CredentialError('签到凭证内容无效', 400);
  }

  return { raw, payload };
};

const validatePayload = function(payload, reservation) {
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.v !== 1 || !payload.n) {
    throw new CredentialError('签到凭证版本无效', 400);
  }
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    throw new CredentialError('签到凭证时间无效', 400);
  }
  if (payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new CredentialError('签到凭证尚未生效', 400);
  }
  if (payload.exp < now) {
    throw new CredentialError('签到凭证已过期，请刷新后重试', 410);
  }
  if (Number(payload.rid) !== Number(reservation.id)) {
    throw new CredentialError('签到凭证与预约不匹配', 403);
  }
  if (Number(payload.uid) !== Number(reservation.user_id)) {
    throw new CredentialError('签到凭证与预约用户不匹配', 403);
  }
  if (Number(payload.room) !== Number(reservation.room_id)) {
    throw new CredentialError('签到凭证与功能房不匹配', 403);
  }
};

const issue = async function(reservation) {
  const ttl = CREDENTIAL_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(18).toString('hex');
  const payload = {
    v: 1,
    rid: Number(reservation.id),
    uid: Number(reservation.user_id),
    room: Number(reservation.room_id),
    iat: now,
    exp: now + ttl,
    n: nonce
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const credential = PREFIX + '.' + encodedPayload + '.' + sign(encodedPayload);
  const currentActiveKey = activeKey(reservation.id);
  const previousNonce = await redis.get(currentActiveKey);

  await redis.set(nonceKey(nonce), JSON.stringify(payload), 'EX', ttl);
  await redis.set(currentActiveKey, nonce, 'EX', ttl);

  if (previousNonce && previousNonce !== nonce) {
    await redis.del(nonceKey(previousNonce));
  }

  return {
    credential,
    payload,
    expiresAt: new Date((now + ttl) * 1000).toISOString(),
    expiresIn: ttl,
    refreshAfter: Math.max(10, ttl - REFRESH_BEFORE_SECONDS),
    reference: 'JY' + nonce.slice(0, 10).toUpperCase()
  };
};

const atomicGetAndDelete = async function(key) {
  try {
    if (typeof redis.getdel === 'function') {
      return await redis.getdel(key);
    }
  } catch (err) {
    // Redis 6.2 以下不支持 GETDEL，继续使用 Lua 原子回退。
  }

  if (typeof redis.eval === 'function') {
    return redis.eval(
      "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
      1,
      key
    );
  }

  throw new CredentialError('签到凭证存储暂不可用，请稍后重试', 503);
};

const consume = async function(input, reservation) {
  const parsed = parseInput(input);
  const payload = parsed.payload;
  validatePayload(payload, reservation);

  const currentNonce = await redis.get(activeKey(reservation.id));
  if (!currentNonce) {
    throw new CredentialError('签到凭证已过期，请刷新后重试', 410);
  }
  if (currentNonce !== payload.n) {
    throw new CredentialError('签到凭证已被刷新，请使用最新凭证', 409);
  }

  const storedPayloadRaw = await atomicGetAndDelete(nonceKey(payload.n));
  if (!storedPayloadRaw) {
    throw new CredentialError('签到凭证已使用或已过期', 409);
  }

  let storedPayload;
  try {
    storedPayload = JSON.parse(storedPayloadRaw);
  } catch (err) {
    throw new CredentialError('签到凭证状态无效', 409);
  }

  if (
    Number(storedPayload.rid) !== Number(payload.rid) ||
    Number(storedPayload.uid) !== Number(payload.uid) ||
    Number(storedPayload.room) !== Number(payload.room) ||
    storedPayload.n !== payload.n ||
    storedPayload.exp !== payload.exp
  ) {
    throw new CredentialError('签到凭证状态不一致', 409);
  }

  return payload;
};

module.exports = {
  CredentialError,
  issue,
  consume,
  parseInput,
  validatePayload,
  CREDENTIAL_TTL_SECONDS
};
