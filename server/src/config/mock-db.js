const bcrypt = require('bcryptjs');

const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');

const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
const today = dayjs().format('YYYY-MM-DD');
const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
const dayAfter = dayjs().add(2, 'day').format('YYYY-MM-DD');
const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
const oneMinuteAgo = dayjs().subtract(1, 'minute').format('YYYY-MM-DD HH:mm:ss');

let nextId = 1000;
function genId() { return ++nextId; }

const tables = {};
const persistedDir = path.join(__dirname, '..', '..', 'data');
const feedbackFile = path.join(persistedDir, 'mock-feedbacks.json');

function loadFeedbacks() {
  try {
    if (!fs.existsSync(feedbackFile)) return [];
    const rows = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
    rows.forEach(function(row) {
      if (row.id && row.id > nextId) nextId = row.id;
    });
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    return [];
  }
}

function persistTable(tableName) {
  if (tableName !== 'feedbacks') return;
  try {
    if (!fs.existsSync(persistedDir)) fs.mkdirSync(persistedDir, { recursive: true });
    fs.writeFileSync(feedbackFile, JSON.stringify(tables.feedbacks || [], null, 2), 'utf8');
  } catch (err) {}
}

tables.buildings = [
  { id: 1, name: 'B座', code: 'B', address: '敬一书院B座', floors: 6, description: '书院主楼B座', status: 'active', created_at: now, updated_at: now },
  { id: 2, name: 'C座', code: 'C', address: '敬一书院C座', floors: 6, description: '书院主楼C座', status: 'active', created_at: now, updated_at: now },
  { id: 3, name: 'D座', code: 'D', address: '敬一书院D座', floors: 6, description: '书院主楼D座', status: 'active', created_at: now, updated_at: now }
];

tables.rooms = [
  { id: 1, name: 'B228自习室', type: 'study_room', building_id: 1, floor: 2, location: 'B座2楼228', area: null, capacity: 50, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座2楼自习室，50个座位，24小时开放', facilities: 'WiFi,电源,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 2, name: 'B520自习室', type: 'study_room', building_id: 1, floor: 5, location: 'B座5楼520', area: null, capacity: 36, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座5楼自习室，36个座位，24小时开放', facilities: 'WiFi,电源,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 3, name: 'C110自习室', type: 'study_room', building_id: 2, floor: 1, location: 'C座1楼110', area: null, capacity: 42, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼自习室，42个座位，24小时开放', facilities: 'WiFi,电源,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 4, name: 'D418自习室', type: 'study_room', building_id: 3, floor: 4, location: 'D座4楼418', area: null, capacity: 15, open_start_time: '08:00', open_end_time: '21:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'D座4楼自习室，15个座位，8:00-21:00开放', facilities: 'WiFi,电源,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 5, name: 'D510自习室', type: 'study_room', building_id: 3, floor: 5, location: 'D座5楼510', area: null, capacity: 26, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'D座5楼自习室，26个座位，24小时开放', facilities: 'WiFi,电源,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 6, name: 'B102共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼102', area: null, capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人，8:00-22:00', facilities: 'WiFi,投影,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 7, name: 'B132共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼132', area: null, capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人，8:00-22:00', facilities: 'WiFi,投影,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 8, name: 'B134共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼134', area: null, capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人，8:00-22:00', facilities: 'WiFi,投影,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 9, name: 'C132共享空间', type: 'seminar_room', building_id: 2, floor: 1, location: 'C座1楼132', area: null, capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼共享空间，12人，8:00-22:00', facilities: 'WiFi,投影,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 10, name: 'D519共享空间', type: 'seminar_room', building_id: 3, floor: 5, location: 'D座5楼519', area: null, capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座5楼共享空间，12人，8:00-22:00', facilities: 'WiFi,投影,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 11, name: 'C128影音室', type: 'media_room', building_id: 2, floor: 1, location: 'C座1楼128', area: null, capacity: 30, open_start_time: '08:00', open_end_time: '23:00', max_duration: 180, need_audit: 0, need_counselor_audit: 1, description: 'C座1楼影音室，30人，需辅导员审批', facilities: 'WiFi,投影,音响,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 12, name: 'C310备赛间', type: 'competition_room', building_id: 2, floor: 3, location: 'C座3楼310', area: 93, capacity: 30, open_start_time: '00:00', open_end_time: '23:59', max_duration: 360, need_audit: 0, need_counselor_audit: 0, description: 'C座3楼备赛间，93㎡，30人，24小时开放', facilities: 'WiFi,电源,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 13, name: 'B128路演空间', type: 'roadshow_space', building_id: 1, floor: 1, location: 'B座1楼128', area: null, capacity: 50, open_start_time: '08:00', open_end_time: '23:00', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼路演空间，50人，8:00-23:00', facilities: 'WiFi,投影,音响,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 14, name: 'D110舞蹈室', type: 'dance_room', building_id: 3, floor: 1, location: 'D座1楼110', area: 93, capacity: 20, open_start_time: '17:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼舞蹈室，93㎡，20人，17:00-22:00', facilities: 'WiFi,音响,镜子,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 15, name: 'D127阅览室', type: 'reading_room', building_id: 3, floor: 1, location: 'D座1楼127', area: null, capacity: 40, open_start_time: '09:00', open_end_time: '22:00', max_duration: 0, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼阅览室，9:00-22:00，无需预约', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 16, name: 'D218多功能厅', type: 'multi_purpose_hall', building_id: 3, floor: 2, location: 'D座2楼218', area: null, capacity: 20, open_start_time: '08:00', open_end_time: '23:00', max_duration: 180, need_audit: 0, need_counselor_audit: 1, description: 'D座2楼多功能厅，20人，需辅导员审批', facilities: 'WiFi,投影,音响,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 17, name: 'C133学业辅导中心', type: 'study_center', building_id: 2, floor: 1, location: 'C座1楼133', area: null, capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼学业辅导中心', facilities: 'WiFi,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 18, name: 'D132团员模范岗', type: 'tutor', building_id: 3, floor: 1, location: 'D座1楼132', area: null, capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼团员模范岗', facilities: 'WiFi,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 19, name: 'C210生涯发展咨询室', type: 'career_center', building_id: 2, floor: 2, location: 'C座2楼210', area: null, capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座2楼生涯发展咨询室', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 20, name: 'D134求职就业工作室', type: 'job_studio', building_id: 3, floor: 1, location: 'D座1楼134', area: null, capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼求职就业工作室', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 21, name: 'C228创新工作坊', type: 'innovation_workshop', building_id: 2, floor: 2, location: 'C座2楼228', area: null, capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座2楼创新工作坊', facilities: 'WiFi,3D打印机,工具,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 22, name: 'D128党团活动室', type: 'party_room', building_id: 3, floor: 1, location: 'D座1楼128', area: null, capacity: 20, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼党团活动室', facilities: 'WiFi,投影,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 23, name: 'C102国防教育工作室', type: 'national_defense_studio', building_id: 2, floor: 1, location: 'C座1楼102', area: null, capacity: 10, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼国防教育工作室', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 24, name: 'C129导师交流室', type: 'mentor_room', building_id: 2, floor: 1, location: 'C座1楼129', area: null, capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼导师交流室', facilities: 'WiFi,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 25, name: 'C127心理咨询室', type: 'psychology_room', building_id: 2, floor: 1, location: 'C座1楼127', area: null, capacity: 4, open_start_time: '09:00', open_end_time: '21:00', max_duration: 60, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼心理咨询室', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 26, name: 'D133资料室', type: 'data_room', building_id: 3, floor: 1, location: 'D座1楼133', area: null, capacity: 20, open_start_time: '08:00', open_end_time: '23:00', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼资料室', facilities: 'WiFi,电源,空调', image_url: '', status: 'closed', created_at: now, updated_at: now },
  { id: 27, name: 'B133心灵驿站', type: 'psychology_room', building_id: 1, floor: 1, location: 'B座1楼133', area: null, capacity: 8, open_start_time: '09:00', open_end_time: '21:00', max_duration: 60, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼心灵驿站', facilities: 'WiFi,空调', image_url: '', status: 'open', created_at: now, updated_at: now },
  { id: 28, name: 'B129导师交流室', type: 'mentor_room', building_id: 1, floor: 1, location: 'B座1楼129', area: null, capacity: 10, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼导师交流室', facilities: 'WiFi,白板,空调', image_url: '', status: 'open', created_at: now, updated_at: now }
];

tables.seats = [];
let seatId = 0;
const seatConfigs = [
  { roomId: 1, count: 50, rowSize: 10 },
  { roomId: 2, count: 36, rowSize: 10 },
  { roomId: 3, count: 42, rowSize: 14 },
  { roomId: 4, count: 15, rowSize: 5 },
  { roomId: 5, count: 26, rowSize: 10 },
  { roomId: 6, count: 12, rowSize: 6 },
  { roomId: 7, count: 12, rowSize: 6 },
  { roomId: 8, count: 12, rowSize: 6 },
  { roomId: 9, count: 12, rowSize: 6 },
  { roomId: 10, count: 12, rowSize: 6 },
  { roomId: 11, count: 30, rowSize: 10 },
  { roomId: 12, count: 30, rowSize: 10 },
  { roomId: 13, count: 50, rowSize: 10 },
  { roomId: 14, count: 20, rowSize: 10 },
  { roomId: 15, count: 40, rowSize: 10 },
  { roomId: 16, count: 20, rowSize: 10 },
  { roomId: 17, count: 15, rowSize: 5 },
  { roomId: 18, count: 15, rowSize: 5 },
  { roomId: 19, count: 8, rowSize: 4 },
  { roomId: 20, count: 8, rowSize: 4 },
  { roomId: 21, count: 15, rowSize: 5 },
  { roomId: 22, count: 20, rowSize: 10 },
  { roomId: 23, count: 10, rowSize: 5 },
  { roomId: 24, count: 8, rowSize: 4 },
  { roomId: 25, count: 4, rowSize: 4 },
  { roomId: 26, count: 20, rowSize: 10 },
  { roomId: 27, count: 8, rowSize: 4 },
  { roomId: 28, count: 10, rowSize: 5 }
];
seatConfigs.forEach(function(cfg) {
  var room = tables.rooms.find(function(r) { return r.id === cfg.roomId });
  var roomCodeMatch = room ? room.name.match(/[A-Z]\d{3}/) : null;
  var roomCode = roomCodeMatch ? roomCodeMatch[0] : (room ? room.name.replace(/[^A-Z0-9]/g, '') : String(cfg.roomId));
  for (let i = 0; i < cfg.count; i++) {
    seatId++;
    tables.seats.push({
      id: seatId,
      room_id: cfg.roomId,
      seat_number: roomCode + '-' + String(i + 1).padStart(2, '0'),
      row_num: Math.floor(i / cfg.rowSize) + 1,
      col_num: (i % cfg.rowSize) + 1,
      status: 'available',
      has_power: 1,
      created_at: now,
      updated_at: now
    });
  }
});

tables.users = [
  { id: 1, openid: 'test_openid_001', session_key: 'sk001', nickname: '张三', avatar: '', phone: '13900000001', student_id: '2024001001', student_no: '2024001001', real_name: '张三', name: '张三', gender: '男', college: '敬一书院', major: '软件工程', class_name: '2024级1班', grade: '2024', building_id: 1, room_number: 'B301', card_no: '200001', role: 'student', credit_score: 80, status: 'active', restricted_until: null, noshow_count: 1, wechat_openid: null, created_at: now, updated_at: now },
  { id: 2, openid: 'test_openid_002', session_key: 'sk002', nickname: '李四', avatar: '', phone: '13900000002', student_id: '2024001002', student_no: '2024001002', real_name: '李四', name: '李四', gender: '女', college: '敬一书院', major: '计算机科学', class_name: '2024级2班', grade: '2024', building_id: 2, room_number: 'C205', card_no: '200002', role: 'student', credit_score: 95, status: 'active', restricted_until: null, noshow_count: 0, wechat_openid: null, created_at: now, updated_at: now }
];

tables.admins = [
  { id: 1, username: 'admin', password: bcrypt.hashSync('admin123', 10), real_name: '系统管理员', role: 'admin', building_id: null, phone: '13800000001', status: 'active', last_login_at: null, created_at: now, updated_at: now },
  { id: 2, username: 'superadmin', password: bcrypt.hashSync('super123', 10), real_name: '超级管理员', role: 'super_admin', building_id: null, phone: '13800000002', status: 'active', last_login_at: null, created_at: now, updated_at: now },
  { id: 3, username: 'counselor', password: bcrypt.hashSync('counselor123', 10), real_name: '辅导员', role: 'counselor', building_id: null, phone: '13800000003', status: 'active', last_login_at: null, created_at: now, updated_at: now }
];

tables.reservations = [
  { id: 1, user_id: 1, room_id: 1, seat_id: 1, date: today, start_time: '09:00', end_time: '12:00', purpose: '自习备考', participants: 1, status: 'approved', reservation_code: 'JYTEST001', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 2, user_id: 2, room_id: 1, seat_id: 2, date: today, start_time: '14:00', end_time: '17:00', purpose: '课程复习', participants: 1, status: 'approved', reservation_code: 'JYTEST002', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 3, user_id: 2, room_id: 6, seat_id: null, date: today, start_time: '10:00', end_time: '12:00', purpose: '小组讨论', participants: 8, status: 'approved', reservation_code: 'JYTEST003', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 4, user_id: 1, room_id: 2, seat_id: 11, date: tomorrow, start_time: '09:00', end_time: '11:00', purpose: '自习', participants: 1, status: 'approved', reservation_code: 'JYTEST004', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 5, user_id: 2, room_id: 11, seat_id: null, date: tomorrow, start_time: '14:00', end_time: '17:00', purpose: '观影活动', participants: 20, status: 'counselor_pending', reservation_code: 'JYTEST005', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 6, user_id: 2, room_id: 12, seat_id: null, date: dayAfter, start_time: '08:00', end_time: '14:00', purpose: '数学建模备赛', participants: 5, status: 'approved', reservation_code: 'JYTEST006', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 7, user_id: 2, room_id: 9, seat_id: null, date: tomorrow, start_time: '15:00', end_time: '18:00', purpose: '项目研讨', participants: 6, status: 'pending', reservation_code: 'JYTEST007', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 8, user_id: 2, room_id: 5, seat_id: 21, date: today, start_time: '19:00', end_time: '22:00', purpose: '自习', participants: 1, status: 'checked_in', reservation_code: 'JYTEST008', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 9, user_id: 1, room_id: 1, seat_id: 1, date: yesterday, start_time: '08:00', end_time: '10:00', purpose: '自习', participants: 1, status: 'noshow', reservation_code: 'JYTEST009', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: yesterday + ' 10:20:00', updated_at: yesterday + ' 10:20:00' },
  { id: 10, user_id: 1, room_id: 6, seat_id: null, date: tomorrow, start_time: '14:00', end_time: '16:00', purpose: '小组讨论', participants: 6, status: 'pending', reservation_code: 'JYTEST010', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 11, user_id: 1, room_id: 11, seat_id: null, date: today, start_time: '19:00', end_time: '21:00', purpose: '观影活动', participants: 15, status: 'completed', reservation_code: 'JYTEST011', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 12, user_id: 1, room_id: 3, seat_id: 5, date: tomorrow, start_time: '09:00', end_time: '12:00', purpose: '自习', participants: 1, status: 'approved', reservation_code: 'JYTEST012', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now },
  { id: 13, user_id: 1, room_id: 17, seat_id: null, date: dayAfter, start_time: '10:00', end_time: '11:00', purpose: '学业辅导', participants: 3, status: 'approved', reservation_code: 'JYTEST013', reject_reason: '', audited_by: null, audited_at: null, cancelled_at: null, created_at: now, updated_at: now }
];

tables.checkins = [];
tables.credits_log = [
  { id: 1, user_id: 1, score_change: -20, score_after: 80, type: 'noshow', description: '爽约 - B228自习室，预约开始后15分钟内未签到', related_id: 9, created_at: yesterday },
  { id: 2, user_id: 1, score_change: -5, score_after: 75, type: 'warning', description: '临近开始时间取消预约', related_id: 9, created_at: oneMinuteAgo },
  { id: 3, user_id: 1, score_change: 5, score_after: 80, type: 'good_behavior', description: '正常使用功能房 - B228自习室，按时签到并签退', related_id: 1, created_at: now },
  { id: 4, user_id: 2, score_change: 5, score_after: 95, type: 'good_behavior', description: '正常使用功能房 - B228自习室', related_id: 2, created_at: now },
  { id: 5, user_id: 2, score_change: 5, score_after: 95, type: 'good_behavior', description: '正常使用功能房 - B102共享空间', related_id: 3, created_at: now }
];
tables.violations = [];
tables.posters = [];
tables.feedbacks = loadFeedbacks();
tables.reading_room_logs = [];
tables.notifications = [
  { id: 1, user_id: 1, type: 'reservation', title: '预约确认', content: '您预约的B228自习室（今天 08:00-10:00）已确认', is_read: 0, created_at: now },
  { id: 2, user_id: 1, type: 'reservation', title: '预约待审核', content: '您预约的B102共享空间（明天 14:00-16:00）正在审核中', is_read: 0, created_at: now },
  { id: 3, user_id: 1, type: 'system', title: '系统通知', content: '敬一书院功能房预约系统已升级，请查看新的管理制度', is_read: 1, created_at: now },
  { id: 4, user_id: 1, type: 'credit', title: '信用分变动', content: '您因爽约被扣除20信用分，当前信用分：80', is_read: 1, created_at: now },
  { id: 5, user_id: 1, type: 'reminder', title: '预约提醒', content: '您预约的C133学业辅导中心即将开始，请准时到达', is_read: 0, created_at: now }
];
tables.reservation_waitlist = [];
tables.reservation_groups = [];
tables.reservation_group_members = [];
tables.operation_logs = [];
tables.announcements = [
  { id: 1, title: '欢迎使用敬一书院功能房预约系统', content: '欢迎使用敬一书院功能房预约系统，请遵守使用规则，文明预约。', type: 'notice', is_top: 1, status: 'published', created_by: 1, created_at: now, updated_at: now },
  { id: 2, title: '自习室使用须知', content: '1. 请按时签到签退\n2. 请勿占座\n3. 保持安静\n4. 爱护公共设施', type: 'notice', is_top: 0, status: 'published', created_by: 1, created_at: now, updated_at: now }
];
tables.system_config = [
  { id: 1, config_key: 'reservation.advance_days', config_value: '3', description: '可提前预约天数', created_at: now, updated_at: now },
  { id: 2, config_key: 'reservation.cancel_before_hours', config_value: '3', description: '取消预约提前小时数', created_at: now, updated_at: now },
  { id: 3, config_key: 'reservation.late_minutes', config_value: '15', description: '迟到签到允许分钟数', created_at: now, updated_at: now },
  { id: 4, config_key: 'reservation.noshow_count_limit', config_value: '3', description: '爽约次数限制', created_at: now, updated_at: now },
  { id: 5, config_key: 'reservation.noshow_pause_days', config_value: '7', description: '爽约暂停预约天数', created_at: now, updated_at: now },
  { id: 6, config_key: 'reservation.daily_limit', config_value: '3', description: '每日预约次数限制', created_at: now, updated_at: now },
  { id: 7, config_key: 'credit.initial_score', config_value: '100', description: '初始信用分', created_at: now, updated_at: now },
  { id: 8, config_key: 'credit.max_score', config_value: '120', description: '信用分上限', created_at: now, updated_at: now },
  { id: 9, config_key: 'credit.noshow_penalty', config_value: '-20', description: '爽约扣分', created_at: now, updated_at: now },
  { id: 10, config_key: 'credit.violation_penalty', config_value: '-10', description: '违规扣分', created_at: now, updated_at: now },
  { id: 11, config_key: 'credit.good_reward', config_value: '5', description: '良好行为奖励', created_at: now, updated_at: now },
  { id: 12, config_key: 'credit.good_threshold', config_value: '10', description: '良好行为判定次数', created_at: now, updated_at: now },
  { id: 13, config_key: 'credit.feedback_reward', config_value: '3', description: '反馈奖励', created_at: now, updated_at: now },
  { id: 14, config_key: 'credit.warning_threshold', config_value: '80', description: '信用分警告阈值', created_at: now, updated_at: now },
  { id: 15, config_key: 'credit.restrict_threshold', config_value: '60', description: '信用分限制阈值', created_at: now, updated_at: now },
  { id: 16, config_key: 'credit.ban_threshold', config_value: '30', description: '信用分封禁阈值', created_at: now, updated_at: now },
  { id: 17, config_key: 'credit.restrict_days', config_value: '7', description: '限制天数', created_at: now, updated_at: now },
  { id: 18, config_key: 'credit.ban_days', config_value: '30', description: '封禁天数', created_at: now, updated_at: now }
];

function resolveAlias(alias, tableName) {
  const aliasMap = {
    r: 'reservations', rm: 'rooms', u: 'users', b: 'buildings',
    c: 'checkins', v: 'violations', p: 'posters', o: 'operation_logs',
    a: 'admins', s: 'seats'
  };
  return aliasMap[alias] || tableName;
}

function getTableData(tableName) {
  const name = resolveAlias(null, tableName);
  return tables[name] || [];
}

function getFieldValue(row, field) {
  if (row.hasOwnProperty(field)) return row[field];
  const parts = field.split('.');
  if (parts.length === 2) {
    if (row.hasOwnProperty(field)) return row[field];
    if (row.hasOwnProperty(parts[1])) return row[parts[1]];
  }
  return row[field];
}

function replaceParams(sql, params) {
  if (!params || params.length === 0) return sql;
  let idx = 0;
  return sql.replace(/\?/g, function() {
    if (idx < params.length) {
      const val = params[idx++];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return String(val);
      if (typeof val === 'boolean') return val ? '1' : '0';
      return "'" + String(val).replace(/'/g, "''") + "'";
    }
    return '?';
  });
}

function splitSqlList(input) {
  const result = [];
  let current = '';
  let quote = null;
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const prev = input[i - 1];

    if ((ch === "'" || ch === '"') && prev !== '\\') {
      if (quote === ch) {
        quote = null;
      } else if (!quote) {
        quote = ch;
      }
    }

    if (!quote) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        result.push(current.trim());
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function parseSqlValue(value) {
  const v = value.trim();
  if (/^NOW\(\)$/i.test(v)) return dayjs().format('YYYY-MM-DD HH:mm:ss');
  if (/^CURDATE\(\)$/i.test(v)) return dayjs().format('YYYY-MM-DD');
  if (/^NULL$/i.test(v)) return null;
  return v.replace(/^['"]|['"]$/g, '');
}

function evaluateCondition(row, left, operator, right) {
  let leftVal = getFieldValue(row, left.trim());
  let rightVal = right;

  if (leftVal === undefined || leftVal === null) {
    if (operator === 'IS') return rightVal === 'NULL';
    if (operator === 'IS NOT') return rightVal !== 'NULL';
    return false;
  }

  if (rightVal === 'NULL') {
    if (operator === 'IS') return leftVal === null;
    if (operator === 'IS NOT') return leftVal !== null;
    return false;
  }

  rightVal = rightVal.replace(/^['"]|['"]$/g, '');

  if (operator === '=') return String(leftVal) === String(rightVal);
  if (operator === '!=') return String(leftVal) !== String(rightVal);
  if (operator === '<>') return String(leftVal) !== String(rightVal);
  if (operator === '<') return Number(leftVal) < Number(rightVal);
  if (operator === '>') return Number(leftVal) > Number(rightVal);
  if (operator === '<=') return Number(leftVal) <= Number(rightVal);
  if (operator === '>=') return Number(leftVal) >= Number(rightVal);
  if (operator === 'LIKE') {
    const pattern = rightVal.replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp('^' + pattern + '$', 'i').test(String(leftVal));
  }
  if (operator === 'NOT LIKE') {
    const pattern = rightVal.replace(/%/g, '.*').replace(/_/g, '.');
    return !new RegExp('^' + pattern + '$', 'i').test(String(leftVal));
  }
  return false;
}

function evaluateInCondition(row, field, values, negated) {
  const val = String(getFieldValue(row, field.trim()));
  const match = values.some(function(v) { return String(v) === val; });
  return negated ? !match : match;
}

function parseWhereClause(whereStr, rows, aliasMap) {
  if (!whereStr || whereStr.trim() === '') return rows;

  let filtered = rows;

  const inMatch = whereStr.match(/([\w.]+)\s+(NOT\s+)?IN\s*\(([^)]+)\)/i);
  if (inMatch) {
    const field = inMatch[1];
    const negated = !!inMatch[2];
    const valuesStr = inMatch[3];
    const values = valuesStr.split(',').map(function(v) { return v.trim().replace(/^['"]|['"]$/g, ''); });
    filtered = filtered.filter(function(row) { return evaluateInCondition(row, field, values, negated); });
    whereStr = whereStr.replace(inMatch[0], ' 1=1 ');
  }

  const isNullMatch = whereStr.match(/([\w.]+)\s+IS\s+(NOT\s+)?NULL/i);
  if (isNullMatch) {
    const field = isNullMatch[1];
    const negated = !!isNullMatch[2];
    filtered = filtered.filter(function(row) {
      const val = getFieldValue(row, field);
      return negated ? (val !== null && val !== undefined) : (val === null || val === undefined);
    });
    whereStr = whereStr.replace(isNullMatch[0], ' 1=1 ');
  }

  const conditions = whereStr.split(/\s+AND\s+/i);
  for (const cond of conditions) {
    const trimmed = cond.trim();
    if (/^1\s*=\s*1$/.test(trimmed)) continue;

    const likeMatch = trimmed.match(/([\w.]+)\s+(NOT\s+)?LIKE\s+(['"][^'"]*['"])/i);
    if (likeMatch) {
      const field = likeMatch[1];
      const negated = !!likeMatch[2];
      const pattern = likeMatch[3];
      filtered = filtered.filter(function(row) {
        const result = evaluateCondition(row, field, negated ? 'NOT LIKE' : 'LIKE', pattern);
        return result;
      });
      continue;
    }

    const compMatch = trimmed.match(/([\w.]+)\s*(>=|<=|!=|<>|=|<|>)\s*(['"]?[^'"]*['"]?)/);
    if (compMatch) {
      const field = compMatch[1];
      const op = compMatch[2];
      const val = compMatch[3].trim();
      filtered = filtered.filter(function(row) { return evaluateCondition(row, field, op, val); });
      continue;
    }
  }

  return filtered;
}

function performJoin(mainRows, mainTable, joinClause, aliasMap) {
  const joinRegex = /(LEFT\s+)?JOIN\s+(\w+)\s+(\w+)\s+ON\s+([\w.]+)\s*=\s*([\w.]+)/i;
  const match = joinClause.match(joinRegex);
  if (!match) return mainRows;

  const isLeft = !!match[1];
  const joinTableName = match[2];
  const joinAlias = match[3];
  const leftField = match[4];
  const rightField = match[5];

  const joinData = tables[resolveAlias(joinAlias, joinTableName)] || [];

  const leftParts = leftField.split('.');
  const rightParts = rightField.split('.');
  const leftKey = leftParts.length === 2 ? leftParts[1] : leftField;
  const rightKey = rightParts.length === 2 ? rightParts[1] : rightField;

  const result = [];
  for (const mainRow of mainRows) {
    const mainVal = mainRow[leftKey];
    const matched = joinData.filter(function(jr) {
      return String(jr[rightKey]) === String(mainVal);
    });
    if (matched.length > 0) {
      for (const jr of matched) {
        const merged = {};
        for (const k in mainRow) {
          merged[(aliasMap[mainTable] || mainTable) + '.' + k] = mainRow[k];
          merged[k] = mainRow[k];
        }
        for (const k in jr) {
          merged[(joinAlias) + '.' + k] = jr[k];
          if (merged[k] === undefined) merged[k] = jr[k];
        }
        result.push(merged);
      }
    } else if (isLeft) {
      result.push(Object.assign({}, mainRow));
    }
  }
  return result;
}

function applySelectFields(row, selectStr, aliasMap) {
  if (/^\s*\*\s*$/.test(selectStr)) return row;

  const fields = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < selectStr.length; i++) {
    const ch = selectStr[i];
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) fields.push(current.trim());

  const result = {};
  for (const field of fields) {
    const aliasStarMatch = field.match(/^(\w+)\.\*$/);
    if (aliasStarMatch) {
      const alias = aliasStarMatch[1];
      for (const k in row) {
        if (k.startsWith(alias + '.')) {
          const bareKey = k.substring(alias.length + 1);
          if (result[bareKey] === undefined) result[bareKey] = row[k];
        }
      }
      for (const k in row) {
        if (!k.includes('.') && result[k] === undefined) result[k] = row[k];
      }
      continue;
    }

    const asMatch = field.match(/\bAS\s+(\w+)\s*$/i);
    if (asMatch) {
      const alias = asMatch[1];
      const expr = field.substring(0, field.length - asMatch[0].length).trim();
      result[alias] = evaluateExpression(row, expr);
    } else {
      const dotMatch = field.match(/^(\w+)\.(\w+)$/);
      if (dotMatch) {
        const val = row[field];
        if (val !== undefined) {
          result[dotMatch[2]] = val;
        } else {
          const bareKey = dotMatch[2];
          if (row[bareKey] !== undefined) result[bareKey] = row[bareKey];
        }
      } else {
        const simpleField = field.replace(/^\w+\./, '');
        if (row.hasOwnProperty(simpleField)) {
          result[simpleField] = row[simpleField];
        } else if (row.hasOwnProperty(field)) {
          result[field] = row[field];
        }
      }
    }
  }
  return result;
}

function evaluateExpression(row, expr) {
  const countMatch = expr.match(/COUNT\s*\(\s*\*\s*\)/i);
  if (countMatch) return row.__count__ || 0;

  const sumMatch = expr.match(/SUM\s*\(([^)]+)\)/i);
  if (sumMatch) return row['__sum__' + sumMatch[1].trim()] || 0;

  const caseMatch = expr.match(/CASE\s+WHEN\s+(.+?)\s+THEN\s+(.+?)\s+ELSE\s+(.+?)\s+END/i);
  if (caseMatch) {
    return evaluateCaseWhen(row, caseMatch[1], caseMatch[2], caseMatch[3]);
  }

  const fieldVal = getFieldValue(row, expr.trim());
  return fieldVal;
}

function evaluateCaseWhen(row, condition, thenVal, elseVal) {
  const compMatch = condition.match(/([\w.]+)\s*(>=|<=|!=|<>|=|<|>)\s*(['"]?[^'"]*['"]?)/);
  if (compMatch) {
    if (evaluateCondition(row, compMatch[1], compMatch[2], compMatch[3].trim())) {
      return isNaN(thenVal.trim()) ? thenVal.trim().replace(/^['"]|['"]$/g, '') : Number(thenVal);
    }
  }
  return isNaN(elseVal.trim()) ? elseVal.trim().replace(/^['"]|['"]$/g, '') : Number(elseVal);
}

function handleSelect(sql, params) {
  const resolvedSql = replaceParams(sql, params);

  let selectPart = '';
  let fromPart = '';
  let mainTable = '';
  let mainAlias = '';
  let wherePart = '';
  let orderPart = '';
  let limitVal = null;
  let offsetVal = null;
  let joinParts = [];
  let groupByPart = '';

  const selectMatch = resolvedSql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([\s\S]+?)$/i);
  if (!selectMatch) return [[], []];
  selectPart = selectMatch[1].trim();
  fromPart = selectMatch[2].trim();

  const joinRegex = /(LEFT\s+)?JOIN\s+[\s\S]+?(?=\s+(WHERE|GROUP|ORDER|LIMIT|HAVING|$))/i;
  let remaining = fromPart;

  const SQL_KEYWORDS = /^(WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|ORDER|HAVING|LIMIT|OFFSET|UNION|SET|VALUES|INTO|FROM|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|AND|OR|NOT|IN|IS|LIKE|BETWEEN|AS|DISTINCT|CASE|WHEN|THEN|ELSE|END|EXISTS|ALL|ANY|SOME|ASC|DESC|NULL|TRUE|FALSE|DEFAULT|PRIMARY|KEY|FOREIGN|REFERENCES|INDEX|UNIQUE|CHECK|CONSTRAINT|TABLE|DATABASE|SCHEMA|VIEW|TRIGGER|PROCEDURE|FUNCTION|CURSOR|FETCH|OPEN|CLOSE|BEGIN|COMMIT|ROLLBACK|GRANT|REVOKE|DENY)$/i;
  const mainTableMatch = remaining.match(/^(\w+)(?:\s+(\w+))?/i);
  if (mainTableMatch) {
    mainTable = mainTableMatch[1];
    mainAlias = (mainTableMatch[2] && !SQL_KEYWORDS.test(mainTableMatch[2])) ? mainTableMatch[2] : mainTableMatch[1];
    if (SQL_KEYWORDS.test(mainTableMatch[2])) {
      remaining = remaining.substring(mainTableMatch[1].length).trim();
    } else {
      remaining = remaining.substring(mainTableMatch[0].length).trim();
    }
  }

  const aliasMap = {};
  aliasMap[mainTable] = mainAlias;

  let joinExtracted = remaining;
  const joinMatches = [];
  const joinRe = /(LEFT\s+)?JOIN\s+\w+\s+\w+\s+ON\s+[\w.]+\s*=\s*[\w.]+/gi;
  let jm;
  while ((jm = joinRe.exec(remaining)) !== null) {
    joinMatches.push(jm[0]);
    const aliasM = jm[0].match(/JOIN\s+(\w+)\s+(\w+)/i);
    if (aliasM) aliasMap[aliasM[1]] = aliasM[2];
  }
  joinExtracted = remaining.replace(joinRe, '').trim();

  const whereMatch = joinExtracted.match(/WHERE\s+([\s\S]+?)(?=\s+GROUP|\s+ORDER|\s+LIMIT|$)/i);
  if (whereMatch) wherePart = whereMatch[1].trim();

  const groupMatch = joinExtracted.match(/GROUP\s+BY\s+([\s\S]+?)(?=\s+HAVING|\s+ORDER|\s+LIMIT|$)/i);
  if (groupMatch) groupByPart = groupMatch[1].trim();

  const orderMatch = joinExtracted.match(/ORDER\s+BY\s+([\s\S]+?)(?=\s+LIMIT|$)/i);
  if (orderMatch) orderPart = orderMatch[1].trim();

  const limitMatch = joinExtracted.match(/LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i);
  if (limitMatch) {
    limitVal = parseInt(limitMatch[1]);
    offsetVal = limitMatch[2] ? parseInt(limitMatch[2]) : 0;
  }

  let rows = getTableData(mainTable).map(function(r) { return Object.assign({}, r); });

  for (const joinClause of joinMatches) {
    rows = performJoin(rows, mainTable, joinClause, aliasMap);
  }

  if (wherePart) {
    rows = parseWhereClause(wherePart, rows, aliasMap);
  }

  const isAggregate = /COUNT|SUM|AVG|MIN|MAX|GROUP\s+BY/i.test(selectPart);

  if (isAggregate && groupByPart) {
    const groupFields = groupByPart.split(',').map(function(f) { return f.trim().replace(/^\w+\./, ''); });
    const groups = {};
    for (const row of rows) {
      const key = groupFields.map(function(f) { return String(row[f] || ''); }).join('|||');
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    }

    const resultRows = [];
    for (const key in groups) {
      const groupRows = groups[key];
      const resultRow = Object.assign({}, groupRows[0]);
      resultRow.__count__ = groupRows.length;

      const countMatches = selectPart.match(/COUNT\s*\(\s*\*\s*\)\s*(?:AS\s+(\w+))?/gi);
      if (countMatches) {
        for (const cm of countMatches) {
          const asM = cm.match(/AS\s+(\w+)/i);
          const alias = asM ? asM[1] : 'count';
          resultRow[alias] = groupRows.length;
        }
      }

      const sumMatches = selectPart.match(/SUM\s*\(([^)]+)\)\s*(?:AS\s+(\w+))?/gi);
      if (sumMatches) {
        for (const sm of sumMatches) {
          const inner = sm.match(/SUM\s*\(([^)]+)\)/i);
          const asM = sm.match(/AS\s+(\w+)/i);
          const alias = asM ? asM[1] : 'sum';
          const field = inner[1].trim();
          if (/CASE\s+WHEN/i.test(field)) {
            let sum = 0;
            for (const r of groupRows) {
              const caseM = field.match(/CASE\s+WHEN\s+(.+?)\s+THEN\s+(\d+)\s+ELSE\s+(\d+)\s+END/i);
              if (caseM) {
                const condField = caseM[1].match(/([\w.]+)\s*=/);
                if (condField) {
                  const fval = String(getFieldValue(r, condField[1]));
                  const condVal = caseM[1].match(/=\s*'([^']*)'/);
                  if (condVal && fval === condVal[1]) {
                    sum += Number(caseM[2]);
                  } else {
                    sum += Number(caseM[3]);
                  }
                }
              }
            }
            resultRow[alias] = sum;
          } else {
            const cleanField = field.replace(/^\w+\./, '');
            let sum = 0;
            for (const r of groupRows) { sum += Number(r[cleanField]) || 0; }
            resultRow[alias] = sum;
          }
        }
      }

      resultRows.push(resultRow);
    }
    rows = resultRows;
  } else if (isAggregate && !groupByPart) {
    const resultRow = {};
    resultRow.__count__ = rows.length;

    const countMatches = selectPart.match(/COUNT\s*\(\s*\*\s*\)\s*(?:AS\s+(\w+))?/gi);
    if (countMatches) {
      for (const cm of countMatches) {
        const asM = cm.match(/AS\s+(\w+)/i);
        const alias = asM ? asM[1] : 'count';
        resultRow[alias] = rows.length;
      }
    }

    const sumMatches = selectPart.match(/SUM\s*\(([^)]+)\)\s*(?:AS\s+(\w+))?/gi);
    if (sumMatches) {
      for (const sm of sumMatches) {
        const inner = sm.match(/SUM\s*\(([^)]+)\)/i);
        const asM = sm.match(/AS\s+(\w+)/i);
        const alias = asM ? asM[1] : 'sum';
        const field = inner[1].trim();
        if (/CASE\s+WHEN/i.test(field)) {
          let sum = 0;
          for (const r of rows) {
            const caseM = field.match(/CASE\s+WHEN\s+(.+?)\s+THEN\s+(\d+)\s+ELSE\s+(\d+)\s+END/i);
            if (caseM) {
              const condField = caseM[1].match(/([\w.]+)\s*=/);
              if (condField) {
                const fval = String(getFieldValue(r, condField[1]));
                const condVal = caseM[1].match(/=\s*'([^']*)'/);
                if (condVal && fval === condVal[1]) {
                  sum += Number(caseM[2]);
                } else {
                  sum += Number(caseM[3]);
                }
              }
            }
          }
          resultRow[alias] = sum;
        } else {
          const cleanField = field.replace(/^\w+\./, '');
          let sum = 0;
          for (const r of rows) { sum += Number(r[cleanField]) || 0; }
          resultRow[alias] = sum;
        }
      }
    }

    const simpleFields = selectPart.split(',').map(function(f) { return f.trim(); });
    for (const sf of simpleFields) {
      if (/COUNT|SUM|AVG|MIN|MAX/i.test(sf)) continue;
      const asM = sf.match(/\bAS\s+(\w+)\s*$/i);
      if (asM) {
        const alias = asM[1];
        const expr = sf.substring(0, sf.length - asM[0].length).trim();
        resultRow[alias] = evaluateExpression(rows[0] || {}, expr);
      }
    }

    rows = [resultRow];
  }

  if (orderPart) {
    const orderFields = orderPart.split(',').map(function(f) {
      f = f.trim();
      const desc = /\bDESC$/i.test(f);
      const asc = /\bASC$/i.test(f);
      let fieldName = f.replace(/\s+(DESC|ASC)$/i, '').trim();
      fieldName = fieldName.replace(/^\w+\./, '');
      return { field: fieldName, desc: desc };
    });
    rows.sort(function(a, b) {
      for (const of_ of orderFields) {
        const va = a[of_.field];
        const vb = b[of_.field];
        if (va < vb) return of_.desc ? 1 : -1;
        if (va > vb) return of_.desc ? -1 : 1;
      }
      return 0;
    });
  }

  if (limitVal !== null) {
    const start = offsetVal || 0;
    rows = rows.slice(start, start + limitVal);
  }

  if (!isAggregate) {
    rows = rows.map(function(row) { return applySelectFields(row, selectPart, aliasMap); });
  }

  return [rows, []];
}

function handleInsert(sql, params) {
  const resolvedSql = replaceParams(sql, params);

  const insertSetMatch = resolvedSql.match(/^INSERT\s+INTO\s+(\w+)\s+SET\s+([\s\S]+)$/i);
  if (insertSetMatch) {
    const tableName = insertSetMatch[1];
    const setPart = insertSetMatch[2];
    if (!tables[tableName]) tables[tableName] = [];
    const row = {};
    const setPairs = setPart.split(',').map(function(s) { return s.trim(); });
    for (const pair of setPairs) {
      const eqMatch = pair.match(/(\w+)\s*=\s*([\s\S]*)/);
      if (eqMatch) {
        let val = eqMatch[2].trim();
        if (/^NOW\(\)$/i.test(val)) val = dayjs().format('YYYY-MM-DD HH:mm:ss');
        else if (/^CURDATE\(\)$/i.test(val)) val = dayjs().format('YYYY-MM-DD');
        else val = val.replace(/^['"]|['"]$/g, '');
        if (val === 'NULL') val = null;
        row[eqMatch[1]] = val;
      }
    }
    const newId = genId();
    row.id = newId;
    tables[tableName].push(row);
    persistTable(tableName);
    return [{ insertId: newId, affectedRows: 1 }, []];
  }

  const insertMatch = resolvedSql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)$/i);
  if (insertMatch) {
    const tableName = insertMatch[1];
    const fields = insertMatch[2].split(',').map(function(f) { return f.trim(); });
    const values = splitSqlList(insertMatch[3]).map(parseSqlValue);
    if (!tables[tableName]) tables[tableName] = [];
    const row = { id: genId() };
    for (let i = 0; i < fields.length; i++) {
      row[fields[i]] = values[i] !== undefined ? values[i] : null;
    }
    tables[tableName].push(row);
    persistTable(tableName);
    return [{ insertId: row.id, affectedRows: 1 }, []];
  }

  const multiInsertMatch = resolvedSql.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)$/i);
  if (multiInsertMatch) {
    const tableName = multiInsertMatch[1];
    const fields = multiInsertMatch[2].split(',').map(function(f) { return f.trim(); });
    const valuesStr = multiInsertMatch[3];
    const valueGroups = valuesStr.match(/\(([^)]+)\)/g);
    if (!tables[tableName]) tables[tableName] = [];
    let firstId = genId();
    for (const vg of valueGroups) {
      const values = splitSqlList(vg.replace(/^\(|\)$/g, '')).map(parseSqlValue);
      const row = { id: genId() };
      for (let i = 0; i < fields.length; i++) {
        row[fields[i]] = values[i] !== undefined ? values[i] : null;
      }
      tables[tableName].push(row);
    }
    persistTable(tableName);
    return [{ insertId: firstId, affectedRows: valueGroups.length }, []];
  }

  return [{ insertId: 0, affectedRows: 0 }, []];
}

function handleUpdate(sql, params) {
  const resolvedSql = replaceParams(sql, params);

  const updateMatch = resolvedSql.match(/^UPDATE\s+(\w+)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
  if (!updateMatch) return [{ affectedRows: 0 }, []];

  const tableName = updateMatch[1];
  const setPart = updateMatch[2];
  const wherePart = updateMatch[3];

  if (!tables[tableName]) return [{ affectedRows: 0 }, []];

  let affectedRows = 0;
  for (const row of tables[tableName]) {
    if (matchesWhere(row, wherePart)) {
      const setPairs = setPart.split(',').map(function(s) { return s.trim(); });
      for (const pair of setPairs) {
        const eqMatch = pair.match(/(\w+)\s*=\s*([\s\S]*)/);
        if (eqMatch) {
          let val = eqMatch[2].trim();
          if (/^NOW\(\)$/i.test(val)) val = dayjs().format('YYYY-MM-DD HH:mm:ss');
          else if (/^CURDATE\(\)$/i.test(val)) val = dayjs().format('YYYY-MM-DD');
          else if (/^NULL$/i.test(val)) val = null;
          else val = val.replace(/^['"]|['"]$/g, '');
          row[eqMatch[1]] = val;
        }
      }
      affectedRows++;
    }
  }

  persistTable(tableName);
  return [{ affectedRows: affectedRows }, []];
}

function matchesWhere(row, whereStr) {
  const inMatch = whereStr.match(/([\w.]+)\s+(NOT\s+)?IN\s*\(([^)]+)\)/i);
  if (inMatch) {
    const field = inMatch[1];
    const negated = !!inMatch[2];
    const values = inMatch[3].split(',').map(function(v) { return v.trim().replace(/^['"]|['"]$/g, ''); });
    if (!evaluateInCondition(row, field, values, negated)) return false;
    whereStr = whereStr.replace(inMatch[0], ' 1=1 ');
  }

  const conditions = whereStr.split(/\s+AND\s+/i);
  for (const cond of conditions) {
    const trimmed = cond.trim();
    if (/^1\s*=\s*1$/.test(trimmed)) continue;

    const isNullMatch = trimmed.match(/([\w.]+)\s+IS\s+(NOT\s+)?NULL/i);
    if (isNullMatch) {
      const field = isNullMatch[1];
      const negated = !!isNullMatch[2];
      const val = row[field];
      const result = negated ? (val !== null && val !== undefined) : (val === null || val === undefined);
      if (!result) return false;
      continue;
    }

    const likeMatch = trimmed.match(/([\w.]+)\s+(NOT\s+)?LIKE\s+(['"][^'"]*['"])/i);
    if (likeMatch) {
      if (!evaluateCondition(row, likeMatch[1], likeMatch[2] ? 'NOT LIKE' : 'LIKE', likeMatch[3])) return false;
      continue;
    }

    const compMatch = trimmed.match(/([\w.]+)\s*(>=|<=|!=|<>|=|<|>)\s*(['"]?[^'"]*['"]?)/);
    if (compMatch) {
      if (!evaluateCondition(row, compMatch[1], compMatch[2], compMatch[3].trim())) return false;
      continue;
    }
  }
  return true;
}

function handleDelete(sql, params) {
  const resolvedSql = replaceParams(sql, params);

  const deleteMatch = resolvedSql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+([\s\S]+)$/i);
  if (!deleteMatch) return [{ affectedRows: 0 }, []];

  const tableName = deleteMatch[1];
  const wherePart = deleteMatch[2];

  if (!tables[tableName]) return [{ affectedRows: 0 }, []];

  const before = tables[tableName].length;
  tables[tableName] = tables[tableName].filter(function(row) { return !matchesWhere(row, wherePart); });
  const after = tables[tableName].length;

  persistTable(tableName);
  return [{ affectedRows: before - after }, []];
}

function query(sql, params) {
  try {
    const normalizedSql = sql.trim().replace(/\s+/g, ' ');

    if (/^SELECT/i.test(normalizedSql)) {
      return Promise.resolve(handleSelect(normalizedSql, params));
    }
    if (/^INSERT/i.test(normalizedSql)) {
      return Promise.resolve(handleInsert(normalizedSql, params));
    }
    if (/^UPDATE/i.test(normalizedSql)) {
      return Promise.resolve(handleUpdate(normalizedSql, params));
    }
    if (/^DELETE/i.test(normalizedSql)) {
      return Promise.resolve(handleDelete(normalizedSql, params));
    }

    return Promise.resolve([[], []]);
  } catch (err) {
    return Promise.resolve([[], []]);
  }
}

module.exports = { query, __tables: tables };
