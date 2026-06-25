const adminScope = require('./adminScope');

module.exports = function optionalAdminScope(req, res, next) {
  const role = req.user && req.user.role;
  if (role === 'super_admin' || role === 'admin' || role === 'counselor') {
    return adminScope.loadAdminScope(req, res, next);
  }
  next();
};
