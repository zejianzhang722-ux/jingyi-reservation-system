const crypto = require('crypto');
const { Adapter } = require('socket.io-adapter');
const redis = require('../config/redis');
const logger = require('../config/logger');

const DEFAULT_PREFIX = 'runtime:socket:broadcast:';
let initialized = false;
let pubClient = null;
let subClient = null;
let currentMode = 'memory';

const serializeOptions = function(options) {
  const settings = options || {};
  return {
    rooms: Array.from(settings.rooms || []),
    except: Array.from(settings.except || []),
    flags: Object.assign({}, settings.flags || {})
  };
};

const deserializeOptions = function(options) {
  const settings = options || {};
  return {
    rooms: new Set(settings.rooms || []),
    except: new Set(settings.except || []),
    flags: Object.assign({}, settings.flags || {})
  };
};

const encodeBroadcast = function(uid, packet, options) {
  return JSON.stringify({
    version: 1,
    uid,
    packet,
    options: serializeOptions(options)
  });
};

const decodeBroadcast = function(payload) {
  const parsed = JSON.parse(payload);
  if (!parsed || parsed.version !== 1 || !parsed.uid || !parsed.packet) {
    throw new Error('无效的Socket.IO跨实例广播消息');
  }
  return {
    uid: parsed.uid,
    packet: parsed.packet,
    options: deserializeOptions(parsed.options)
  };
};

class RedisBroadcastAdapter extends Adapter {
  constructor(nsp, publisher, subscriber, options) {
    super(nsp);
    const settings = options || {};
    this.uid = settings.uid || crypto.randomUUID();
    this.publisher = publisher;
    this.subscriber = subscriber;
    this.channel = (settings.prefix || DEFAULT_PREFIX) + nsp.name;
    this.closed = false;
    this.onMessage = this.handleMessage.bind(this);
    this.subscriber.on('message', this.onMessage);
    Promise.resolve(this.subscriber.subscribe(this.channel)).catch(function(err) {
      logger.error('[SocketAdapter] 订阅频道失败 channel=' + settings.channel, err);
    });
  }

  handleMessage(channel, payload) {
    if (this.closed || channel !== this.channel) return;
    try {
      const message = decodeBroadcast(payload);
      if (message.uid === this.uid) return;
      Adapter.prototype.broadcast.call(this, message.packet, message.options);
    } catch (err) {
      logger.warn('[SocketAdapter] 忽略无效跨实例消息 channel=' + channel + ' error=' + err.message);
    }
  }

  broadcast(packet, options) {
    const settings = options || {};
    if (!(settings.flags && settings.flags.local)) {
      const payload = encodeBroadcast(this.uid, packet, settings);
      Promise.resolve(this.publisher.publish(this.channel, payload)).catch(function(err) {
        logger.error('[SocketAdapter] 发布跨实例消息失败 channel=' + this.channel, err);
      }.bind(this));
    }
    Adapter.prototype.broadcast.call(this, packet, settings);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.subscriber.removeListener('message', this.onMessage);
    Promise.resolve(this.subscriber.unsubscribe(this.channel)).catch(function() {});
  }
}

const createAdapterFactory = function(publisher, subscriber, options) {
  return function(nsp) {
    return new RedisBroadcastAdapter(nsp, publisher, subscriber, options);
  };
};

const connectClient = async function(client) {
  if (!client) throw new Error('Redis专用连接未创建');
  if (client.status === 'wait') await client.connect();
  if (client.status === 'end') throw new Error('Redis专用连接已关闭');
};

const initSocketAdapter = async function(io, options) {
  if (initialized) return { initialized: true, reused: true, mode: currentMode };
  const settings = options || {};
  const redisClient = settings.redisClient || redis;
  const state = await redisClient.ready();

  if (state.mode !== 'redis' || (typeof redisClient.isMock === 'function' && redisClient.isMock())) {
    if (process.env.NODE_ENV === 'production') {
      const err = new Error('生产环境实时广播必须连接真实Redis');
      err.code = 'SOCKET_REDIS_REQUIRED';
      throw err;
    }
    initialized = true;
    currentMode = 'memory';
    logger.info('[SocketAdapter] 使用单实例内存广播模式');
    return { initialized: true, reused: false, mode: currentMode };
  }

  if (typeof redisClient.duplicate !== 'function') {
    const err = new Error('当前Redis客户端不支持创建Pub/Sub专用连接');
    err.code = 'SOCKET_REDIS_DUPLICATE_UNAVAILABLE';
    throw err;
  }

  pubClient = settings.pubClient || redisClient.duplicate();
  subClient = settings.subClient || redisClient.duplicate();
  await Promise.all([connectClient(pubClient), connectClient(subClient)]);
  await pubClient.ping();
  io.adapter(createAdapterFactory(pubClient, subClient, {
    prefix: settings.prefix || DEFAULT_PREFIX,
    uid: settings.uid
  }));

  initialized = true;
  currentMode = 'redis-broadcast';
  logger.info('[SocketAdapter] Redis跨实例广播已启用');
  return { initialized: true, reused: false, mode: currentMode };
};

const closeSocketAdapter = async function() {
  const clients = [pubClient, subClient].filter(Boolean);
  pubClient = null;
  subClient = null;
  initialized = false;
  currentMode = 'memory';
  for (const client of clients) {
    try {
      if (typeof client.quit === 'function' && client.status !== 'end') await client.quit();
      else if (typeof client.disconnect === 'function') client.disconnect();
    } catch (err) {
      if (typeof client.disconnect === 'function') client.disconnect();
    }
  }
  return { closed: true };
};

const getSocketAdapterState = function() {
  return { initialized, mode: currentMode };
};

module.exports = {
  DEFAULT_PREFIX,
  serializeOptions,
  deserializeOptions,
  encodeBroadcast,
  decodeBroadcast,
  RedisBroadcastAdapter,
  createAdapterFactory,
  initSocketAdapter,
  closeSocketAdapter,
  getSocketAdapterState
};
