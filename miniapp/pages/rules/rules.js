var request = require('../../utils/request')
var util = require('../../utils/util')

Page({
  data: {
    type: '',
    typeName: '',
    rules: '',
    loading: true
  },

  onLoad: function (options) {
    var type = options.type || ''
    this.setData({
      type: type,
      typeName: util.getRoomTypeName(type)
    })
    this.loadRules(type)
  },

  loadRules: function (type) {
    var that = this
    request.get('/rules', { type: type }, { silent: true }).then(function (data) {
      that.setData({
        rules: data.content || data || '',
        loading: false
      })
    }).catch(function () {
      that.setData({
        rules: that.getDefaultRules(),
        loading: false
      })
    })
  },

  getDefaultRules: function () {
    return '敬一书院功能房使用管理制度\n\n一、预约规则\n1. 所有功能房使用须提前预约，不接受空降使用\n2. 每人每日最多预约3次，单次最长4小时\n3. 可提前3天内预约\n4. 预约开始前3小时可取消，逾期不可取消\n\n二、签到规则\n1. 预约开始前30分钟至开始后30分钟内可签到\n2. 超过签到时间未签到视为爽约\n3. 签到需出示凭证码\n\n三、信用分规则\n1. 初始信用分100分\n2. 爽约一次扣20分\n3. 违规使用扣10分\n4. 信用分低于60分将限制预约\n5. 信用分低于30分将禁止预约\n\n四、使用规范\n1. 爱护公共设施，损坏照价赔偿\n2. 保持室内整洁，离开时带走个人物品\n3. 自习室保持安静，研讨室控制音量\n4. 禁止携带食物进入功能房\n5. 禁止在功能房内吸烟\n6. 使用完毕后请关闭电器设备'
  }
})
