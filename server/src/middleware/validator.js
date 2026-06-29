const { body, query, param, validationResult } = require('express-validator');
const response = require('../utils/response');

const validate = function(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors.array().map(function(e) { return e.msg; }).join('; ');
    return response.error(res, msg, 400);
  }
  next();
};

const wechatLoginRules = [body('code').notEmpty().withMessage('微信code不能为空'), validate];
const adminLoginRules = [body('username').notEmpty().withMessage('用户名不能为空'), body('password').notEmpty().withMessage('密码不能为空'), validate];

const createReservationRules = [
  body('roomId').isInt({ min: 1 }).withMessage('功能房ID无效'),
  body('date').isISO8601().withMessage('日期格式无效'),
  body('startTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('开始时间格式无效'),
  body('endTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('结束时间格式无效'),
  body('startHour').optional().isInt({ min: 0, max: 23 }).withMessage('开始小时无效'),
  body('startMin').optional().isInt({ min: 0, max: 59 }).withMessage('开始分钟无效'),
  body('endHour').optional().isInt({ min: 0, max: 24 }).withMessage('结束小时无效'),
  body('endMin').optional().isInt({ min: 0, max: 59 }).withMessage('结束分钟无效'),
  body('seatId').optional().isInt({ min: 1 }).withMessage('座位ID无效'),
  body('purpose').optional().isLength({ max: 200 }).withMessage('用途不能超过200字'),
  validate
];

const updateProfileRules = [
  body('nickname').optional({ checkFalsy: true }).isLength({ min: 1, max: 50 }).withMessage('昵称长度1-50'),
  body('name').optional({ checkFalsy: true }).isLength({ min: 1, max: 50 }).withMessage('姓名长度1-50'),
  body('realName').optional({ checkFalsy: true }).isLength({ min: 1, max: 50 }).withMessage('姓名长度1-50'),
  body('phone').optional({ checkFalsy: true }).isMobilePhone('zh-CN').withMessage('手机号格式无效'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('邮箱格式无效').isLength({ max: 100 }).withMessage('邮箱不能超过100字'),
  body('studentId').optional({ checkFalsy: true }).isLength({ min: 6, max: 20 }).withMessage('学号长度6-20'),
  body('cardNo').optional({ checkFalsy: true }).matches(/^\d{6}$/).withMessage('一卡通号应为6位数字'),
  validate
];

const roomIdRules = [param('id').isInt({ min: 1 }).withMessage('功能房ID无效'), validate];
const reservationIdRules = [param('id').isInt({ min: 1 }).withMessage('预约ID无效'), validate];
const timelineRules = [param('id').isInt({ min: 1 }).withMessage('功能房ID无效'), query('date').isISO8601().withMessage('日期格式无效'), validate];
const auditRules = [param('id').isInt({ min: 1 }).withMessage('审核ID无效'), body('reason').optional().isLength({ max: 500 }).withMessage('原因不能超过500字'), validate];
const checkinRules = [
  body('reservationId').isInt({ min: 1 }).withMessage('预约ID无效'),
  body('credential').optional().isString().isLength({ min: 20, max: 4096 }).withMessage('动态签到凭证无效'),
  body('code').optional().isString().isLength({ min: 20, max: 4096 }).withMessage('动态签到凭证无效'),
  body().custom(function(value) { if (!value || (!value.credential && !value.code)) throw new Error('请提供动态签到凭证'); return true; }),
  validate
];
const posterRules = [body('title').notEmpty().withMessage('标题不能为空').isLength({ max: 100 }).withMessage('标题不能超过100字'), body('organization').notEmpty().withMessage('组织不能为空').isLength({ max: 100 }).withMessage('组织名不能超过100字'), body('startDate').isISO8601().withMessage('开始日期格式无效'), body('endDate').isISO8601().withMessage('结束日期格式无效'), validate];
const violationRules = [body('userId').isInt({ min: 1 }).withMessage('用户ID无效'), body('type').notEmpty().withMessage('违规类型不能为空'), body('description').notEmpty().withMessage('描述不能为空'), body('score').isInt().withMessage('扣分值无效'), validate];
const paginationRules = [query('page').optional().isInt({ min: 1 }).withMessage('页码无效'), query('pageSize').optional().isInt({ min: 1, max: 100 }).withMessage('每页数量无效'), validate];
const bindStudentRules = [body('studentId').notEmpty().withMessage('学号不能为空').isLength({ min: 6, max: 20 }).withMessage('学号长度6-20'), body('realName').notEmpty().withMessage('姓名不能为空').isLength({ max: 50 }).withMessage('姓名不能超过50字'), validate];
const batchAuditRules = [body('ids').isArray({ min: 1 }).withMessage('请选择审核项'), body('ids.*').isInt({ min: 1 }).withMessage('审核ID无效'), body('action').isIn(['approve', 'reject']).withMessage('操作类型无效'), body('reason').optional().isLength({ max: 500 }).withMessage('原因不能超过500字'), validate];
const waitlistRules = [body('roomId').isInt({ min: 1 }).withMessage('功能房ID无效'), body('seatId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('座位ID无效'), body('date').isISO8601().withMessage('日期格式无效'), body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('开始时间格式无效'), body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('结束时间格式无效'), validate];

module.exports = { validate, wechatLoginRules, adminLoginRules, createReservationRules, updateProfileRules, roomIdRules, reservationIdRules, timelineRules, auditRules, checkinRules, posterRules, violationRules, paginationRules, bindStudentRules, batchAuditRules, waitlistRules };
