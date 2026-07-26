function normalizeRole(role) {
  return role === 'superadmin' ? 'super_admin' : role;
}

function normalizeAdminScope(role, scopeType, buildingId) {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === 'super_admin' || normalizedRole === 'counselor') {
    return { scopeType: 'global', buildingId: null };
  }
  if (normalizedRole !== 'admin') {
    return { scopeType: null, buildingId: buildingId || null };
  }
  if (scopeType === 'global') {
    return { scopeType: 'global', buildingId: null };
  }
  const id = Number(buildingId);
  if (scopeType === 'building' && Number.isInteger(id) && id > 0) {
    return { scopeType: 'building', buildingId: id };
  }
  return null;
}

module.exports = { normalizeAdminScope };
