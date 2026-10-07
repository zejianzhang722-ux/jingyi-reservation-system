const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const redis = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const response = require('../utils/response');
const wechat = require('../utils/wechat');
const adminCapabilityService = require('../services/adminCapabilityService');
const adminName = require('../utils/adminNamePresenter');

const getAdminCapabilities = async function(adminId) {
  try {
    return await adminCapabilityService.listActiveCapabilities(adminId);
  } catch (err) {
    logger.warn('登录时加载临时授权失败（已降级为空）:', err && err.message ? err.message : err);
    return [];
  }
};

const getCalculatedCreditScore = async function(user) {
  const score = user.credit_score === null || user.credit_score === undefined ? NaN : Number(user.credit_score);
  return Number.isFinite(score) ? score : config.credit.initialScore;
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

    if (code && code.startsWith('mock_code_') && !config.wechat.allowMockLogin) {
      return response.error(res, '模拟登录仅限测试环境', 403);
    }

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

    if (require('../services/creditBookingPolicy').isAccountDisabled(user)) {
      return response.error(res, '账号已被停用', 403);
    }

    await require('../services/creditService').clearLegacyCreditRestriction(user);
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
    const capabilities = await getAdminCapabilities(admin.id);

    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: admin.id,
        username: admin.username,
        name: adminName(admin.real_name, admin.role) || admin.username || '',
        realName: adminName(admin.real_name, admin.role) || '',
        role: admin.role,
        buildingId: admin.building_id,
        scopeType: admin.role === 'super_admin' || admin.role === 'counselor' ? 'global' : admin.scope_type,
        capabilities: capabilities
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

    if (!username || !password) {
      return response.error(res, '请输入用户名和密码', 400);
    }

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

    const validRoles = ['super_admin', 'admin', 'counselor', 'dorm_manager'];
    if (!validRoles.includes(admin.role)) {
      return response.error(res, '账号角色无效', 403);
    }
    if (admin.role === 'dorm_manager' && !require('../utils/adminScope').normalizeAdminScope(admin.role, admin.scope_type, admin.building_id)) {
      return response.error(res, '宿管尚未分配负责楼栋，请联系导生会会长团', 403);
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
    const capabilities = await getAdminCapabilities(admin.id);

    return response.success(res, {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      userInfo: {
        id: admin.id,
        username: admin.username,
        name: adminName(admin.real_name, admin.role) || admin.username || '',
        realName: adminName(admin.real_name, admin.role) || '',
        role: admin.role,
        buildingId: admin.building_id,
        scopeType: admin.role === 'super_admin' || admin.role === 'counselor' ? 'global' : admin.scope_type,
        capabilities: capabilities
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
      return response.error(res, '请输入学号和一卡通卡号', 400);
    }
    if (!/^\d{9,10}$/.test(studentNo)) {
      return response.error(res, '学号应为9-10位数字', 400);
    }
    if (!/^\d{6}$/.test(cardNo)) {
      return response.error(res, '一卡通卡号应为6位数字', 400);
    }
    const [users] = await db.query('SELECT * FROM users WHERE (student_id = ? OR student_no = ?) AND card_no = ?', [studentNo, studentNo, cardNo]);
    if (users.length === 0) {
      return response.error(res, '学号或一卡通卡号错误', 401);
    }
    const user = users[0];
    if (require('../services/creditBookingPolicy').isAccountDisabled(user)) {
      return response.error(res, '账号已被停用', 403);
    }
    await require('../services/creditService').clearLegacyCreditRestriction(user);
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
        openid: user.openid || '',
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
        credit_score: creditScore
      }
    });
  } catch (err) {
    logger.error('学生登录异常:', err);
    return response.error(res, err.message);
  }
};

// refreshToken 函数已删除：经 Grep 核实在 server/src 中无调用点（死代码），
// /auth/refresh 路由实际使用 tokenController.refresh（已安全实现 fail-closed + rotation）。
// 如需恢复，请参照 tokenController.refresh 的安全实现，而非历史版本。


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

module.exports = { wechatLogin, adminLogin, adminMiniappLogin, studentLogin, logout };
