var roleModel = require('./role-model')
var ROLE_CAPABILITIES = {
  dorm_manager: ['scanCheckin'],
  admin: [
    'ordinaryApproval',
    'reservationView',
    'roomView',
    'residentView',
    'violationView',
    'statsView',
    'scanCheckin'
  ],
  counselor: [
    'ordinaryApproval',
    'reservationView',
    'roomView',
    'residentView',
    'violationView',
    'statsView',
    'scanCheckin',
    'counselorApproval',
    'blacklistManage',
    'feedbackManage',
    'posterReview'
  ],
  super_admin: [
    'ordinaryApproval',
    'reservationView',
    'roomView',
    'residentView',
    'violationView',
    'statsView',
    'scanCheckin',
    'counselorApproval',
    'blacklistManage',
    'feedbackManage',
    'posterReview'
  ]
}

function can(role, capability) {
  var capabilities = ROLE_CAPABILITIES[roleModel.normalizeRole(role)]
  return !!capabilities && capabilities.indexOf(capability) !== -1
}

function queueType(role, preferred) {
  if (preferred === 'counselor' && can(role, 'counselorApproval')) return 'counselor'
  return 'admin'
}

function defaultQueueType(role) {
  return can(role, 'counselorApproval') ? 'counselor' : 'admin'
}

function canQuickApprove(role, status) {
  return status === 'pending' && can(role, 'ordinaryApproval')
}

module.exports = {
  ROLE_CAPABILITIES: ROLE_CAPABILITIES,
  can: can,
  queueType: queueType,
  defaultQueueType: defaultQueueType,
  canQuickApprove: canQuickApprove,
  isDormRole: roleModel.isDormRole,
  isGuideRole: roleModel.isGuideRole
}
