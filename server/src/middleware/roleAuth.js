function requireRole() {
  var roles = Array.prototype.slice.call(arguments)
  return function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '未登录' })
    }
    if (roles.length === 0) return next()
    var userRole = req.user.role
    if (roles.indexOf(userRole) === -1) {
      return res.status(403).json({ code: 403, message: '权限不足' })
    }
    next()
  }
}

module.exports = { requireRole: requireRole }
