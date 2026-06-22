var config = require('../config');
var logger = require('../config/logger');
var https = require('https');

var accessTokenCache = { token: null, expiresAt: 0 };

function getAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return Promise.resolve(accessTokenCache.token);
  }

  var appId = config.wechat.appId;
  var appSecret = config.wechat.appSecret;

  return new Promise(function (resolve, reject) {
    var url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=' + appId + '&secret=' + appSecret;
    https.get(url, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try {
          var result = JSON.parse(data);
          if (result.access_token) {
            accessTokenCache.token = result.access_token;
            accessTokenCache.expiresAt = Date.now() + (result.expires_in - 200) * 1000;
            resolve(result.access_token);
          } else {
            logger.error('获取access_token失败:', result);
            reject(new Error(result.errmsg || '获取access_token失败'));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', function (e) {
      reject(e);
    });
  });
}

function sendSubscribeMessage(touser, template_id, page, data) {
  return getAccessToken().then(function (token) {
    return new Promise(function (resolve, reject) {
      var postData = JSON.stringify({
        touser: touser,
        template_id: template_id,
        page: page || '',
        data: data
      });

      var options = {
        hostname: 'api.weixin.qq.com',
        path: '/cgi-bin/message/subscribe/send?access_token=' + token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      };

      var req = https.request(options, function (res) {
        var result = '';
        res.on('data', function (chunk) { result += chunk; });
        res.on('end', function () {
          try {
            var parsed = JSON.parse(result);
            if (parsed.errcode === 0) {
              logger.info('订阅消息发送成功: ' + touser);
              resolve(parsed);
            } else {
              logger.error('订阅消息发送失败:', parsed);
              resolve(parsed);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', function (e) { reject(e); });
      req.write(postData);
      req.end();
    });
  });
}

function sendReservationApproved(openid, roomName, date, startTime, endTime) {
  var templateId = process.env.WX_TEMPLATE_APPROVED || '';
  if (!templateId) { logger.warn('未配置审批通过模板ID'); return Promise.resolve(); }
  return sendSubscribeMessage(openid, templateId, 'pages/my-reservations/my-reservations', {
    thing1: { value: roomName },
    date2: { value: date + ' ' + startTime + '-' + endTime },
    thing3: { value: '您的预约已通过审批' }
  });
}

function sendReservationRejected(openid, roomName, date, reason) {
  var templateId = process.env.WX_TEMPLATE_REJECTED || '';
  if (!templateId) { logger.warn('未配置审批拒绝模板ID'); return Promise.resolve(); }
  return sendSubscribeMessage(openid, templateId, 'pages/my-reservations/my-reservations', {
    thing1: { value: roomName },
    date2: { value: date },
    thing3: { value: reason || '预约未通过审批' }
  });
}

function sendCheckinReminder(openid, roomName, date, startTime) {
  var templateId = process.env.WX_TEMPLATE_CHECKIN || '';
  if (!templateId) { logger.warn('未配置签到提醒模板ID'); return Promise.resolve(); }
  return sendSubscribeMessage(openid, templateId, 'pages/my-reservations/my-reservations', {
    thing1: { value: roomName },
    date3: { value: date + ' ' + startTime },
    thing4: { value: '请准时签到' }
  });
}

module.exports = {
  getAccessToken: getAccessToken,
  sendSubscribeMessage: sendSubscribeMessage,
  sendReservationApproved: sendReservationApproved,
  sendReservationRejected: sendReservationRejected,
  sendCheckinReminder: sendCheckinReminder
};
