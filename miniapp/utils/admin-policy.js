var ROLE_CAPABILITIES = {
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
  var capabilities = ROLE_CAPABILITIES[role]
  return !!capabilities && capabilities.indexOf(capability) !== -1
}

function queueType(role, preferred) {
  if (preferred === 'counselor' && can(role, 'counselorApproval')) return 'counselor'
  return 'admin'
}

module.exports = {
  ROLE_CAPABILITIES: ROLE_CAPABILITIES,
  can: can,
  queueType: queueType
}
