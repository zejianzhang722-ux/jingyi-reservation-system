const MODULE_DEFINITIONS = [
  { keys: ['accounts', 'account'], label: '账号管理', subject: '账号' },
  { keys: ['admins', 'admin', 'managers', 'manager'], label: '管理账号', subject: '管理账号' },
  { keys: ['users', 'user'], label: '宿生账号', subject: '宿生账号' },
  { keys: ['rooms', 'room'], label: '功能房管理', subject: '功能房' },
  { keys: ['seats', 'seat'], label: '座位管理', subject: '座位' },
  { keys: ['buildings', 'building'], label: '楼栋管理', subject: '楼栋' },
  { keys: ['reservations', 'reservation'], label: '预约管理', subject: '预约' },
  { keys: ['audit'], label: '预约审核', subject: '预约' },
  { keys: ['posters', 'poster'], label: '海报审核', subject: '海报' },
  { keys: ['feedback'], label: '反馈管理', subject: '反馈' },
  { keys: ['violations', 'violation'], label: '违规记录', subject: '违规记录' },
  { keys: ['checkin', 'checkins'], label: '签到核销', subject: '预约' },
  { keys: ['reading-room', 'reading_room', 'readingroom'], label: '阅览室记录', subject: '阅览记录' },
  { keys: ['credit', 'blacklist'], label: '信用管理', subject: '信用记录' },
  { keys: ['student-admin', 'student_admin'], label: '宿生账号', subject: '宿生账号' },
  { keys: ['account-batch', 'account_batch'], label: '批量账号导入', subject: '账号' },
  { keys: ['system', 'system_config', 'config', 'archive'], label: '系统管理', subject: '系统设置' },
  { keys: ['announcements', 'announcement'], label: '公告管理', subject: '公告' },
  { keys: ['backups', 'backup'], label: '数据备份', subject: '数据备份' },
  { keys: ['notifications', 'notification'], label: '消息管理', subject: '消息' }
]

const MODULES = MODULE_DEFINITIONS.reduce(function(result, definition) {
  definition.keys.forEach(function(key) {
    result[key] = { label: definition.label, subject: definition.subject }
  })
  return result
}, {})

// Rules are ordered. Both display classification and SQL filtering use this exact source.
const ACTION_RULES = [
  { category: 'login', patterns: ['login%', 'http.post.%login%'] },
  { category: 'audit', patterns: [
    '%approve%', '%reject%', '%audit%',
    'http.post.audit%batch%', 'http.put.audit%batch%', 'http.patch.audit%batch%',
    'http.post.poster%clean%', 'http.post.poster%violation%'
  ] },
  { category: 'operate', patterns: [
    '%checkin%', '%checkout%', '%manual%', '%patrol%', '%rebook%', '%waitlist%',
    '%resolve%', '%verify%', '%archive%', '%credit%', '%status%',
    'http.post.reservation%check-conflict%', 'http.post.reading-room%', 'http.post.reading_room%'
  ] },
  { category: 'delete', patterns: ['delete_%', 'disable_%', 'http.delete.%'] },
  { category: 'export', patterns: ['export%', 'http.get.%export%'] },
  { category: 'create', patterns: [
    'create_%', 'batch_create_%',
    'http.post.admin.accounts', 'http.post.admin.rooms', 'http.post.admin.seats.batch',
    'http.post.admin.buildings', 'http.post.admin.managers', 'http.post.admin.announcements',
    'http.post.admin.backup', 'http.post.account-batch', 'http.post.account_batch',
    'http.post.poster', 'http.post.reservation', 'http.post.feedback'
  ] },
  { category: 'update', patterns: ['update_%', 'http.put.%', 'http.patch.%'] },
  { category: 'operate', patterns: ['%'] }
]

const CATEGORY_PATTERNS = ACTION_RULES.reduce(function(result, rule) {
  if (!result[rule.category]) result[rule.category] = []
  result[rule.category].push.apply(result[rule.category], rule.patterns)
  return result
}, {})

function moduleInfo(value) {
  const key = String(value || '').toLowerCase()
  return MODULES[key] || { label: '其他业务', subject: '业务记录' }
}

function likePatternToRegex(pattern) {
  let source = '^'
  String(pattern || '').split('').forEach(function(character) {
    if (character === '%') source += '.*'
    else if (character === '_') source += '.'
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  })
  return new RegExp(source + '$', 'i')
}

function matchesLike(value, pattern) {
  return likePatternToRegex(pattern).test(String(value || ''))
}

function normalizedAction(action, method) {
  const text = String(action || '').toLowerCase()
  if (text) return text
  const verb = String(method || '').toLowerCase()
  return verb ? 'http.' + verb + '.unknown' : 'unknown'
}

function categoryForAction(action, method) {
  const text = normalizedAction(action, method)
  const rule = ACTION_RULES.find(function(candidate) {
    return candidate.patterns.some(function(pattern) { return matchesLike(text, pattern) })
  })
  return rule ? rule.category : 'operate'
}

function actionLabel(action, method, info) {
  const text = normalizedAction(action, method)
  if (text.includes('poster') && text.includes('violation')) return '标记海报违规'
  if (text.includes('poster') && text.includes('clean')) return '清理海报'
  if (text.includes('batch') && (text.includes('audit') || text.includes('approve') || text.includes('reject'))) return '批量审核' + info.subject
  if (text.includes('approve')) return '通过' + info.subject
  if (text.includes('reject')) return '驳回' + info.subject
  if (text.includes('checkout')) return '预约核销'
  if (text.includes('manual')) return '人工签到'
  if (text.includes('patrol')) return '巡查预约'
  if (text.includes('checkin')) return '预约签到'
  if (text.includes('rebook')) return '重新预约'
  if (text.includes('waitlist')) return '加入预约候补'
  if (text.includes('resolve')) return '处理反馈'
  if (text.includes('verify') && text.includes('backup')) return '校验数据备份'
  if (text.includes('archive')) return '学期归档'
  if (text.includes('credit')) return '调整信用分'
  if (text.includes('status')) return '调整账号状态'
  const category = categoryForAction(text, method)
  if (category === 'login') return '登录管理后台'
  if (category === 'create' && text.includes('backup')) return '创建数据备份'
  if (category === 'create' && (text.startsWith('batch_create_') || text.includes('seats.batch') || text.includes('account-batch') || text.includes('account_batch'))) return '批量新增' + info.subject
  if (category === 'create') return '新增' + info.subject
  if (category === 'update') return '更新' + info.subject
  if (category === 'delete') return '删除或停用' + info.subject
  if (category === 'audit') return '审核' + info.subject
  if (category === 'export') return '导出' + info.subject
  return '处理' + info.subject
}

function presentOperationLog(row) {
  const source = row || {}
  const info = moduleInfo(source.target_table || source.targetTable || source.module)
  const category = categoryForAction(source.action, source.method)
  const label = actionLabel(source.action, source.method, info)
  const rawDetail = String(source.description || source.detail || '').trim()
  const technicalDetail = /^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(rawDetail)
  return {
    operatorName: source.real_name || source.realName || source.username || '系统任务',
    action: source.action || '',
    actionCategory: category,
    actionLabel: label,
    moduleLabel: info.label,
    targetDescription: source.target_id || source.targetId ? info.label + '中的指定记录' : info.label,
    targetId: null,
    detail: technicalDetail || !rawDetail ? label : rawDetail,
    sourceRecorded: Boolean(source.ip_hash || source.ipHash),
    createdAt: source.created_at || source.createdAt || ''
  }
}

function sqlBranchForRule(rule, previousPatterns) {
  const clauses = []
  const params = []
  clauses.push('(' + rule.patterns.map(function() { return 'o.action LIKE ?' }).join(' OR ') + ')')
  params.push.apply(params, rule.patterns)
  previousPatterns.forEach(function(pattern) {
    clauses.push('o.action NOT LIKE ?')
    params.push(pattern)
  })
  return { clause: '(' + clauses.join(' AND ') + ')', params }
}

function categorySqlFilter(category) {
  const previousPatterns = []
  const branches = []
  const params = []
  ACTION_RULES.forEach(function(rule) {
    if (rule.category === category) {
      const branch = sqlBranchForRule(rule, previousPatterns)
      branches.push(branch.clause)
      params.push.apply(params, branch.params)
    }
    previousPatterns.push.apply(previousPatterns, rule.patterns)
  })
  return branches.length ? { clause: '(' + branches.join(' OR ') + ')', params } : { clause: '', params: [] }
}

function buildOperationLogFilters(filters) {
  const source = filters || {}
  const clauses = []
  const params = []
  if (source.operatorId) {
    clauses.push('o.operator_id = ?')
    params.push(source.operatorId)
  }
  const operator = String(source.operator || '').trim()
  if (operator) {
    clauses.push('(a.real_name LIKE ? OR a.username LIKE ?)')
    params.push('%' + operator + '%', '%' + operator + '%')
  }
  const categoryFilter = categorySqlFilter(source.category)
  if (categoryFilter.clause) {
    clauses.push(categoryFilter.clause)
    params.push.apply(params, categoryFilter.params)
  }
  if (source.startDate) {
    clauses.push('o.created_at >= ?')
    params.push(String(source.startDate) + ' 00:00:00')
  }
  if (source.endDate) {
    clauses.push('o.created_at <= ?')
    params.push(String(source.endDate) + ' 23:59:59')
  }
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params, category: source.category || '' }
}

function actionMatchesCategory(action, category) {
  return categoryForAction(action) === category
}

function actionMatchesFilter(action, filter) {
  return !filter || !filter.category || actionMatchesCategory(action, filter.category)
}

module.exports = {
  MODULES,
  ACTION_RULES,
  CATEGORY_PATTERNS,
  matchesLike,
  categoryForAction,
  actionLabel,
  presentOperationLog,
  buildOperationLogFilters,
  actionMatchesCategory,
  actionMatchesFilter
}
