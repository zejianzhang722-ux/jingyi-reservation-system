const MODULES = {
  accounts: { label: '账号管理', subject: '账号' },
  admins: { label: '管理账号', subject: '管理账号' },
  users: { label: '宿生账号', subject: '宿生账号' },
  rooms: { label: '功能房管理', subject: '功能房' },
  room: { label: '功能房管理', subject: '功能房' },
  seats: { label: '座位管理', subject: '座位' },
  buildings: { label: '楼栋管理', subject: '楼栋' },
  reservations: { label: '预约管理', subject: '预约' },
  reservation: { label: '预约管理', subject: '预约' },
  audit: { label: '预约审核', subject: '预约' },
  posters: { label: '海报审核', subject: '海报' },
  poster: { label: '海报审核', subject: '海报' },
  feedback: { label: '反馈管理', subject: '反馈' },
  violations: { label: '违规记录', subject: '违规记录' },
  system: { label: '系统管理', subject: '系统设置' },
  system_config: { label: '系统设置', subject: '系统设置' },
  announcements: { label: '公告管理', subject: '公告' },
  backups: { label: '数据备份', subject: '数备份' }
};

const CATEGORY_PATTERNS = {
  login: ['login%', 'http.post.%login%'],
  create: ['create_%', 'batch_create_%', 'http.post.%'],
  update: ['update_%', 'archive_%', 'http.put.%', 'http.patch.%'],
  delete: ['delete_%', 'disable_%', 'http.delete.%'],
  audit: ['approve%', 'reject%', 'audit%', 'http.post.%approve%', 'http.post.%reject%'],
  export: ['export%', 'backup_%', 'http.get.%export%']
};

function moduleInfo(value) {
  return MODULES[String(value || '').toLowerCase()] || { label: '其他业务', subject: '业务记录' };
}

function categoryForAction(action, method) {
  const text = String(action || '').toLowerCase();
  const verb = String(method || '').toLowerCase();
  if (text.includes('login')) return 'login';
  if (/(^|[._])approve|(^|[._])reject|(^|[._])audit/.test(text)) return 'audit';
  if (text.startsWith('create_') || text.startsWith('batch_create_') || text.startsWith('http.post.') || verb === 'post') return 'create';
  if (text.startsWith('update_') || text.startsWith('archive_') || text.startsWith('http.put.') || text.startsWith('http.patch.') || verb === 'put' || verb === 'patch') return 'update';
  if (text.startsWith('delete_') || text.startsWith('disable_') || text.startsWith('http.delete.') || verb === 'delete') return 'delete';
  if (text.startsWith('export') || text.startsWith('backup_')) return 'export';
  return 'other';
}

function actionLabel(action, method, info) {
  const text = String(action || '').toLowerCase();
  if (text.includes('approve')) return '通过' + info.subject;
  if (text.includes('reject')) return '驳回' + info.subject;
  if (text.includes('backup')) return '数据备份';
  if (text.includes('archive')) return '学期归档';
  const category = categoryForAction(text, method);
  if (category === 'login') return '登录管理后台';
  if (category === 'create') return '新增' + info.subject;
  if (category === 'update') return '更新' + info.subject;
  if (category === 'delete') return '删除或停用' + info.subject;
  if (category === 'audit') return '审核' + info.subject;
  if (category === 'export') return '导出' + info.subject;
  return info.label + '相关操作';
}

function presentOperationLog(row) {
  const source = row || {};
  const info = moduleInfo(source.target_table || source.targetTable || source.module);
  const category = categoryForAction(source.action, source.method);
  const label = actionLabel(source.action, source.method, info);
  const rawDetail = String(source.description || source.detail || '').trim();
  const technicalDetail = /^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(rawDetail);
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
  };
}

function buildOperationLogFilters(filters) {
  const source = filters || {};
  const clauses = [];
  const params = [];
  if (source.operatorId) {
    clauses.push('o.operator_id = ?');
    params.push(source.operatorId);
  }
  const operator = String(source.operator || '').trim();
  if (operator) {
    clauses.push('(a.real_name LIKE ? OR a.username LIKE ?)');
    params.push('%' + operator + '%', '%' + operator + '%');
  }
  const patterns = CATEGORY_PATTERNS[source.category] || [];
  if (patterns.length) {
    clauses.push('(' + patterns.map(function() { return 'o.action LIKE ?'; }).join(' OR ') + ')');
    params.push.apply(params, patterns);
    if (source.category === 'create') {
      const excludedPostActions = ['http.post.%approve%', 'http.post.%reject%', 'http.post.%login%'];
      excludedPostActions.forEach(function(pattern) {
        clauses.push('o.action NOT LIKE ?');
        params.push(pattern);
      });
    }
  }
  if (source.startDate) {
    clauses.push('o.created_at >= ?');
    params.push(String(source.startDate) + ' 00:00:00');
  }
  if (source.endDate) {
    clauses.push('o.created_at <= ?');
    params.push(String(source.endDate) + ' 23:59:59');
  }
  return { clause: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params: params };
}

module.exports = { MODULES, CATEGORY_PATTERNS, categoryForAction, actionLabel, presentOperationLog, buildOperationLogFilters };
