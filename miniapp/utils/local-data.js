var localRooms = [
  { id: 1, name: 'B228自习室', type: 'study_room', building_id: 1, floor: 2, location: 'B座2楼228', capacity: 50, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座2楼自习室，50个座位，24小时开放', facilities: 'WiFi,电源,空调', status: 'open' },
  { id: 2, name: 'B520自习室', type: 'study_room', building_id: 1, floor: 5, location: 'B座5楼520', capacity: 36, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座5楼自习室，36个座位，24小时开放', facilities: 'WiFi,电源,空调', status: 'open' },
  { id: 3, name: 'C110自习室', type: 'study_room', building_id: 2, floor: 1, location: 'C座1楼110', capacity: 42, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼自习室，42个座位，24小时开放', facilities: 'WiFi,电源,空调', status: 'open' },
  { id: 4, name: 'D418自习室', type: 'study_room', building_id: 3, floor: 4, location: 'D座4楼418', capacity: 15, open_start_time: '08:00', open_end_time: '21:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'D座4楼自习室，15个座位', facilities: 'WiFi,电源,空调', status: 'open' },
  { id: 5, name: 'D510自习室', type: 'study_room', building_id: 3, floor: 5, location: 'D座5楼510', capacity: 26, open_start_time: '00:00', open_end_time: '23:59', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'D座5楼自习室，26个座位，24小时开放', facilities: 'WiFi,电源,空调', status: 'open' },
  { id: 6, name: 'B102共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼102', capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人', facilities: 'WiFi,投影,白板,空调', status: 'open' },
  { id: 7, name: 'B132共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼132', capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人', facilities: 'WiFi,投影,白板,空调', status: 'open' },
  { id: 8, name: 'B134共享空间', type: 'seminar_room', building_id: 1, floor: 1, location: 'B座1楼134', capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼共享空间，12人', facilities: 'WiFi,投影,白板,空调', status: 'open' },
  { id: 9, name: 'C132共享空间', type: 'seminar_room', building_id: 2, floor: 1, location: 'C座1楼132', capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼共享空间，12人', facilities: 'WiFi,投影,白板,空调', status: 'open' },
  { id: 10, name: 'D519共享空间', type: 'seminar_room', building_id: 3, floor: 5, location: 'D座5楼519', capacity: 12, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座5楼共享空间，12人', facilities: 'WiFi,投影,白板,空调', status: 'open' },
  { id: 11, name: 'C128影音室', type: 'media_room', building_id: 2, floor: 1, location: 'C座1楼128', capacity: 30, open_start_time: '08:00', open_end_time: '23:00', max_duration: 180, need_audit: 0, need_counselor_audit: 1, description: 'C座1楼影音室，30人，需辅导员审批', facilities: 'WiFi,投影,音响,空调', status: 'open' },
  { id: 12, name: 'C310备赛间', type: 'competition_room', building_id: 2, floor: 3, location: 'C座3楼310', capacity: 30, open_start_time: '00:00', open_end_time: '23:59', max_duration: 360, need_audit: 0, need_counselor_audit: 0, description: 'C座3楼备赛间，93㎡，24小时开放', facilities: 'WiFi,电源,白板,空调', status: 'open' },
  { id: 13, name: 'B128路演空间', type: 'roadshow_space', building_id: 1, floor: 1, location: 'B座1楼128', capacity: 50, open_start_time: '08:00', open_end_time: '23:00', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼路演空间', facilities: 'WiFi,投影,音响,空调', status: 'open' },
  { id: 14, name: 'D110舞蹈室', type: 'dance_room', building_id: 3, floor: 1, location: 'D座1楼110', capacity: 20, open_start_time: '17:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼舞蹈室，93㎡', facilities: 'WiFi,音响,镜子,空调', status: 'open' },
  { id: 15, name: 'D127阅览室', type: 'reading_room', building_id: 3, floor: 1, location: 'D座1楼127', capacity: 40, open_start_time: '09:00', open_end_time: '22:00', max_duration: 0, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼阅览室，无需预约', facilities: 'WiFi,空调', status: 'open' },
  { id: 16, name: 'D218多功能厅', type: 'multi_purpose_hall', building_id: 3, floor: 2, location: 'D座2楼218', capacity: 20, open_start_time: '08:00', open_end_time: '23:00', max_duration: 180, need_audit: 0, need_counselor_audit: 1, description: 'D座2楼多功能厅，20人，需辅导员审批', facilities: 'WiFi,投影,音响,空调', status: 'open' },
  { id: 17, name: 'C133学业辅导中心', type: 'study_center', building_id: 2, floor: 1, location: 'C座1楼133', capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼学业辅导中心', facilities: 'WiFi,白板,空调', status: 'open' },
  { id: 18, name: 'D132团员模范岗', type: 'tutor', building_id: 3, floor: 1, location: 'D座1楼132', capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼团员模范岗', facilities: 'WiFi,白板,空调', status: 'open' },
  { id: 19, name: 'C210生涯发展咨询室', type: 'career_center', building_id: 2, floor: 2, location: 'C座2楼210', capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座2楼生涯发展咨询室', facilities: 'WiFi,空调', status: 'open' },
  { id: 20, name: 'D134求职就业工作室', type: 'job_studio', building_id: 3, floor: 1, location: 'D座1楼134', capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼求职就业工作室', facilities: 'WiFi,空调', status: 'open' },
  { id: 21, name: 'C228创新工作坊', type: 'innovation_workshop', building_id: 2, floor: 2, location: 'C座2楼228', capacity: 15, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'C座2楼创新工作坊', facilities: 'WiFi,3D打印机,工具,空调', status: 'open' },
  { id: 22, name: 'D128党团活动室', type: 'party_room', building_id: 3, floor: 1, location: 'D座1楼128', capacity: 20, open_start_time: '08:00', open_end_time: '22:00', max_duration: 180, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼党团活动室', facilities: 'WiFi,投影,空调', status: 'open' },
  { id: 23, name: 'C102国防教育工作室', type: 'national_defense_studio', building_id: 2, floor: 1, location: 'C座1楼102', capacity: 10, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼国防教育工作室', facilities: 'WiFi,空调', status: 'open' },
  { id: 24, name: 'C129导师交流室', type: 'mentor_room', building_id: 2, floor: 1, location: 'C座1楼129', capacity: 8, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼导师交流室', facilities: 'WiFi,白板,空调', status: 'open' },
  { id: 25, name: 'C127心理咨询室', type: 'psychology_room', building_id: 2, floor: 1, location: 'C座1楼127', capacity: 4, open_start_time: '09:00', open_end_time: '21:00', max_duration: 60, need_audit: 0, need_counselor_audit: 0, description: 'C座1楼心理咨询室', facilities: 'WiFi,空调', status: 'open' },
  { id: 26, name: 'D133资料室', type: 'data_room', building_id: 3, floor: 1, location: 'D座1楼133', capacity: 20, open_start_time: '08:00', open_end_time: '23:00', max_duration: 240, need_audit: 0, need_counselor_audit: 0, description: 'D座1楼资料室', facilities: 'WiFi,电源,空调', status: 'closed' },
  { id: 27, name: 'B133心灵驿站', type: 'psychology_room', building_id: 1, floor: 1, location: 'B座1楼133', capacity: 8, open_start_time: '09:00', open_end_time: '21:00', max_duration: 60, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼心灵驿站', facilities: 'WiFi,空调', status: 'open' },
  { id: 28, name: 'B129导师交流室', type: 'mentor_room', building_id: 1, floor: 1, location: 'B座1楼129', capacity: 10, open_start_time: '08:00', open_end_time: '22:00', max_duration: 120, need_audit: 0, need_counselor_audit: 0, description: 'B座1楼导师交流室', facilities: 'WiFi,白板,空调', status: 'open' }
]

var typeMap = {
  study: { name: '自习室', color: '#1890FF', types: ['study', 'study_room'] },
  shared: { name: '共享空间', color: '#722ED1', types: ['seminar', 'seminar_room'] },
  media: { name: '影音室', color: '#EB2F96', types: ['media', 'media_room', 'av', 'av_room'] },
  competition: { name: '备赛间', color: '#FA8C16', types: ['competition', 'competition_room', 'innovation', 'innovation_workshop'] },
  roadshow: { name: '路演空间', color: '#13C2C2', types: ['roadshow', 'roadshow_space'] },
  dance: { name: '舞蹈室', color: '#F5222D', types: ['dance', 'dance_room'] },
  reading: { name: '阅览室', color: '#52C41A', types: ['reading', 'reading_room'] },
  multi: { name: '多功能厅', color: '#2F54EB', types: ['multi', 'multi_purpose_hall', 'multifunction'] },
  academic: { name: '学业辅导', color: '#FAAD14', types: ['academic', 'study_center', 'tutor', 'mentor_room'] },
  career: { name: '就业创业', color: '#A0D911', types: ['employment', 'career', 'career_center', 'job_studio'] },
  party: { name: '党团活动', color: '#F5222D', types: ['party', 'party_room', 'national_defense', 'national_defense_studio'] },
  psychology: { name: '心理咨询', color: '#FF85C0', types: ['psychology', 'psychology_room', 'counseling_room'] }
}

function getTypeColor(roomType) {
  for (var key in typeMap) {
    if (typeMap[key].types.indexOf(roomType) !== -1) {
      return typeMap[key].color
    }
  }
  return '#1890FF'
}

function getLocalRooms() {
  return localRooms.map(function (r) {
    var room = Object.assign({}, r)
    room.typeColor = getTypeColor(r.type)
    return room
  })
}

function getRoomById(id) {
  var input = String(id || '').toUpperCase()
  var inputCodeMatch = input.match(/[A-Z]\d{3}/)
  var inputCode = inputCodeMatch ? inputCodeMatch[0] : input
  for (var i = 0; i < localRooms.length; i++) {
    var roomCodeMatch = String(localRooms[i].name || '').match(/[A-Z]\d{3}/)
    var roomCode = roomCodeMatch ? roomCodeMatch[0] : ''
    if (localRooms[i].id === id ||
        localRooms[i].id === Number(id) ||
        roomCode === inputCode ||
        String(localRooms[i].name || '').toUpperCase() === input) {
      var room = Object.assign({}, localRooms[i])
      room.typeColor = getTypeColor(room.type)
      return room
    }
  }
  return null
}

function resolveRoomId(value) {
  var room = getRoomById(value)
  return room ? room.id : value
}

var seatConfigs = {
  1: { count: 50, rowSize: 10 },
  2: { count: 36, rowSize: 10 },
  3: { count: 42, rowSize: 14 },
  4: { count: 15, rowSize: 5 },
  5: { count: 26, rowSize: 10 },
  6: { count: 12, rowSize: 6 },
  7: { count: 12, rowSize: 6 },
  8: { count: 12, rowSize: 6 },
  9: { count: 12, rowSize: 6 },
  10: { count: 12, rowSize: 6 },
  11: { count: 30, rowSize: 10 },
  12: { count: 30, rowSize: 10 },
  13: { count: 50, rowSize: 10 },
  14: { count: 20, rowSize: 10 },
  15: { count: 40, rowSize: 10 },
  16: { count: 20, rowSize: 10 },
  17: { count: 15, rowSize: 5 },
  18: { count: 15, rowSize: 5 },
  19: { count: 8, rowSize: 4 },
  20: { count: 8, rowSize: 4 },
  21: { count: 15, rowSize: 5 },
  22: { count: 20, rowSize: 10 },
  23: { count: 10, rowSize: 5 },
  24: { count: 8, rowSize: 4 },
  25: { count: 4, rowSize: 4 },
  26: { count: 20, rowSize: 10 },
  27: { count: 8, rowSize: 4 },
  28: { count: 10, rowSize: 5 }
}

function getLocalSeats(roomId) {
  var cfg = seatConfigs[roomId]
  if (!cfg) return []
  var room = getRoomById(roomId)
  var roomCodeMatch = room ? room.name.match(/[A-Z]\d{3}/) : null
  var roomCode = roomCodeMatch ? roomCodeMatch[0] : (room ? room.name.replace(/[^A-Z0-9]/g, '') : String(roomId))
  var seats = []
  for (var i = 0; i < cfg.count; i++) {
    seats.push({
      id: roomId * 1000 + i + 1,
      room_id: roomId,
      seat_number: roomCode + '-' + String(i + 1).padStart(2, '0'),
      row_num: Math.floor(i / cfg.rowSize) + 1,
      col_num: (i % cfg.rowSize) + 1,
      status: 'available',
      has_power: 1
    })
  }
  return seats
}

function generateSeats(roomId) {
  var room = null
  for (var i = 0; i < localRooms.length; i++) {
    if (localRooms[i].id === roomId || localRooms[i].id === Number(roomId)) {
      room = localRooms[i]
      break
    }
  }
  if (!room) return []
  var match = room.name.match(/[A-Z]\d{3}/)
  var roomPrefix = match ? match[0] : room.name.substring(0, 4)
  var seats = []
  for (var i = 1; i <= room.capacity; i++) {
    var numStr = i < 10 ? '0' + i : '' + i
    seats.push({
      id: i,
      name: roomPrefix + '-' + numStr,
      seatId: i
    })
  }
  return seats
}

function generateLocalTimeline(roomId, date) {
  var room = null
  for (var i = 0; i < localRooms.length; i++) {
    if (localRooms[i].id === roomId || localRooms[i].id === Number(roomId)) {
      room = localRooms[i]
      break
    }
  }
  if (!room) return { timeline: [], seats: [] }
  var seatList = generateSeats(roomId)
  var startParts = room.open_start_time.split(':')
  var endParts = room.open_end_time.split(':')
  var startHour = parseInt(startParts[0])
  var startMin = parseInt(startParts[1])
  var endHour = parseInt(endParts[0])
  var endMin = parseInt(endParts[1])
  var slots = []
  var hour = startHour
  var min = startMin
  while (hour < endHour || (hour === endHour && min < endMin)) {
    var nextHour = hour
    var nextMin = min + 30
    if (nextMin >= 60) {
      nextHour++
      nextMin -= 60
    }
    if (nextHour > endHour || (nextHour === endHour && nextMin > endMin)) break
    var timeStr = (hour < 10 ? '0' : '') + hour + ':' + (min < 10 ? '0' : '') + min
    var endTimeStr = (nextHour < 10 ? '0' : '') + nextHour + ':' + (nextMin < 10 ? '0' : '') + nextMin
    var seatStatuses = seatList.map(function (seat) {
      return {
        seatId: seat.seatId,
        seatNumber: seat.name,
        status: 'available'
      }
    })
    slots.push({
      time: timeStr,
      endTime: endTimeStr,
      status: 'available',
      seats: seatStatuses
    })
    hour = nextHour
    min = nextMin
  }
  return { timeline: slots, seats: seatList }
}

function getLocalCategories() {
  var categories = []
  for (var key in typeMap) {
    var cat = typeMap[key]
    var catRooms = localRooms.filter(function (r) {
      return cat.types.indexOf(r.type) !== -1
    })
    if (catRooms.length > 0) {
      var freeCount = catRooms.filter(function (r) {
        return r.status === 'open' || r.status === 'active'
      }).length
      categories.push({
        key: key,
        name: cat.name,
        color: cat.color,
        count: catRooms.length,
        freeCount: freeCount,
        types: cat.types,
        iconKey: key
      })
    }
  }
  return categories
}

function filterLocalRooms(typesStr, keyword) {
  var rooms = localRooms.map(function (r) {
    var room = Object.assign({}, r)
    room.typeColor = getTypeColor(r.type)
    return room
  })
  if (typesStr) {
    var types = typesStr.split(',')
    var allTypes = []
    types.forEach(function (t) {
      if (typeMap[t]) {
        allTypes = allTypes.concat(typeMap[t].types)
      } else {
        allTypes.push(t)
      }
    })
    rooms = rooms.filter(function (r) {
      return allTypes.indexOf(r.type) !== -1
    })
  }
  if (keyword) {
    var kw = keyword.toLowerCase()
    rooms = rooms.filter(function (r) {
      return r.name.toLowerCase().indexOf(kw) !== -1 ||
             (r.description && r.description.toLowerCase().indexOf(kw) !== -1) ||
             (r.location && r.location.toLowerCase().indexOf(kw) !== -1)
    })
  }
  return rooms
}

function getTypeMap() {
  return typeMap
}

function getRulesByRoomType(roomType) {
  var rules = {
    study_room: '敬一书院自习室管理制度\n\n一、开放时间\n1. B228、B520、C110、D510自习室24小时开放\n2. D418自习室开放时间为8:00-21:00\n\n二、预约规则\n1. 须提前预约座位，凭预约码签到\n2. 单次预约时长不超过4小时\n3. 每日最多预约3次\n4. 预约开始后15分钟内未签到视为爽约\n\n三、使用规范\n1. 保持安静，手机调至静音或振动模式\n2. 禁止占座，离开超过30分钟需签退\n3. 保持环境整洁，垃圾随身带走\n4. 爱护公共设施，损坏照价赔偿\n5. 禁止在自习室内进食\n\n四、信用分管理\n1. 初始信用分100分\n2. 爽约一次扣20分\n3. 信用分低于60分将限制预约7天\n4. 信用分低于30分将封禁预约30天',
    seminar_room: '敬一书院共享空间管理制度\n\n一、开放时间\n每日8:00-22:00\n\n二、预约规则\n1. 须提前预约，单次预约不超过3小时\n2. 需填写用途分类和参与人数\n3. 每日最多预约2次\n\n三、使用规范\n1. 使用投影、白板等设备需提前说明\n2. 自带电器需提前报备\n3. 使用完毕后恢复桌椅摆放\n4. 保持环境整洁，关闭空调和灯光\n5. 控制音量，避免影响周围\n\n四、违规处理\n1. 未经预约使用：扣10信用分\n2. 损坏设备：照价赔偿+扣20信用分\n3. 超时未退房：扣10信用分',
    media_room: '敬一书院影音室管理制度\n\n一、开放时间\n每日8:00-23:00\n\n二、预约规则\n1. 须提前预约，需辅导员审批\n2. 单次预约不超过3小时\n3. 需填写参与人数和用途\n\n三、使用规范\n1. 使用前检查设备完好\n2. 严禁播放违规内容\n3. 音量控制在合理范围\n4. 使用完毕关闭所有设备\n5. 禁止携带食物和饮料\n6. 保持室内清洁\n\n四、违规处理\n1. 损坏设备照价赔偿\n2. 播放违规内容永久取消使用资格',
    competition_room: '敬一书院备赛间管理制度\n\n一、开放时间\n24小时开放\n\n二、预约规则\n1. 须提前预约，单次预约不超过6小时\n2. 需填写竞赛名称和参与人数\n3. 优先保障省级以上竞赛备赛\n\n三、使用规范\n1. 仅限竞赛备赛使用\n2. 保持环境整洁\n3. 爱护公共设施\n4. 使用完毕恢复原状\n5. 禁止无关人员进入\n\n四、违规处理\n1. 非竞赛用途使用：扣15信用分\n2. 损坏设备照价赔偿',
    dance_room: '敬一书院舞蹈室管理制度\n\n一、开放时间\n每日17:00-22:00\n\n二、预约规则\n1. 须提前预约，单次预约不超过3小时\n2. 需填写参与人数\n\n三、使用规范\n1. 进入舞蹈室须换舞蹈鞋或脱鞋\n2. 禁止穿鞋底较硬的鞋进入\n3. 爱护镜子、地板等设施\n4. 音量控制在合理范围\n5. 使用完毕关闭音响和灯光\n6. 保持室内清洁\n\n四、违规处理\n1. 损坏镜子或地板照价赔偿\n2. 扰民扣10信用分',
    reading_room: '敬一书院阅览室管理制度\n\n一、开放时间\n每日9:00-22:00\n\n二、使用规范\n1. 保持安静，禁止大声喧哗\n2. 爱护图书，阅后放回原处\n3. 禁止在阅览室进食\n4. 保持环境整洁\n5. 禁止占座\n\n三、图书管理\n1. 图书仅限室内阅读，不得外借\n2. 损坏图书照价赔偿\n3. 发现图书缺失请及时报告',
    multi_purpose_hall: '敬一书院多功能厅管理制度\n\n一、开放时间\n每日8:00-23:00\n\n二、预约规则\n1. 须提前预约，需辅导员审批\n2. 单次预约不超过3小时\n3. 需填写活动内容和参与人数\n\n三、使用规范\n1. 使用前检查设备完好\n2. 活动结束后恢复桌椅摆放\n3. 关闭所有电器设备\n4. 保持环境整洁\n5. 控制音量避免扰民\n\n四、违规处理\n1. 损坏设备照价赔偿\n2. 未恢复原状扣10信用分',
    default: '敬一书院功能房使用管理制度\n\n一、预约规则\n1. 须提前预约，按预约时间使用\n2. 预约开始后15分钟内须签到\n3. 单次预约时长不超过规定上限\n4. 每日最多预约3次\n\n二、使用规范\n1. 保持环境整洁安静\n2. 爱护公共设施设备\n3. 使用完毕恢复原状\n4. 关闭电器设备\n5. 遵守书院各项规章制度\n\n三、信用分管理\n1. 爽约扣20信用分\n2. 违规扣10信用分\n3. 信用分过低将限制预约\n\n四、违规处理\n1. 损坏设施照价赔偿\n2. 严重违规取消使用资格'
  };

  if (roomType === 'roadshow_space') return rules.competition_room;
  if (roomType === 'innovation_workshop') return rules.competition_room;
  if (roomType === 'party_room') return rules.default;
  if (roomType === 'national_defense_studio') return rules.default;
  if (roomType === 'study_center') return rules.seminar_room;
  if (roomType === 'career_center') return rules.default;
  if (roomType === 'job_studio') return rules.default;
  if (roomType === 'mentor_room') return rules.seminar_room;
  if (roomType === 'psychology_room') return rules.default;
  if (roomType === 'tutor') return rules.default;
  return rules[roomType] || rules.default;
}

module.exports = {
  getLocalRooms: getLocalRooms,
  getLocalCategories: getLocalCategories,
  filterLocalRooms: filterLocalRooms,
  getTypeMap: getTypeMap,
  getTypeColor: getTypeColor,
  getRoomById: getRoomById,
  resolveRoomId: resolveRoomId,
  getLocalSeats: getLocalSeats,
  generateSeats: generateSeats,
  generateLocalTimeline: generateLocalTimeline,
  getRulesByRoomType: getRulesByRoomType
}
