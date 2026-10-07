module.exports = function adminName(name, role) {
  return (role === 'super_admin' || role === 'superadmin') && name === '超级管理员' ? '导生会会长团' : name;
};
