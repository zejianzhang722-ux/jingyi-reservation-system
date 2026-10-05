/* 图标生成脚本：将矢量 SVG 以 data-URI 形式写入 styles/icons.wxss
 * 运行：node styles/generate-icons.js  （生成后可删除本文件）
 */
const fs = require('fs');
const path = require('path');

const SLATE = '#5b6b85';   // 中性功能色
const PRIMARY = '#0066CC'; // 品牌主色（激活态）
const GRAY = '#9aa3b2';    // 导航未激活
const WHITE = '#ffffff';   // 分类图标（置于彩色玻璃片上）

function wrap(inner, color, mode) {
  const stroke = mode === 'fill' ? 'none' : color;
  const fill = mode === 'fill' ? color : 'none';
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${fill}' stroke='${stroke}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;
}
function enc(svg) {
  return 'data:image/svg+xml,' + svg
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/"/g, "'");
}
function uri(inner, color, mode) { return `url("${enc(wrap(inner, color, mode))}")`; }

// 功能/导航/占位 图标（inner SVG）
const ICONS = {
  home:        { mode: 'stroke', d: "<path d='M3 10.5 12 3l9 7.5'/><path d='M5 9.5V20h14V9.5'/><path d='M9.5 20v-6h5v6'/>" },
  calendar:    { mode: 'stroke', d: "<rect x='3' y='4.5' width='18' height='16' rx='2'/><path d='M3 9h18'/><path d='M8 2.5v4M16 2.5v4'/><path d='M8 13h2M14 13h2M8 16.5h2M14 16.5h2'/>" },
  bell:        { mode: 'stroke', d: "<path d='M6 9a6 6 0 0 1 12 0c0 5 1.5 6 2 6H4c.5 0 2-1 2-6Z'/><path d='M10 20a2 2 0 0 0 4 0'/>" },
  user:        { mode: 'stroke', d: "<circle cx='12' cy='8' r='3.5'/><path d='M5.5 20a6.5 6.5 0 0 1 13 0'/>" },
  search:      { mode: 'stroke', d: "<circle cx='11' cy='11' r='6.5'/><path d='M20 20l-4.5-4.5'/>" },
  arrow:       { mode: 'stroke', d: "<path d='M5 12h13'/><path d='M13 6l6 6-6 6'/>" },
  chevron:     { mode: 'stroke', d: "<path d='M9 6l6 6-6 6'/>" },
  check:       { mode: 'stroke', d: "<path d='M4 12.5l5 5L20 6.5'/>" },
  star:        { mode: 'fill',   d: "<path d='M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 17l-5.3 2.6 1.1-6L3.4 9.4l6-.8z'/>" },
  location:    { mode: 'stroke', d: "<path d='M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z'/><circle cx='12' cy='9' r='2.5'/>" },
  clock:       { mode: 'stroke', d: "<circle cx='12' cy='12' r='8.5'/><path d='M12 7.5V12l3 2'/>" },
  users:       { mode: 'stroke', d: "<circle cx='9' cy='8' r='3'/><path d='M3.5 19a5.5 5.5 0 0 1 11 0'/><path d='M16 6.2a3 3 0 0 1 0 5.6'/><path d='M16.5 19a5.5 5.5 0 0 0-2.2-4.4'/>" },
  settings:    { mode: 'stroke', d: "<circle cx='12' cy='12' r='3'/><path d='M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9 19 19M19 5l-2.1 2.1M7.1 16.9 5 19'/>" },
  edit:        { mode: 'stroke', d: "<path d='M4 20h4L19 9l-4-4L4 16z'/><path d='M14 5l4 4'/>" },
  qrcode:      { mode: 'stroke', d: "<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><path d='M14 14h3v3h-3zM19 14v7M14 19h7'/>" },
  refresh:     { mode: 'stroke', d: "<path d='M20 11a8 8 0 0 0-14-4.5L4 8'/><path d='M4 4v4h4'/><path d='M4 13a8 8 0 0 0 14 4.5L20 16'/><path d='M20 20v-4h-4'/>" },
  plus:        { mode: 'stroke', d: "<path d='M12 5v14M5 12h14'/>" },
  close:       { mode: 'stroke', d: "<path d='M6 6l12 12M18 6 6 18'/>" },
  filter:      { mode: 'stroke', d: "<path d='M4 5h16l-6 7v6l-4 2v-8z'/>" },
  building:    { mode: 'stroke', d: "<path d='M5 21V4h9v17'/><path d='M14 9h5v12'/><path d='M8 8h2M8 12h2M8 16h2'/>" },
  book:        { mode: 'stroke', d: "<path d='M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z'/><path d='M5 4v16'/>" },
  megaphone:   { mode: 'stroke', d: "<path d='M4 10v4l9 4V6z'/><path d='M13 8a4 4 0 0 1 0 8'/><path d='M6 14v4a2 2 0 0 0 4 0'/>" },
  chart:       { mode: 'stroke', d: "<path d='M4 20V4'/><path d='M4 20h16'/><path d='M8 16v-4M12 16V8M16 16v-7'/>" },
  shield:      { mode: 'stroke', d: "<path d='M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z'/><path d='M9 12l2 2 4-4'/>" },
  swap:        { mode: 'stroke', d: "<path d='M7 7h11l-3-3M17 17H6l3 3'/>" },
  scan:        { mode: 'stroke', d: "<path d='M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3'/><path d='M4 12h16'/>" },
  // 占位 / 状态
  emptybox:    { mode: 'stroke', d: "<path d='M3 8l9-5 9 5v8l-9 5-9-5z'/><path d='M3 8l9 5 9-5'/><path d='M12 13v8'/>" },
  emptydoc:    { mode: 'stroke', d: "<path d='M7 3h7l4 4v14H7z'/><path d='M14 3v4h4'/><path d='M10 12h5M10 16h5'/>" },
  nowifi:      { mode: 'stroke', d: "<path d='M2 8.5a16 16 0 0 1 20 0'/><path d='M5 12a11 11 0 0 1 14 0'/><path d='M8.5 15.5a6 6 0 0 1 7 0'/><circle cx='12' cy='19' r='1.3'/>" },
  error:       { mode: 'stroke', d: "<circle cx='12' cy='12' r='9'/><path d='M12 7v6M12 16.5v.5'/>" },
  info:        { mode: 'stroke', d: "<circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8v.5'/>" },
  success:     { mode: 'stroke', d: "<circle cx='12' cy='12' r='9'/><path d='M8 12.5l2.5 2.5L16 9'/>" },
  warning:     { mode: 'stroke', d: "<path d='M12 3 2.5 20h19z'/><path d='M12 9v5M12 16.5v.5'/>" },
  document:    { mode: 'stroke', d: "<path d='M7 3h7l4 4v14H7z'/><path d='M14 3v4h4'/><path d='M10 12h5M10 16h5'/>" },
  chat:        { mode: 'stroke', d: "<path d='M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z'/>" },
  network:     { mode: 'stroke', d: "<path d='M2 8.5a16 16 0 0 1 20 0'/><path d='M5 12a11 11 0 0 1 14 0'/><path d='M8.5 15.5a6 6 0 0 1 7 0'/><circle cx='12' cy='19' r='1.3'/>" },
  logout:      { mode: 'stroke', d: "<path d='M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3'/><path d='M10 12H3M6 8l-4 4 4 4'/>" },
  profile:     { mode: 'stroke', d: "<circle cx='9' cy='8' r='3.5'/><path d='M3.5 19a5.5 5.5 0 0 1 11 0'/><rect x='14.5' y='3.5' width='7' height='16' rx='2'/><path d='M16.5 8.5h3M16.5 11.5h3M16.5 14.5h3'/>" },
};

// 分类图标（白色矢量，置于彩色玻璃片）
const CATEGORIES = {
  study:       { mode: 'stroke', d: "<path d='M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3 3z'/><path d='M5 4v16'/>", grad: 'linear-gradient(145deg,#3D8BFF,#0066CC)' },
  shared:      { mode: 'stroke', d: "<circle cx='9' cy='8' r='3'/><path d='M3.5 19a5.5 5.5 0 0 1 11 0'/><path d='M16 6.2a3 3 0 0 1 0 5.6'/><path d='M16.5 19a5.5 5.5 0 0 0-2.2-4.4'/>", grad: 'linear-gradient(145deg,#8B5CF6,#6f4fd4)' },
  media:       { mode: 'fill',   d: "<path d='M8 5v14l11-7z'/>", grad: 'linear-gradient(145deg,#F0448A,#d63384)' },
  competition: { mode: 'stroke', d: "<path d='M7 4h10v4a5 5 0 0 1-10 0z'/><path d='M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3'/><path d='M12 13v4M9 20h6'/>", grad: 'linear-gradient(145deg,#F0A020,#c77a00)' },
  roadshow:    { mode: 'stroke', d: "<rect x='9' y='3' width='6' height='11' rx='3'/><path d='M6 11a6 6 0 0 0 12 0'/><path d='M12 17v4M9 21h6'/>", grad: 'linear-gradient(145deg,#2DD4D4,#0fb5b5)' },
  dance:       { mode: 'stroke', d: "<path d='M9 17V6l10-2v11'/><circle cx='7' cy='17' r='2.5'/><circle cx='17' cy='15' r='2.5'/>", grad: 'linear-gradient(145deg,#F2556D,#c33d5b)' },
  reading:     { mode: 'stroke', d: "<path d='M12 6c-2-1.5-5-1.5-7 0v12c2-1.5 5-1.5 7 0 2-1.5 5-1.5 7 0V6c-2-1.5-5-1.5-7 0z'/><path d='M12 6v12'/>", grad: 'linear-gradient(145deg,#4FB36B,#2f8a3b)' },
  multi:       { mode: 'stroke', d: "<rect x='4' y='4' width='7' height='7' rx='1.5'/><rect x='13' y='4' width='7' height='7' rx='1.5'/><rect x='4' y='13' width='7' height='7' rx='1.5'/><rect x='13' y='13' width='7' height='7' rx='1.5'/>", grad: 'linear-gradient(145deg,#5B7CFF,#2f54eb)' },
  academic:    { mode: 'stroke', d: "<path d='M12 4 2 9l10 5 10-5z'/><path d='M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5'/><path d='M22 9v5'/>", grad: 'linear-gradient(145deg,#F2B533,#d99a00)' },
  career:      { mode: 'stroke', d: "<rect x='3' y='8' width='18' height='11' rx='2'/><path d='M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/><path d='M3 13h18'/>", grad: 'linear-gradient(145deg,#A3D633,#6f9d00)' },
  party:       { mode: 'stroke', d: "<rect x='4' y='9' width='16' height='11' rx='1.5'/><path d='M4 13h16M12 9v11'/><path d='M12 9C10.5 9 9 7.5 10 6s2 3 2 3zM12 9c1.5 0 3-1.5 2-3s-2 3-2 3z'/>", grad: 'linear-gradient(145deg,#F46464,#d64545)' },
  psychology:  { mode: 'stroke', d: "<path d='M12 20S4 14.5 4 9a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 5.5-8 11-8 11z'/>", grad: 'linear-gradient(145deg,#F2558F,#d63384)' },
  room:        { mode: 'stroke', d: "<path d='M5 21V4h9v17'/><path d='M14 9h5v12'/><path d='M8 8h2M8 12h2M8 16h2'/>", grad: 'linear-gradient(145deg,#7C8AA5,#56627A)' },
  discussion:  { mode: 'stroke', d: "<circle cx='9' cy='8' r='3'/><path d='M3.5 19a5.5 5.5 0 0 1 11 0'/><path d='M16 6.2a3 3 0 0 1 0 5.6'/><path d='M16.5 19a5.5 5.5 0 0 0-2.2-4.4'/>", grad: 'linear-gradient(145deg,#2DD4D4,#0fb5b5)' },
};

const lines = [];
lines.push('/* 自动生成：SVG 矢量图标库（请勿手改，改 styles/generate-icons.js 后重新生成） */');
lines.push('.icon {');
lines.push('  display: inline-block;');
lines.push('  width: 40rpx;');
lines.push('  height: 40rpx;');
lines.push('  background-repeat: no-repeat;');
lines.push('  background-position: center;');
lines.push('  background-size: contain;');
lines.push('  flex-shrink: 0;');
lines.push('}');
lines.push('');

// 功能图标：中性 + 主色变体
const primaryWanted = ['search', 'arrow', 'check', 'star', 'info', 'warning', 'location', 'clock', 'users', 'settings', 'edit', 'qrcode', 'refresh', 'plus', 'close', 'filter', 'building', 'book', 'megaphone', 'chart', 'shield', 'swap', 'scan', 'chevron', 'document', 'chat', 'network', 'logout', 'profile'];
Object.keys(ICONS).forEach(function (name) {
  const it = ICONS[name];
  lines.push('.icon-' + name + ' { background-image: ' + uri(it.d, SLATE, it.mode) + '; }');
  if (primaryWanted.indexOf(name) !== -1) {
    lines.push('.icon-' + name + '.primary { background-image: ' + uri(it.d, PRIMARY, it.mode) + '; }');
  }
});
lines.push('');

// 导航图标（TabBar）：未激活 + 激活
const navMap = { home: 'home', calendar: 'calendar', bell: 'bell', user: 'user' };
['home', 'calendar', 'bell', 'user'].forEach(function (n) {
  const it = ICONS[navMap[n]];
  lines.push('.tab-icon-' + n + ' { width: 44rpx; height: 44rpx; background-image: ' + uri(it.d, GRAY, it.mode) + '; }');
  lines.push('.tab-icon-' + n + '.on { background-image: ' + uri(it.d, PRIMARY, it.mode) + '; }');
});
lines.push('');

// 分类图标（彩色玻璃片 + 白色矢量）
Object.keys(CATEGORIES).forEach(function (key) {
  const c = CATEGORIES[key];
  const u = uri(c.d, WHITE, c.mode);
  lines.push('.cat-icon-' + key + ' {');
  lines.push('  background-image: ' + u + ', ' + c.grad + ';');
  lines.push('  background-repeat: no-repeat;');
  lines.push('  background-position: center;');
  lines.push('  background-size: 40rpx 40rpx, 100% 100%;');
  lines.push('}');
});
lines.push('');

const out = path.join(__dirname, 'icons.wxss');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log('written', out, lines.length, 'lines');
