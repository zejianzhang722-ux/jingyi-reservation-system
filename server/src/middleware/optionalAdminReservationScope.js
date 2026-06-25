const optionalAdminScope = require('./optionalAdminScope');
const adminScope = require('./adminScope');

module.exports = function optionalAdminReservationScope(paramName) {
  const name = paramName || 'id';
  return function(req, res, next) {
    optionalAdminScope(req, res, function(err) {
      if (err) return next(err);
      if (!req.adminScope) return next();
      return adminScope.reservationFromParam(name)(req, res, next);
    });
  };
};
