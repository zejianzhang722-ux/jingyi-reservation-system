const optionalAdminScope = require('./optionalAdminScope');
const adminScope = require('./adminScope');

module.exports = function optionalAdminReservationBodyScope(fieldName) {
  const name = fieldName || 'reservationId';
  return function(req, res, next) {
    optionalAdminScope(req, res, function(err) {
      if (err) return next(err);
      if (!req.adminScope) return next();
      return adminScope.reservationFromBody(name)(req, res, next);
    });
  };
};
