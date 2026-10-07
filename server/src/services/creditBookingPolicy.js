const config = require('../config');
const helpers = require('../utils/helpers');
function tiers() {
  return [
    { minScore: config.credit.warningThreshold, label: '良好', advanceDays: config.reservation.advanceDays, dailyLimit: 3, startTime: null, endTime: null },
    { minScore: config.credit.restrictThreshold, label: '提醒', advanceDays: 2, dailyLimit: 2, startTime: null, endTime: null },
    { minScore: config.credit.banThreshold, label: '预约受限', advanceDays: 1, dailyLimit: 1, startTime: '08:00', endTime: '20:00' },
    { minScore: 0, label: '预约严格受限', advanceDays: 0, dailyLimit: 1, startTime: '09:00', endTime: '17:00' }
  ].map(rule => ({ ...rule, advanceDays: Math.min(rule.advanceDays, config.reservation.advanceDays) }));
}
function forScore(value) {
  const score = Number(value);
  return tiers().find(rule => (Number.isFinite(score) ? score : 0) >= rule.minScore) || tiers()[3];
}
// Historical timed bans were credit penalties. Permanent account disables are separate.
function isAccountDisabled(user) {
  return ['disabled', 'inactive'].includes(user.status) || (user.status === 'banned' && !user.restricted_until);
}
function fail(code, message) { const error = new Error(message); error.code = code; error.httpStatus = 403; throw error; }
function validate(input, user) {
  if (!user) fail('USER_NOT_FOUND', '用户不存在');
  if (isAccountDisabled(user)) fail('ACCOUNT_DISABLED', '账号已被停用');
  const rule = forScore(user.credit_score);
  const date = input.date instanceof Date ? helpers.formatDate(input.date) : String(input.date).slice(0, 10);
  if (!helpers.isDateInRange(date, rule.advanceDays)) {
    fail('CREDIT_DATE_LIMIT', rule.advanceDays ? '当前信用分仅可预约今天至' + rule.advanceDays + '天后的日期' : '当前信用分仅可预约当天');
  }
  const startTime = String(input.startTime).slice(0, 5);
  const endTime = String(input.endTime).slice(0, 5);
  if (rule.startTime && (startTime < rule.startTime || endTime > rule.endTime)) {
    fail('CREDIT_TIME_LIMIT', '当前信用分仅可预约' + rule.startTime + '至' + rule.endTime + '之间的时段');
  }
  return rule;
}
function description() {
  const rules = tiers();
  return '信用分不限制登录，仅影响新预约、加入组团及修改预约。' + rules.map((r, i) =>
    (i ? r.minScore + '–' + (rules[i - 1].minScore - 1) + '分' : '≥' + r.minScore + '分') + '：' +
    (r.advanceDays ? '可提前' + r.advanceDays + '天' : '仅当天') + '，每天同类功能房最多' + r.dailyLimit + '次，' +
    (r.startTime ? r.startTime + '–' + r.endTime : '按房间开放时间')
  ).join('；') + '。信用分变动后按当前分数即时生效，已有预约仍可查看、取消及签到签退。';
}
module.exports = { tiers, forScore, validate, isAccountDisabled, description };
