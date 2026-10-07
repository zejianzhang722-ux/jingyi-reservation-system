/**
 * role-model / admin-policy 断言自测（纯 node，无框架依赖）
 * 运行：node scripts/miniapp-role-model-check.js
 */
const path = require('path');

const miniapp = path.join(__dirname, '..', 'miniapp', 'utils');
const roleModel = require(path.join(miniapp, 'role-model.js'));
const adminPolicy = require(path.join(miniapp, 'admin-policy.js'));

const cases = [
  ...['student', null, undefined, '', 'unknown'].map(role => ['scanPath safe fallback ' + role, roleModel.scanPath(role), '/pages/login/login']),
  ['can superadmin alias scanCheckin', adminPolicy.can('superadmin', 'scanCheckin'), true],
  ['can superadmin alias counselorApproval', adminPolicy.can('superadmin', 'counselorApproval'), true],
  ['homePath admin', roleModel.homePath('admin'), '/pages/admin-home/admin-home'],
  ['homePath counselor', roleModel.homePath('counselor'), '/pages/admin-home/admin-home'],
  ['homePath alias', roleModel.homePath('superadmin'), '/pages/admin-home/admin-home'],
  ...['student', null, undefined, '', 'unknown'].map(role => ['homePath safe fallback ' + role, roleModel.homePath(role), '/pages/login/login']),
  ['homePath dorm_manager', roleModel.homePath('dorm_manager'), '/pages/verification/verification'],
  ['homePath super_admin', roleModel.homePath('super_admin'), '/pages/admin-home/admin-home'],
  ['scanPath dorm_manager', roleModel.scanPath('dorm_manager'), '/pages/dorm-scan/dorm-scan'],
  ['scanPath super_admin', roleModel.scanPath('super_admin'), '/pages/admin-scan/admin-scan'],
  ['scanPath admin', roleModel.scanPath('admin'), '/pages/admin-scan/admin-scan'],
  ['scanPath counselor', roleModel.scanPath('counselor'), '/pages/admin-scan/admin-scan'],
  ['label super_admin', roleModel.label('super_admin'), '导生会会长团'],
  ['label dorm_manager', roleModel.label('dorm_manager'), '宿管'],
  ['label admin', roleModel.label('admin'), '导生管理员'],
  ['label counselor', roleModel.label('counselor'), '书院辅导员'],
  ['label student', roleModel.label('student'), '学生'],
  ['label undefined -> student', roleModel.label(undefined), '学生'],
  ['normalizeRole superadmin', roleModel.normalizeRole('superadmin'), 'super_admin'],
  ['normalizeRole undefined', roleModel.normalizeRole(undefined), 'student'],
  ['tier dorm_manager', roleModel.tier('dorm_manager'), 'dorm'],
  ['tier admin', roleModel.tier('admin'), 'guide'],
  ['isAdminRole dorm_manager', roleModel.isAdminRole('dorm_manager'), true],
  ['isAdminRole student', roleModel.isAdminRole('student'), false],
  ['isGuideRole superadmin(别名)', roleModel.isGuideRole('superadmin'), true],
  ['isGuideRole dorm_manager', roleModel.isGuideRole('dorm_manager'), false],
  ['isDormRole dorm_manager', roleModel.isDormRole('dorm_manager'), true],
  ['can dorm_manager scanCheckin', adminPolicy.can('dorm_manager', 'scanCheckin'), true],
  ['can dorm_manager ordinaryApproval', adminPolicy.can('dorm_manager', 'ordinaryApproval'), false],
  ['can admin feedbackManage', adminPolicy.can('admin', 'feedbackManage'), false],
  ['can counselor feedbackManage', adminPolicy.can('counselor', 'feedbackManage'), true],
  ['can super_admin posterReview', adminPolicy.can('super_admin', 'posterReview'), true],
  ['can student scanCheckin', adminPolicy.can('student', 'scanCheckin'), false],
  ['defaultQueueType counselor', adminPolicy.defaultQueueType('counselor'), 'counselor'],
  ['defaultQueueType super_admin', adminPolicy.defaultQueueType('super_admin'), 'counselor'],
  ['defaultQueueType admin 必须留在预约审核队列', adminPolicy.defaultQueueType('admin'), 'admin'],
  ['defaultQueueType dorm_manager', adminPolicy.defaultQueueType('dorm_manager'), 'admin'],
  ['queueType admin 想要 counselor 会被降级', adminPolicy.queueType('admin', 'counselor'), 'admin'],
  ['queueType counselor 可用 counselor', adminPolicy.queueType('counselor', 'counselor'), 'counselor'],
  ['adminPolicy.isDormRole 转发', adminPolicy.isDormRole('dorm_manager'), true],
  ['adminPolicy.isGuideRole 转发', adminPolicy.isGuideRole('counselor'), true]
];

let failed = 0;
cases.forEach(([name, actual, expected]) => {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  =>  ${JSON.stringify(actual)}${ok ? '' : ` (期望 ${JSON.stringify(expected)})`}`);
});

// dorm_manager 能力表必须逐项保持原样
const expectedDorm = JSON.stringify(['scanCheckin']);
const actualDorm = JSON.stringify(adminPolicy.ROLE_CAPABILITIES.dorm_manager);
const dormOk = actualDorm === expectedDorm;
if (!dormOk) failed += 1;
console.log(`${dormOk ? 'PASS' : 'FAIL'}  dorm_manager 能力表未变  =>  ${actualDorm}`);

// super_admin 与 counselor 能力逐项相同（小程序无 super 专属入口，刻意对齐）
const sameOk = JSON.stringify(adminPolicy.ROLE_CAPABILITIES.super_admin) === JSON.stringify(adminPolicy.ROLE_CAPABILITIES.counselor);
if (!sameOk) failed += 1;
console.log(`${sameOk ? 'PASS' : 'FAIL'}  super_admin 与 counselor 能力一致  =>  ${actualDorm}`);

// role-model 不得反向依赖 auth，避免循环依赖
const fs = require('fs');
const src = fs.readFileSync(path.join(miniapp, 'role-model.js'), 'utf8');
const depOk = src.indexOf("require('./auth')") === -1 && src.indexOf('require("./auth")') === -1;
if (!depOk) failed += 1;
console.log(`${depOk ? 'PASS' : 'FAIL'}  role-model.js 不依赖 auth.js（无循环依赖）`);

console.log(`\n${failed === 0 ? '全部通过' : failed + ' 项失败'}（共 ${cases.length + 3} 项）`);
process.exit(failed === 0 ? 0 : 1);
