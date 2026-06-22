var TEMPLATE_IDS = {
  APPROVED: '',
  REJECTED: '',
  CHECKIN: '',
  CREDIT: ''
};

var TEMPLATE_META = [
  { key: 'APPROVED', name: '预约审核结果', desc: '预约通过或驳回后提醒' },
  { key: 'CHECKIN', name: '签到提醒', desc: '预约开始前提醒及时签到' },
  { key: 'CREDIT', name: '信用分变动', desc: '扣分、加分后提醒查看原因' }
];

function getTemplateStatus() {
  return TEMPLATE_META.map(function(item) {
    return {
      key: item.key,
      name: item.name,
      desc: item.desc,
      templateId: TEMPLATE_IDS[item.key] || '',
      configured: !!TEMPLATE_IDS[item.key]
    };
  });
}

function requestSubscribe(callback) {
  var tmplIds = [];
  if (TEMPLATE_IDS.APPROVED) tmplIds.push(TEMPLATE_IDS.APPROVED);
  if (TEMPLATE_IDS.REJECTED) tmplIds.push(TEMPLATE_IDS.REJECTED);
  if (TEMPLATE_IDS.CHECKIN) tmplIds.push(TEMPLATE_IDS.CHECKIN);
  if (TEMPLATE_IDS.CREDIT) tmplIds.push(TEMPLATE_IDS.CREDIT);

  if (tmplIds.length === 0) return;

  wx.requestSubscribeMessage({
    tmplIds: tmplIds,
    success: function (res) {
      if (callback) callback(res);
    },
    fail: function (err) {
      console.log('订阅消息授权失败:', err);
    }
  });
}

function requestReservationSubscribe() {
  requestSubscribe();
}

module.exports = {
  requestSubscribe: requestSubscribe,
  requestReservationSubscribe: requestReservationSubscribe,
  getTemplateStatus: getTemplateStatus,
  TEMPLATE_IDS: TEMPLATE_IDS
};
