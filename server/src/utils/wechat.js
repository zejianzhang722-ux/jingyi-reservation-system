const axios = require('axios');
const config = require('../config');
const logger = require('../config/logger');

const code2Session = async function(code) {
  try {
    const url = 'https://api.weixin.qq.com/sns/jscode2session';
    const response = await axios.get(url, {
      params: {
        appid: config.wechat.appId,
        secret: config.wechat.appSecret,
        js_code: code,
        grant_type: 'authorization_code'
      }
    });
    if (response.data.errcode) {
      logger.error('微信登录失败:', response.data);
      return null;
    }
    return {
      openid: response.data.openid,
      session_key: response.data.session_key,
      unionid: response.data.unionid
    };
  } catch (err) {
    logger.error('微信API调用异常:', err.message);
    return null;
  }
};

const getAccessToken = async function() {
  try {
    const redis = require('../config/redis');
    const cached = await redis.get('wechat:access_token');
    if (cached) {
      return cached;
    }
    const url = 'https://api.weixin.qq.com/cgi-bin/token';
    const response = await axios.get(url, {
      params: {
        grant_type: 'client_credential',
        appid: config.wechat.appId,
        secret: config.wechat.appSecret
      }
    });
    if (response.data.errcode) {
      logger.error('获取access_token失败:', response.data);
      return null;
    }
    const token = response.data.access_token;
    const expiresIn = response.data.expires_in || 7200;
    await redis.set('wechat:access_token', token, 'EX', expiresIn - 300);
    return token;
  } catch (err) {
    logger.error('获取access_token异常:', err.message);
    return null;
  }
};

const sendSubscribeMessage = async function(openid, templateId, data, page) {
  try {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      logger.error('发送订阅消息失败: 无法获取access_token');
      return false;
    }
    const url = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send';
    const response = await axios.post(url, {
      touser: openid,
      template_id: templateId,
      page: page || '',
      data: data
    }, {
      params: { access_token: accessToken }
    });
    if (response.data.errcode !== 0) {
      logger.error('发送订阅消息失败:', response.data);
      return false;
    }
    return true;
  } catch (err) {
    logger.error('发送订阅消息异常:', err.message);
    return false;
  }
};

module.exports = { code2Session, getAccessToken, sendSubscribeMessage };
