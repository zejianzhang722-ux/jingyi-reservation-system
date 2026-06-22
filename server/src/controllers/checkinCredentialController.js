const QRCode = require('qrcode');
const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const credentialService = require('../services/checkinCredentialService');

const ensureProductionDatabase = function() {
  if (process.env.NODE_ENV === 'production' && db.isMock()) {
    const err = new Error('动态签到数据库暂不可用');
    err.httpStatus = 503;
    throw err;
  }
};

const issue = async function(req, res) {
  try {
    ensureProductionDatabase();
    const reservationId = Number(req.params.id);
    const [reservations] = await db.query(
      'SELECT id, user_id, room_id, date, start_time, end_time, status FROM reservations WHERE id = ?',
      [reservationId]
    );
    // 查询过程中数据库连接也可能触发旧版自动 Mock 回退，因此再次检查。
    ensureProductionDatabase();

    if (!reservations || reservations.length === 0) {
      return response.error(res, '预约不存在', 404);
    }

    const reservation = reservations[0];
    const isAdmin = ['admin', 'super_admin', 'counselor'].includes(req.user.role);
    if (!isAdmin && Number(reservation.user_id) !== Number(req.user.id)) {
      return response.error(res, '无权查看此签到凭证', 403);
    }

    if (reservation.status !== 'approved') {
      if (reservation.status === 'checked_in') {
        return response.error(res, '该预约已完成签到', 409);
      }
      return response.error(res, '当前预约状态不能生成签到凭证', 400);
    }

    const issued = await credentialService.issue(reservation);
    const qrPayload = JSON.stringify({
      type: 'jingyi-checkin',
      version: 1,
      reservationId: reservation.id,
      credential: issued.credential
    });
    const qrImage = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 420
    });

    return response.success(res, {
      qrcode: qrImage,
      credential: issued.credential,
      code: issued.reference,
      expiresAt: issued.expiresAt,
      expiresIn: issued.expiresIn,
      refreshAfter: issued.refreshAfter
    });
  } catch (err) {
    logger.error('生成动态签到凭证异常:', err);
    return response.error(
      res,
      err.httpStatus === 503 ? err.message : '生成动态签到凭证失败',
      err.httpStatus || 500
    );
  }
};

module.exports = { issue, ensureProductionDatabase };
