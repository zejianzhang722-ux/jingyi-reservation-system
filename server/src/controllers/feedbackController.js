var db = require('../config/database')
var response = require('../utils/response')

function toDto(row) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    contact: row.contact || '',
    userId: row.user_id,
    userName: row.user_name || row.real_name || row.name || row.nickname || '匿名',
    status: row.status,
    reply: row.reply || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

exports.create = async function (req, res) {
  try {
    var data = req.body
    if (!data.content || !String(data.content).trim()) {
      return response.error(res, '反馈内容不能为空', 400)
    }

    var userName = req.user && (req.user.name || req.user.realName || req.user.username) || ''
    if (!userName && req.user && req.user.id) {
      var userRows = await db.query('SELECT real_name, name, nickname FROM users WHERE id = ?', [req.user.id])
      if (userRows[0] && userRows[0][0]) {
        userName = userRows[0][0].real_name || userRows[0][0].name || userRows[0][0].nickname || ''
      }
    }

    var now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    var insertResult = await db.query(
      'INSERT INTO feedbacks (user_id, user_name, type, content, contact, status, reply, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [req.user ? req.user.id : null, userName || '匿名', data.type || 'suggestion', String(data.content).trim(), data.contact || '', 'pending', '', now, now]
    )
    var id = insertResult[0].insertId
    var rows = await db.query('SELECT * FROM feedbacks WHERE id = ?', [id])
    return response.success(res, toDto(rows[0][0]), '提交成功')
  } catch (err) {
    return response.error(res, err.message)
  }
}

exports.resolve = async function (req, res) {
  try {
    var id = parseInt(req.params.id)
    var rows = await db.query('SELECT * FROM feedbacks WHERE id = ?', [id])
    if (!rows[0] || rows[0].length === 0) {
      return response.error(res, '反馈不存在', 404)
    }

    await db.query(
      'UPDATE feedbacks SET status = ?, reply = ?, handled_by = ?, handled_at = NOW(), updated_at = NOW() WHERE id = ?',
      ['resolved', req.body.reply || '', req.user ? req.user.id : null, id]
    )
    rows = await db.query('SELECT * FROM feedbacks WHERE id = ?', [id])
    return response.success(res, toDto(rows[0][0]), '处理成功')
  } catch (err) {
    return response.error(res, err.message)
  }
}

exports.list = async function (req, res) {
  try {
    var page = parseInt(req.query.page) || 1
    var pageSize = parseInt(req.query.pageSize) || 20
    var status = req.query.status
    var offset = (page - 1) * pageSize
    var params = []
    var whereSql = ' FROM feedbacks WHERE 1=1'

    if (status) {
      whereSql += ' AND status = ?'
      params.push(status)
    }

    var countRows = await db.query('SELECT COUNT(*) as total' + whereSql, params.slice())
    var rows = await db.query(
      'SELECT *' + whereSql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
      params.concat([pageSize, offset])
    )
    return response.paginate(res, rows[0].map(toDto), countRows[0][0].total, page, pageSize)
  } catch (err) {
    return response.error(res, err.message)
  }
}
