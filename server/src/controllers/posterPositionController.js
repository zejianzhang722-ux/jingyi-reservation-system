/**
 * 张贴位置管理（poster_positions）。
 *
 * 背景：管理端 Poster/PositionManage.vue 早已存在，但前端 API 此前把位置相关的 4 个请求
 * 全部打在 `/poster`（海报申请接口）上，读列表读到的是海报申请，写操作更会误增改删海报数据。
 * 后端此前也没有对应的表 / 控制器 / 路由——整块能力属于「从未实现」。本控制器补齐该链路。
 *
 * 数据域：位置按 building_id 归属楼栋，非全院管理员只能读写本楼栋的位置（R-06 数据域隔离）。
 * 隐私：位置是公共配置数据、PII 极少，但列表仍统一走 privacyAuditService.maskRowsForRequest
 * 出口，与仓库 R-14 规范保持一致（viewer 为空时行为不变，兼容既有调用）。
 *
 * 说明：查询不使用表别名，以便在真实 MySQL 与 mock-db 解析器下行为完全一致。
 */

const db = require('../config/database');
const logger = require('../config/logger');
const response = require('../utils/response');
const privacyAuditService = require('../services/privacyAuditService');

const TABLE = 'poster_positions';

/**
 * 分页参数归一：后端 paginationRules 限制 pageSize<=100，这里再二次钳制。
 * @param {object} query express req.query
 * @returns {{page: number, pageSize: number, offset: number}}
 */
function normalizePagination(query) {
  const source = query || {};
  const page = Math.max(1, parseInt(source.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(source.pageSize, 10) || 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * 状态归一：只接受 active / inactive 两个值，其余一律视为「不过滤」。
 * @param {*} status 原始状态
 * @returns {string} 'active' | 'inactive' | ''
 */
function normalizeStatus(status) {
  const value = String(status === undefined || status === null ? '' : status).trim();
  return value === 'active' || value === 'inactive' ? value : '';
}

/**
 * 管理员数据域过滤（与 scopedStatsController.buildingFilter 同模式，此处为无别名单表查询）。
 * @param {object} req express 请求（需已装载 req.adminScope）
 * @returns {{sql: string, params: Array}}
 */
function scopeFilter(req) {
  if (!req.adminScope || req.adminScope.isGlobal) return { sql: '', params: [] };
  return { sql: ' AND building_id = ?', params: [req.adminScope.buildingId] };
}

/**
 * 单条位置的数据域校验：非全院管理员只能操作本楼栋的位置。
 * @param {object} req express 请求
 * @param {*} buildingId 位置所属楼栋
 * @returns {boolean} 是否允许
 */
function canTouch(req, buildingId) {
  if (!req.adminScope || req.adminScope.isGlobal) return true;
  return Number(buildingId) === Number(req.adminScope.buildingId);
}

/**
 * 解析楼栋：优先用 buildingId；否则尝试按楼栋名称精确匹配（兼容旧的文本输入框）。
 * 匹配不到时返回 null（表示「未指定楼栋」，由数据域中间件兜底强制归属）。
 * @param {*} rawBuildingId 楼栋ID
 * @param {*} rawBuilding 楼栋名称
 * @returns {Promise<number|null>}
 */
async function resolveBuildingId(rawBuildingId, rawBuilding) {
  const direct = Number(rawBuildingId);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const text = String(rawBuilding === undefined || rawBuilding === null ? '' : rawBuilding).trim();
  if (!text) return null;
  const [rows] = await db.query('SELECT id, name FROM buildings WHERE name = ?', [text]);
  if (rows && rows.length) return Number(rows[0].id);
  return null;
}

/**
 * 加载楼栋 id -> 名称 映射，用于列表回显「所在楼栋」。
 * 不采用 JOIN，避免与位置自身的 name 列混淆（mock-db 的 JOIN 解析器同样无歧义问题）。
 * @returns {Promise<Map<number, string>>}
 */
async function loadBuildingNames() {
  const [rows] = await db.query('SELECT id, name FROM buildings');
  const map = new Map();
  for (const row of rows || []) map.set(Number(row.id), row.name || '');
  return map;
}

/**
 * 行 -> 前端展示 DTO。building / buildingName 同时提供，兼容新旧页面字段名。
 * @param {object} row 数据行
 * @param {Map<number,string>} buildingNames 楼栋名称映射
 * @returns {object} DTO
 */
function toDto(row, buildingNames) {
  const buildingId = row.building_id === undefined || row.building_id === null ? null : Number(row.building_id);
  const buildingName = buildingId === null ? '' : (buildingNames.get(buildingId) || '');
  return {
    id: row.id,
    name: row.name || '',
    buildingId: buildingId,
    building: buildingName,
    buildingName: buildingName,
    floor: row.floor === undefined || row.floor === null ? 1 : Number(row.floor),
    maxPosters: row.max_posters === undefined || row.max_posters === null ? 0 : Number(row.max_posters),
    currentPosters: row.current_posters === undefined || row.current_posters === null ? 0 : Number(row.current_posters),
    status: row.status || 'active',
    description: row.description || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * 张贴位置列表：支持 keyword（名称模糊）/ status 过滤 + 分页，按数据域隔离。
 * 导出场景同样走本接口（pageSize 上限 100，前端循环翻页）。
 */
const list = async function(req, res) {
  try {
    const page = normalizePagination(req.query);
    const status = normalizeStatus(req.query.status);
    const keyword = String(req.query.keyword === undefined || req.query.keyword === null ? '' : req.query.keyword).trim();
    const scope = scopeFilter(req);

    let where = ' WHERE 1=1';
    const params = [];
    if (status) {
      where += ' AND status = ?';
      params.push(status);
    }
    if (keyword) {
      where += ' AND name LIKE ?';
      params.push('%' + keyword + '%');
    }
    if (scope.sql) {
      where += scope.sql;
      params.push(scope.params[0]);
    }

    const [countRows] = await db.query('SELECT COUNT(*) AS total FROM ' + TABLE + where, params.slice());
    const [rows] = await db.query(
      'SELECT * FROM ' + TABLE + where + ' ORDER BY id ASC LIMIT ? OFFSET ?',
      params.concat([page.pageSize, page.offset])
    );

    const buildingNames = await loadBuildingNames();
    const list_ = (rows || []).map(function(row) { return toDto(row, buildingNames); });

    // R-14 统一出口：位置虽为低敏配置数据，仍与仓库其它列表保持同一脱敏/审计通道。
    const safeList = await privacyAuditService.maskRowsForRequest(req, list_, {
      targetTable: TABLE,
      description: '张贴位置列表'
    });

    return response.paginate(res, safeList, Number(countRows && countRows[0] ? countRows[0].total : 0) || 0, page.page, page.pageSize);
  } catch (err) {
    logger.error('获取张贴位置列表异常:', err);
    return response.error(res, err.message || '获取张贴位置失败');
  }
};

/**
 * 新建张贴位置。
 */
const create = async function(req, res) {
  try {
    const body = req.body || {};
    const name = String(body.name === undefined || body.name === null ? '' : body.name).trim();
    if (!name) return response.error(res, '位置名称不能为空', 400);
    if (name.length > 100) return response.error(res, '位置名称不能超过100字', 400);

    const buildingId = await resolveBuildingId(body.buildingId, body.building);
    if (buildingId !== null && !canTouch(req, buildingId)) {
      return response.error(res, '无权在其他楼栋创建张贴位置', 403);
    }

    const floor = Number.isInteger(Number(body.floor)) && Number(body.floor) > 0 ? Number(body.floor) : 1;
    const maxPosters = Number.isInteger(Number(body.maxPosters)) && Number(body.maxPosters) > 0 ? Number(body.maxPosters) : 4;
    const status = normalizeStatus(body.status) || 'active';
    const description = String(body.description === undefined || body.description === null ? '' : body.description).trim();

    const [result] = await db.query(
      'INSERT INTO ' + TABLE + ' (name, building_id, floor, max_posters, current_posters, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [name, buildingId, floor, maxPosters, 0, status, description]
    );

    return response.success(res, { id: result.insertId }, '张贴位置已创建');
  } catch (err) {
    logger.error('新建张贴位置异常:', err);
    return response.error(res, err.message || '新建张贴位置失败');
  }
};

/**
 * 更新张贴位置（全量覆盖式更新，字段缺省时沿用原值以外的默认规则见代码）。
 */
const update = async function(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return response.error(res, '位置编号无效', 400);

    const [existing] = await db.query('SELECT * FROM ' + TABLE + ' WHERE id = ?', [id]);
    if (!existing || !existing.length) return response.error(res, '张贴位置不存在', 404);
    const current = existing[0];
    if (!canTouch(req, current.building_id)) {
      return response.error(res, '无权修改其他楼栋的张贴位置', 403);
    }

    const body = req.body || {};
    const name = body.name === undefined ? current.name : String(body.name || '').trim();
    if (!name) return response.error(res, '位置名称不能为空', 400);
    if (name.length > 100) return response.error(res, '位置名称不能超过100字', 400);

    let buildingId = current.building_id === undefined || current.building_id === null ? null : Number(current.building_id);
    if (body.buildingId !== undefined || body.building !== undefined) {
      buildingId = await resolveBuildingId(body.buildingId, body.building);
    }
    if (buildingId !== null && !canTouch(req, buildingId)) {
      return response.error(res, '无权将张贴位置迁移到其他楼栋', 403);
    }

    const floor = body.floor === undefined ? current.floor : (Number.isInteger(Number(body.floor)) && Number(body.floor) > 0 ? Number(body.floor) : 1);
    const maxPosters = body.maxPosters === undefined
      ? current.max_posters
      : (Number.isInteger(Number(body.maxPosters)) && Number(body.maxPosters) > 0 ? Number(body.maxPosters) : current.max_posters);
    const status = body.status === undefined ? current.status : (normalizeStatus(body.status) || current.status);
    const description = body.description === undefined ? current.description : String(body.description || '').trim();

    await db.query(
      'UPDATE ' + TABLE + ' SET name = ?, building_id = ?, floor = ?, max_posters = ?, status = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [name, buildingId, floor, maxPosters, status, description, id]
    );

    return response.success(res, { id: id }, '张贴位置已更新');
  } catch (err) {
    logger.error('更新张贴位置异常:', err);
    return response.error(res, err.message || '更新张贴位置失败');
  }
};

/**
 * 删除张贴位置。
 * 采用物理删除：posters 表没有「已删除」语义，与之保持一致（详见迁移文件说明）。
 */
const remove = async function(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return response.error(res, '位置编号无效', 400);

    const [existing] = await db.query('SELECT * FROM ' + TABLE + ' WHERE id = ?', [id]);
    if (!existing || !existing.length) return response.error(res, '张贴位置不存在', 404);
    if (!canTouch(req, existing[0].building_id)) {
      return response.error(res, '无权删除其他楼栋的张贴位置', 403);
    }

    await db.query('DELETE FROM ' + TABLE + ' WHERE id = ?', [id]);

    return response.success(res, null, '张贴位置已删除');
  } catch (err) {
    logger.error('删除张贴位置异常:', err);
    return response.error(res, err.message || '删除张贴位置失败');
  }
};

module.exports = { list, create, update, remove };
