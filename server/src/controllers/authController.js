const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const redis = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const response = require('../utils/response');
const wechat = require('../utils/wechat');
const devAvatarStore = require('../services/devAvatarStore');

const getCalculatedCreditScore = async function(user) {
  const fallback = parseInt(user.credit_score) || config.credit.initialScore || 100;
  try {
    const [logs] = await db.query(
      'SELECT id, score_change, created_at FROM credits_log WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 200',
      [user.id]
    );
    if (!logs || logs.length === 0) return fallback;
    logs.sort(function(a, b) {
      const timeA = new Date(a.created_at || 0).getTime();
      const timeB = new Date(b.created_at || 0).getTime();
      if (timeA !== timeB) return timeA - timeB;
      const changeA = Number(a.score_change) || 0;
      const changeB = Number(b.score_change) || 0;
      if ((changeA < 0) !== (changeB < 0)) return changeA < 0 ? -1 : 1;
      return 0;
    });
    return logs.reduce(function(score, log) {
      return score + (Number(log.score_change) || 0);
    }, config.credit.initialScore || 100);
  } catch (err) {
    return fallback;
  }
};

const generateTokens = function(user) {
  const payload = {
    id: user.id,
    openid: user.openid || null,
    role: user.role
  };
  const token = jwt.sign(
    Object.assign({}, payload, { tokenType: 'access' }),
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, jwtid: crypto.randomBytes(16).toString('hex') }
  );
  const refreshToken = jwt.sign(
    Object.assign({}, payload, { tokenType: 'refresh' }),
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn, jwtid: crypto.randomBytes(16).toString('hex') }
  );
  return { token, refreshToken };
};

const normalizeRole = function(role) {
  return role === 'superadmin' ? 'super_admin' : role;
};

const wechatLogin = async function(req, res) {
  try {
    const { code, studentNo, name } = req.body;

    let openid = null;
    let sessionKey = null;
    let matchedUser = null;

    if (code && code.startsWith('mock_code_')) {
      openid = 'test_openid_' + code.replace('mock_code_', '');
      sessionKey = 'mock_session_key';

      if (studentNo) {
        const [existingByStudentNo] = await db.query('SELECT * FROM users WHERE student_id = ? OR student_no = ?', [studentNo, studentNo]);
        if (existingByStudentNo.length > 0) {
          matchedUser = existingByStudentNo[0];
          openid = matchedUser.openid;
        }
      }

      if (!matchedUser) {
        const [existingByOpenid] = await db.query('SELECT * FROM users WHERE openid = ?', [openid]);
        if (existingByOpenid.length > 0) {
          matchedUser = existingByOpenid[0];
        }
      }
    } else {
      const session = await wechat.code2Session(code);
      if (!session || !session.openid) {
        return response.error(res, '微信登录失败', 400);
      }
      openid = session.openid;
      sessionKey = session.session_key;
    }

    let user;
    if (matchedUser) {
      user = matchedUser;
      await db.query('UPDATE users SET session_key = ? WHERE id = ?', [sessionKey, user.id]);
      if (studentNo && !user.student_no && !user.student_id) {
        await db.query('UPDATE users SET student_no = ?, name = ? WHERE id = ?', [studentNo, name || '', user.id]);
        user.student_no = studentNo;
        user.name = name || user.name;
      }
      if (name && user.name !== name && user.nickname === user.name) {
        await db.query('UPDATE users SET name = ? WHERE id = ?', [name, user.id]);
        user.name = name;
      }
    } else {
      let [users] = await db.query('SELECT * FROM users WHERE openid = ?', [openid]);
      if (users.length === 0) {
        const studentNoVal = studentNo || '';
        const nameVal = name || '';
        const [result] = await db.query(
          'INSERT INTO users (openid, session_key, student_no, name, credit_score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [openid, sessionKey, studentNoVal, nameVal, config.credit.initialScore, 'active']
        );
        user = {
          id: result.insertId,
          openid: openid,
          student_no: studentNoVal,
          name: nameVal,
          role: 'student',
          credit_score: config.credit.initialScore,
          status: 'active'
        };
      } else {
        user = users[0];
        await db.query('UPDATE users SET session_key = ? WHERE id = ?', [sessionKey, user.id]);
        if (studentNo && !user.student_no) {
          await db.query('UPDATE users SET student_no = ?, name = ? WHERE id = ?', [studentNo, name || '', user.id]);
          user.student_no = studentNo;
          user.name = name || user.name;
        }
      }
    }

    user = devAvatarStore.applyAvatar(user);

    if (user.status === 'banned') {
      return response.error(res, '账号已被封禁', 403);
    }

    const tokens = generateTokens(user);
    try {
      await redis.set('token:' + user.id, tokens.refreshToken, 'EX', 7 * 24 * 3600);
    } catch(e) {}
    const creditScore = await getCalculatedCreditScore(user);

    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: user.id,
        openid: user.openid,
        nickname: user.nickname || '',
        avatar: user.avatar || '',
        student_no: user.student_no || user.student_id || '',
        name: user.name || user.real_name || '',
        gender: user.gender || '',
        phone: user.phone || '',
        card_no: user.card_no || '',
        college: user.college || '',
        major: user.major || '',
        grade: user.grade || '',
        role: user.role || 'student',
        credit_score: creditScore
      }
    });
  } catch (err) {
    logger.error('微信登录异常:', err);
    return response.error(res, err.message);
  }
};

const adminLogin = async function(req, res) {
  try {
    const { username, password } = req.body;

    const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
    if (admins.length === 0) {
      return response.error(res, '用户名或密码错误', 401);
    }

    const admin = admins[0];
    admin.role = normalizeRole(admin.role);
    if (admins[0].role === 'superadmin') {
      await db.query('UPDATE admins SET role = ? WHERE id = ?', ['super_admin', admin.id]);
    }
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return response.error(res, '用户名或密码错误', 401);
    }

    if (admin.status !== 'active') {
      return response.error(res, '账号已被禁用', 403);
    }

    const tokens = generateTokens({
      id: admin.id,
      openid: admin.username,
      role: admin.role
    });

    try {
      await redis.set('token:admin:' + admin.id, tokens.refreshToken, 'EX', 7 * 24 * 3600);
    } catch(e) {}
    await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);

    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: admin.id,
        username: admin.username,
        name: admin.real_name || admin.username || '',
        realName: admin.real_name || '',
        role: admin.role,
        buildingId: admin.building_id
      }
    });
  } catch (err) {
    logger.error('管理端登录异常:', err);
    return response.error(res, err.message);
  }
};

const adminMiniappLogin = async function(req, res) {
  try {
    const { username, password } = req.body;
    const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
    if (admins.length === 0) {
      return response.error(res, '管理员账号或密码错误', 401);
    }
    const admin = admins[0];
    admin.role = normalizeRole(admin.role);
    if (admins[0].role === 'superadmin') {
      await db.query('UPDATE admins SET role = ? WHERE id = ?', ['super_admin', admin.id]);
    }
    if (admin.status !== 'active') {
      return response.error(res, '管理员账号已被禁用', 403);
    }
    const matched = await bcrypt.compare(password, admin.password);
    if (!matched) {
      return response.error(res, '管理员账号或密码错误', 401);
    }
    const tokens = generateTokens({ id: admin.id, openid: admin.username, role: admin.role });
    try { await redis.set('token:admin:' + admin.id, tokens.refreshToken, 'EX', 7 * 24 * 3600); } catch(e) {}
    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: admin.id,
        username: admin.username,
        name: admin.real_name || admin.username || '',
        realName: admin.real_name || '',
        role: admin.role,
        buildingId: admin.building_id
      }
    });
  } catch (err) {
    logger.error('管理员小程序登录异常:', err);
    return response.error(res, err.message);
  }
};

const studentLogin = async function(req, res) {
  try {
    const { studentNo, cardNo } = req.body;
    if (!studentNo || !cardNo) {
      return response.error(res, '请输入学号和一卡通号', 400);
    }
    const [users] = await db.query(
      'SELECT * FROM users WHERE (student_no = ? OR student_id = ?) AND card_no = ? AND role = ?',
      [studentNo, studentNo, cardNo, 'student']
    );
    if (users.length === 0) {
      return response.error(res, '学号或一卡通号错误', 401);
    }
    let user = users[0];
    user = devAvatarStore.applyAvatar(user);
    if (user.status !== 'active') {
      return response.error(res, '账号已被禁用或未激活', 403);
    }
    const tokens = generateTokens(user);
    try { await redis.set('token:' + user.id, tokens.refreshToken, 'EX', 7 * 24 * 3600); } catch(e) {}
    const creditScore = await getCalculatedCreditScore(user);
    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: user.id,
        openid: user.openid,
        nickname: user.nickname || '',
        avatar: user.avatar || '',
        student_no: user.student_no || user.student_id || '',
        student_id: user.student_id || user.student_no || '',
        name: user.name || user.real_name || '',
        real_name: user.real_name || user.name || '',
        gender: user.gender || '',
        phone: user.phone || '',
        card_no: user.card_no || '',
        college: user.college || '',
        major: user.major || '',
        grade: user.grade || '',
        role: user.role || 'student',
        credit_score: creditScore
      }
    });
  } catch (err) {
    logger.error('学生登录异常:', err);
    return response.error(res, err.message);
  }
};

const refreshToken = async function(req, res) {
  try {
    const authHeaderForRefresh = req.headers.authorization || '';
    const oldAccessToken = authHeaderForRefresh.startsWith('Bearer ') ? authHeaderForRefresh.substring(7) : '';
    const providedRefreshToken = req.body && req.body.refreshToken;
    let decodedRefresh = null;
    if (providedRefreshToken) {
      decodedRefresh = jwt.verify(providedRefreshToken, config.jwt.secret);
    }
    const decodedAccess = oldAccessToken ? jwt.verify(oldAccessToken, config.jwt.secret, { ignoreExpiration: true }) : null;
    const refreshDecoded = decodedRefresh || decodedAccess;
    if (!refreshDecoded) {
      return response.error(res, '请重新登录', 401);
    }
    if (decodedRefresh && decodedAccess && Number(decodedRefresh.id) !== Number(decodedAccess.id)) {
      return response.error(res, '请重新登录', 401);
    }
    const refreshRedisKey = refreshDecoded.role === 'student' ? 'token:' + refreshDecoded.id : 'token:admin:' + refreshDecoded.id;
    let currentRefreshToken = null;
    try {
      currentRefreshToken = await redis.get(refreshRedisKey);
    } catch(e) {}
    if (currentRefreshToken && providedRefreshToken && currentRefreshToken !== providedRefreshToken) {
      return response.error(res, '请重新登录', 401);
    }
    const refreshedTokens = generateTokens({
      id: refreshDecoded.id,
      openid: refreshDecoded.openid,
      role: refreshDecoded.role
    });
    try {
      await redis.set(refreshRedisKey, refreshedTokens.refreshToken, 'EX', 7 * 24 * 3600);
    } catch(e) {}
    return response.success(res, {
      token: refreshedTokens.token,
      refreshToken: refreshedTokens.refreshToken
    });

    const authHeader = req.headers.authorization;
    const oldToken = authHeader.substring(7);

    const decoded = jwt.verify(oldToken, config.jwt.secret, { ignoreExpiration: true });
    let storedRefresh = null;
    try {
      storedRefresh = await redis.get('token:' + decoded.id) || await redis.get('token:admin:' + decoded.id);
    } catch(e) {}

    if (!storedRefresh) {
      return response.error(res, '请重新登录', 401);
    }

    const tokens = generateTokens({
      id: decoded.id,
      openid: decoded.openid,
      role: decoded.role
    });

    try {
      const key = decoded.role === 'student' ? 'token:' + decoded.id : 'token:admin:' + decoded.id;
      await redis.set(key, tokens.refreshToken, 'EX', 7 * 24 * 3600);
    } catch(e) {}

    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken
    });
  } catch (err) {
    logger.error('刷新Token异常:', err);
    return response.error(res, '刷新Token失败', 401);
  }
};

const logout = async function(req, res) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring(7);

    try {
      await redis.set('blacklist:' + token, '1', 'EX', 2 * 3600);
    } catch(e) {}

    if (req.user) {
      try {
        const key = req.user.role === 'student' ? 'token:' + req.user.id : 'token:admin:' + req.user.id;
        await redis.del(key);
      } catch(e) {}
    }

    return response.success(res, null, '退出成功');
  } catch (err) {
    logger.error('退出异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { wechatLogin, adminLogin, adminMiniappLogin, studentLogin, refreshToken, logout };
