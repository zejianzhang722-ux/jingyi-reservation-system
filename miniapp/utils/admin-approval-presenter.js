var ROOM_TYPE_LABELS = {
  study_room: '自习室',
  seminar_room: '共享空间',
  media_room: '影音室',
  competition_room: '备赛间',
  roadshow_space: '路演空间',
  dance_room: '舞蹈室',
  reading_room: '阅览室',
  multi_purpose_hall: '多功能厅',
  party_room: '党团活动室'
}

var BUILDING_LABELS = {
  1: 'B座',
  2: 'C座',
  3: 'D座'
}

function valueOf(row, keys) {
  for (var i = 0; i < keys.length; i += 1) {
    if (row && row[keys[i]] !== undefined && row[keys[i]] !== null) return row[keys[i]]
  }
  return ''
}

function toCard(row) {
  var status = valueOf(row, ['status'])
  var startTime = valueOf(row, ['startTime', 'start_time'])
  var endTime = valueOf(row, ['endTime', 'end_time'])
  var buildingId = Number(valueOf(row, ['buildingId', 'building_id']))

  return Object.assign({}, row, {
    id: Number(valueOf(row, ['id'])),
    userName: valueOf(row, ['userName', 'user_name', 'real_name', 'nickname']) || '姓名未提供',
    studentId: valueOf(row, ['studentId', 'student_id', 'student_no']) || '学号未提供',
    roomName: valueOf(row, ['roomName', 'room_name']) || '房间未提供',
    roomTypeLabel: ROOM_TYPE_LABELS[valueOf(row, ['roomType', 'room_type'])] || '其他空间',
    buildingLabel: BUILDING_LABELS[buildingId] || '全院',
    date: valueOf(row, ['date']),
    timeSlot: startTime && endTime ? startTime + '-' + endTime : valueOf(row, ['timeSlot']),
    purpose: valueOf(row, ['purpose']) || '用途未填写',
    participants: Number(valueOf(row, ['participants', 'participantCount', 'participant_count'])) || 0,
    status: status,
    isPriority: status === 'counselor_pending',
    queueLabel: status === 'counselor_pending' ? '重点待审' : '普通待审'
  })
}

module.exports = {
  ROOM_TYPE_LABELS: ROOM_TYPE_LABELS,
  toCard: toCard
}
