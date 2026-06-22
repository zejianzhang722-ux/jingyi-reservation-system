const db = require('../config/database');
const logger = require('../config/logger');
const redis = require('../config/redis');

const createNotification = async function(userId, type, title, content, data) {
  try {
    const [result] = await db.query(
      'INSERT INTO notifications (user_id, type, title, content, data, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, NOW())',
      [userId, type, title, content, JSON.stringify(data || {})]
    );

    const notification = {
      id: result.insertId,
      userId: userId,
      type: type,
      title: title,
      content: content,
      data: data,
      createdAt: new Date().toISOString()
    };

    await pushToUser(userId, 'notification', notification);

    return notification;
  } catch (err) {
    logger.error('创建通知异常:', err);
    throw err;
  }
};

const pushToUser = async function(userId, event, data) {
  try {
    const { io } = require('../app');
    if (io) {
      io.to('user:' + userId).emit(event, data);
    }
  } catch (err) {
    logger.error('WebSocket推送异常:', err);
  }
};

const pushToRoom = async function(roomId, event, data) {
  try {
    const { io } = require('../app');
    if (io) {
      io.to('room:' + roomId).emit(event, data);
    }
  } catch (err) {
    logger.error('WebSocket房间推送异常:', err);
  }
};

const pushToAll = async function(event, data) {
  try {
    const { io } = require('../app');
    if (io) {
      io.emit(event, data);
    }
  } catch (err) {
    logger.error('WebSocket全局推送异常:', err);
  }
};

const sendWechatNotification = async function(userId, templateId, templateData, page) {
  try {
    const [users] = await db.query('SELECT openid FROM users WHERE id = ?', [userId]);
    if (users.length === 0 || !users[0].openid) return;

    const wechat = require('../utils/wechat');
    await wechat.sendSubscribeMessage(users[0].openid, templateId, templateData, page);
  } catch (err) {
    logger.error('微信通知发送异常:', err);
  }
};

const batchCreateNotification = async function(userIds, type, title, content, data) {
  try {
    for (const userId of userIds) {
      await createNotification(userId, type, title, content, data);
    }
  } catch (err) {
    logger.error('批量创建通知异常:', err);
  }
};

module.exports = {
  createNotification,
  pushToUser,
  pushToRoom,
  pushToAll,
  sendWechatNotification,
  batchCreateNotification
};
