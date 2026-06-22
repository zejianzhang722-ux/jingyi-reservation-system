const db = require('../config/database');
const response = require('../utils/response');

const adminRoles = ['admin', 'super_admin', 'counselor'];

const authorizeReservation = function(getReservationId) {
  return async function(req, res, next) {
    try {
      if (req.user && adminRoles.includes(req.user.role)) {
        return next();
      }

      const reservationId = Number(getReservationId(req));
      if (!Number.isInteger(reservationId) || reservationId <= 0) {
        return response.error(res, '预约ID无效', 400);
      }

      const [reservations] = await db.query(
        'SELECT id, user_id FROM reservations WHERE id = ?',
        [reservationId]
      );
      if (!reservations || reservations.length === 0) {
        return response.error(res, '预约不存在', 404);
      }

      if (Number(reservations[0].user_id) !== Number(req.user.id)) {
        return response.error(res, '无权操作此预约', 403);
      }

      req.authorizedReservation = reservations[0];
      next();
    } catch (err) {
      return response.error(res, '预约权限校验失败', 500);
    }
  };
};

const reservationFromBody = authorizeReservation(function(req) {
  return req.body && req.body.reservationId;
});

const reservationFromParam = function(paramName) {
  return authorizeReservation(function(req) {
    return req.params && req.params[paramName || 'reservationId'];
  });
};

module.exports = { reservationFromBody, reservationFromParam };
