const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let route = '';
const auth = { isLoggedIn: () => true, isAdmin: () => true, getUserRole: () => 'super_admin', getUserInfo: () => ({ role: 'super_admin' }) };
// Resolve page-relative imports exactly as the mini program does.
function loadPage(name) {
  let definition;
  const dir = path.join(root, 'miniapp/pages', name);
  vm.runInNewContext(fs.readFileSync(path.join(dir, name + '.js'), 'utf8'), {
    Page: value => { definition = value; }, require: value => value.endsWith('/auth') ? auth : value.endsWith('/request') ? { get: async () => [] } : require(path.resolve(dir, value)),
    wx: { navigateTo: value => { route = value.url; }, showToast() {}, reLaunch() {} }, console, Promise, Object, Number, String, Date
  });
  definition.data = JSON.parse(JSON.stringify(definition.data)); definition.setData = values => Object.assign(definition.data, values); return definition;
}
const rooms = loadPage('admin-rooms'); rooms.onViewDetail({ currentTarget: { dataset: { id: 12 } } });
assert.match(route, /admin-room-detail/, '房间卡片必须进入管理员管理详情');
rooms.applyStatusPreset('counselor_only'); assert.equal(rooms.data.filterStatusLabel, '联系辅导员预约');
assert(rooms.data.typeOptions.length >= 19, '分类需要覆盖实际房间类型');
const users = loadPage('admin-users').enhanceUsers([{ id: 1, status: 'restricted', credit_score: 0, name: '测试' }]);
assert.equal(users[0].statusText, '预约受限'); assert.equal(users[0].creditDisplay, 0);
let component;
vm.runInNewContext(fs.readFileSync(path.join(root, 'miniapp/components/app-dialog/app-dialog.js'), 'utf8'), { Component: value => { component = value; }, Number, String, Object, Array, Promise });
const dialog = { ...component.methods, data: JSON.parse(JSON.stringify(component.data)), setData(values) { Object.assign(this.data, values); } };
let result;
dialog.open({ title: '拒绝预约', content: '请输入拒绝理由', editable: true, success: value => { result = value; } });
assert.equal(dialog.data.draft, '', '提示不能预填成待删除的实体文字');
dialog.onInput({ detail: { value: '  材料不完整  ' } }); dialog.onConfirm();
assert.equal(result.content, '材料不完整');
dialog.open({ title: '信用分规则', sections: [{ title: '预约权限', items: ['仅当天', '每天一次'] }] });
assert.equal(dialog.data.sections.length, 1);
dialog.open({ title:'开放时段', fields:[{key:'openStartTime',label:'开放时间',type:'time',value:'08:00',required:true}] });
dialog.onFieldInput({currentTarget:{dataset:{index:0}},detail:{value:'09:30'}});assert.equal(dialog.data.fields[0].value,'09:30');
const timeMarkup=fs.readFileSync(path.join(root,'miniapp/components/app-dialog/app-dialog.wxml'),'utf8');assert.match(timeMarkup,/mode="time"/);
const rulesPresenter=require('../miniapp/utils/rules-presenter');const original=require('../miniapp/utils/reservation-rules')();const points=rulesPresenter.sections(original).flatMap(section=>[section.title,...section.items]).join('').replace(/\s/g,'');assert.equal(points,original.replace(/\s/g,''),'排版必须保留原规则全部内容');
console.log('PASS: admin room destination, Chinese resident state, zero score, empty reason input and structured dialog sections');
