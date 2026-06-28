const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const creditService = require('../services/creditService');
const config = require('../config');

const DEFAULT_LOCATIONS = [
  { id: 1, name: 'B座1楼公告栏', location: 'B座1楼大厅' },
  { id: 2, name: 'C座1楼公告栏', location: 'C座1楼大厅' },
  { id: 3, name: 'D座1楼公告栏', location: 'D座1楼大厅' },
  { id: 4, name: 'B座5楼公告栏', location: 'B座5楼走廊' }
];

function clean(value) { return String(value || '').trim(); }
function normalizeDate(value) { return clean(value); }
function isDateText(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')); }

function normalizePosterPayload(body) {
  body = body || {};
  return {
    title: clean(body.title),
    organization: clean(body.organization),
    startDate: normalizeDate(body.startDate || body.start_date),
    endDate: normalizeDate(body.endDate || body.end_date),
    contactName: clean(body.contactName || body.contactPerson || body.contact_person || body.contact_name),
    contactPhone: clean(body.contactPhone || body.contact_phone),
    description: clean(body.description || body.content),
    imageUrl: clean(body.imageUrl || body.posterImage || body.image_url || body.poster_image),
    position: clean(body.position || body.locationName || body.location_name),
    positionIndex: parseInt(body.positionIndex || body.position_index || body.locationId || body.location_id || 0, 10) || 0
  };
}

function validatePosterPayload(data) {
  if (!data.title) return '请填写海报标题';
  if (data.title.length > 100) return '海报标题不能超过100字';
  if (!data.organization) return '请填写组织名称';
  if (data.organization.length > 100) return '组织名称不能超过100字';
  if (!data.contactName) return '请填写联系人';
  if (data.contactName.length > 50) return '联系人不能超过50字';
  if (!/^1\d{10}$/.test(data.contactPhone)) return '联系电话应为11位手机号';
  if (!isDateText(data.startDate)) return '请选择开始日期';
  if (!isDateText(data.endDate)) return '请选择结束日期';
  if (data.startDate > data.endDate) return '结束日期不能早于开始日期';
  if (data.description && data.description.length > 500) return '海报内容不能超过500字';
  return '';
}

const locations = async function(req, res) {
  return response.success(res, DEFAULT_LOCATIONS);
};

const uploadImage = async function(req, res) {
  try {
    const secureFile = req.secureFile || req.file;
    if (!secureFile || !secureFile.url) return response.error(res, '请上传海报图片', 400);
    return response.success(res, { url: secureFile.url, imageUrl: secureFile.url, filename: secureFile.filename, mime: secureFile.mimetype, width: secureFile.width, height: secureFile.height, size: secureFile.size }, '上传成功');
  } catch (err) {
    logger.error('海报图片上传异常:', err);
    return response.error(res, err.message || '上传失败');
  }
};

const create = async function(req, res) {
  try {
    const data = normalizePosterPayload(req.body);
    const error = validatePosterPayload(data);
    if (error) return response.error(res, error, 400);
    const userId = req.user.id;

    const [result] = await db.query(
      'INSERT INTO posters (user_id, title, organization, start_date, end_date, contact_name, contact_phone, description, image_url, position, position_index, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
      [userId, data.title, data.organization, data.startDate, data.endDate, data.contactName, data.contactPhone, data.description || '', data.imageUrl || '', data.position || '', data.positionIndex || 0, 'pending']
    );

    return response.success(res, { id: result.insertId }, '海报申请已提交');
  } catch (err) {
    logger.error('海报申请异常:', err);
    return response.error(res, err.message);
  }
};

const list = async function(req, res) {
  try {
    const { page = 1, pageSize = 10, status } = req.query;
    const offset = (page - 1) * pageSize;

    let sql = 'SELECT p.*, u.nickname, u.real_name, u.student_id, u.student_no FROM posters p JOIN users u ON p.user_id = u.id WHERE 1=1';
    const params = [];

    if (status) { sql += ' AND p.status = ?'; params.push(status); }

    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(pageSize), parseInt(offset));

    const [posters] = await db.query(sql, params);

    let countSql = 'SELECT COUNT(*) as total FROM posters WHERE 1=1';
    const countParams = [];
    if (status) { countSql += ' AND status = ?'; countParams.push(status); }
    const [countResult] = await db.query(countSql, countParams);

    return response.paginate(res, posters, countResult[0].total, page, pageSize);
  } catch (err) {
    logger.error('获取海报列表异常:', err);
    return response.error(res, err.message);
  }
};

const approve = async function(req, res) {
  try {
    const posterId = req.params.id;
    const { position, positionIndex } = req.body;

    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) return response.error(res, '海报申请不存在', 404);
    if (posters[0].status !== 'pending') return response.error(res, '仅待审核海报可以通过', 400);

    await db.query(
      "UPDATE posters SET status = 'approved', approved_at = NOW(), approved_by = ?, position = ?, position_index = ? WHERE id = ?",
      [req.user.id, clean(position) || posters[0].position || '', parseInt(positionIndex || posters[0].position_index || 0, 10) || 0, posterId]
    );

    const notificationService = require('../services/notificationService');
    await notificationService.createNotification(posters[0].user_id, 'poster_approved', '海报审核通过', '您的海报"' + posters[0].title + '"已审核通过', { posterId: posterId });

    return response.success(res, null, '审核通过');
  } catch (err) {
    logger.error('海报审核通过异常:', err);
    return response.error(res, err.message);
  }
};

const reject = async function(req, res) {
  try {
    const posterId = req.params.id;
    const reason = clean(req.body && req.body.reason);
    if (!reason) return response.error(res, '请填写驳回原因', 400);

    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) return response.error(res, '海报申请不存在', 404);
    if (posters[0].status !== 'pending') return response.error(res, '仅待审核海报可以驳回', 400);

    await db.query(
      "UPDATE posters SET status = 'rejected', approved_at = NOW(), approved_by = ?, reject_reason = ? WHERE id = ?",
      [req.user.id, reason, posterId]
    );

    const notificationService = require('../services/notificationService');
    await notificationService.createNotification(posters[0].user_id, 'poster_rejected', '海报审核驳回', '您的海报"' + posters[0].title + '"被驳回：' + reason, { posterId: posterId });

    return response.success(res, null, '已驳回');
  } catch (err) {
    logger.error('海报审核驳回异常:', err);
    return response.error(res, err.message);
  }
};

const cleanPoster = async function(req, res) {
  try {
    const posterId = req.params.id;
    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) return response.error(res, '海报不存在', 404);
    if (posters[0].status !== 'approved') return response.error(res, '仅已通过海报可以标记清理', 400);
    await db.query("UPDATE posters SET status = 'cleaned', cleaned_at = NOW() WHERE id = ?", [posterId]);
    return response.success(res, null, '已标记为清理');
  } catch (err) {
    logger.error('海报清理异常:', err);
    return response.error(res, err.message);
  }
};

const violation = async function(req, res) {
  try {
    const posterId = req.params.id;
    const [posters] = await db.query('SELECT * FROM posters WHERE id = ?', [posterId]);
    if (posters.length === 0) return response.error(res, '海报不存在', 404);
    if (posters[0].status !== 'approved') return response.error(res, '仅已通过海报可以标记违规', 400);
    await db.query("UPDATE posters SET status = 'violation' WHERE id = ?", [posterId]);
    await creditService.addCredit(posters[0].user_id, config.credit.violationPenalty, 'poster_violation', '海报栏违规');
    return response.success(res, null, '已标记违规并扣分');
  } catch (err) {
    logger.error('海报违规异常:', err);
    return response.error(res, err.message);
  }
};

module.exports = { locations, uploadImage, create, list, approve, reject, clean: cleanPoster, violation };
