const db = require('../config/database');
const logger = require('../config/logger');

const getUserOpenid = async function(userId) {
  try {
    const [users] = await db.query('SELECT wechat_openid, nickname, real_name FROM users WHERE id = ?', [userId]);
    if (users.length === 0 || !users[0].wechat_openid) {
      return null;
    }
    return { openid: users[0].wechat_openid, nickname: users[0].nickname, realName: users[0].real_name };
  } catch (err) {
    logger.error('获取用户微信openid异常:', err);
    return null;
  }
};

const pushReservationApproval = async function(userId, reservationId, status) {
  try {
    const userWx = await getUserOpenid(userId);
    if (!userWx) {
      return { success: false, message: '用户未绑定微信' };
    }

    const [reservations] = await db.query(
      'SELECT r.*, rm.name as room_name FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
      [reservationId]
    );
    const reservation = reservations[0] || {};
    const statusText = status === 'approved' ? '已通过' : '已驳回';

    const templateMessage = {
      touser: userWx.openid,
      template_id: 'reservation_approval_template',
      page: '/pages/reservation/detail?id=' + reservationId,
      data: {
        first: { value: '您的预约审批结果已出', color: '#173177' },
        keyword1: { value: userWx.realName || userWx.nickname, color: '#173177' },
        keyword2: { value: reservation.room_name || '', color: '#173177' },
        keyword3: { value: (reservation.date || '') + ' ' + (reservation.start_time || '') + '-' + (reservation.end_time || ''), color: '#173177' },
        keyword4: { value: statusText, color: status === 'approved' ? '#07c160' : '#e64340' },
        remark: { value: status === 'approved' ? '请按时签到，祝您使用愉快！' : '如有疑问请联系管理员。', color: '#888888' }
      }
    };

    console.log('========== 微信模板消息推送 ==========');
    console.log('推送类型: 预约审批结果通知');
    console.log('接收用户: ' + userWx.realName + '(' + userWx.openid + ')');
    console.log('预约ID: ' + reservationId);
    console.log('审批结果: ' + statusText);
    console.log('模板消息内容:');
    console.log(JSON.stringify(templateMessage, null, 2));
    console.log('========================================');

    logger.info('微信推送-预约审批: userId=' + userId + ', reservationId=' + reservationId + ', status=' + status);
    return { success: true, message: '推送成功' };
  } catch (err) {
    logger.error('微信推送-预约审批异常:', err);
    return { success: false, message: err.message };
  }
};

const pushReservationReminder = async function(userId, reservationId) {
  try {
    const userWx = await getUserOpenid(userId);
    if (!userWx) {
      return { success: false, message: '用户未绑定微信' };
    }

    const [reservations] = await db.query(
      'SELECT r.*, rm.name as room_name, rm.location FROM reservations r JOIN rooms rm ON r.room_id = rm.id WHERE r.id = ?',
      [reservationId]
    );
    const reservation = reservations[0] || {};

    const templateMessage = {
      touser: userWx.openid,
      template_id: 'reservation_reminder_template',
      page: '/pages/reservation/detail?id=' + reservationId,
      data: {
        first: { value: '您预约的功能房即将开始使用', color: '#173177' },
        keyword1: { value: reservation.room_name || '', color: '#173177' },
        keyword2: { value: reservation.location || '', color: '#173177' },
        keyword3: { value: (reservation.date || '') + ' ' + (reservation.start_time || '') + '-' + (reservation.end_time || ''), color: '#173177' },
        remark: { value: '请提前到达并完成签到，迟到超过规定时间将视为爽约。', color: '#ff9900' }
      }
    };

    console.log('========== 微信模板消息推送 ==========');
    console.log('推送类型: 预约即将开始提醒');
    console.log('接收用户: ' + userWx.realName + '(' + userWx.openid + ')');
    console.log('预约ID: ' + reservationId);
    console.log('功能房: ' + (reservation.room_name || ''));
    console.log('时间: ' + (reservation.date || '') + ' ' + (reservation.start_time || '') + '-' + (reservation.end_time || ''));
    console.log('模板消息内容:');
    console.log(JSON.stringify(templateMessage, null, 2));
    console.log('========================================');

    logger.info('微信推送-预约提醒: userId=' + userId + ', reservationId=' + reservationId);
    return { success: true, message: '推送成功' };
  } catch (err) {
    logger.error('微信推送-预约提醒异常:', err);
    return { success: false, message: err.message };
  }
};

const pushAnnouncement = async function(userId, announcementTitle) {
  try {
    const userWx = await getUserOpenid(userId);
    if (!userWx) {
      return { success: false, message: '用户未绑定微信' };
    }

    const templateMessage = {
      touser: userWx.openid,
      template_id: 'announcement_notify_template',
      page: '/pages/announcement/list',
      data: {
        first: { value: '敬一书院发布新公告', color: '#173177' },
        keyword1: { value: announcementTitle, color: '#173177' },
        keyword2: { value: new Date().toLocaleString('zh-CN'), color: '#888888' },
        remark: { value: '点击查看公告详情。', color: '#888888' }
      }
    };

    console.log('========== 微信模板消息推送 ==========');
    console.log('推送类型: 新公告通知');
    console.log('接收用户: ' + userWx.realName + '(' + userWx.openid + ')');
    console.log('公告标题: ' + announcementTitle);
    console.log('模板消息内容:');
    console.log(JSON.stringify(templateMessage, null, 2));
    console.log('========================================');

    logger.info('微信推送-公告通知: userId=' + userId + ', title=' + announcementTitle);
    return { success: true, message: '推送成功' };
  } catch (err) {
    logger.error('微信推送-公告通知异常:', err);
    return { success: false, message: err.message };
  }
};

const bindWechat = async function(userId, openid) {
  try {
    const [users] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return { success: false, message: '用户不存在' };
    }

    await db.query('UPDATE users SET wechat_openid = ?, updated_at = NOW() WHERE id = ?', [openid, userId]);

    console.log('========== 微信绑定操作 ==========');
    console.log('用户ID: ' + userId);
    console.log('绑定OpenID: ' + openid);
    console.log('绑定时间: ' + new Date().toLocaleString('zh-CN'));
    console.log('===================================');

    logger.info('微信绑定: userId=' + userId + ', openid=' + openid);
    return { success: true, message: '绑定成功' };
  } catch (err) {
    logger.error('微信绑定异常:', err);
    return { success: false, message: err.message };
  }
};

module.exports = {
  pushReservationApproval,
  pushReservationReminder,
  pushAnnouncement,
  bindWechat
};