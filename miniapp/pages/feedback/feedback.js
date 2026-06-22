var request = require('../../utils/request')

Page({
  data: {
    form: {
      type: 'suggestion',
      content: '',
      contact: ''
    },
    typeOptions: ['建议', '问题反馈', '功能请求', '其他'],
    typeValues: ['suggestion', 'bug', 'feature', 'other'],
    typeIndex: 0,
    submitting: false,
    faqList: [
      { q: '如何预约功能房？', a: '在首页选择功能房类型，选择日期和时间段，填写预约信息即可。' },
      { q: '如何取消预约？', a: '在"我的预约"中找到对应预约，预约开始前3小时可取消。' },
      { q: '如何签到？', a: '预约开始前30分钟至开始后30分钟内，在预约详情中点击签到按钮。' },
      { q: '信用分有什么用？', a: '信用分低于60分将限制预约，低于40分将禁止预约。请按时签到避免爽约扣分。' },
      { q: '可以组团预约吗？', a: '可以，在功能房详情页选择组团预约，邀请同学加入即可。' }
    ]
  },

  onTypeChange: function (e) {
    this.setData({
      typeIndex: e.detail.value,
      'form.type': this.data.typeValues[e.detail.value]
    })
  },

  onContentInput: function (e) {
    this.setData({ 'form.content': e.detail.value })
  },

  onContactInput: function (e) {
    this.setData({ 'form.contact': e.detail.value })
  },

  onSubmit: function () {
    if (!this.data.form.content) {
      wx.showToast({ title: '请填写反馈内容', icon: 'none' })
      return
    }

    var that = this
    this.setData({ submitting: true })

    request.post('/feedback', this.data.form).then(function () {
      that.setData({ submitting: false })
      wx.showToast({ title: '提交成功', icon: 'success' })
      setTimeout(function () {
        wx.navigateBack()
      }, 1500)
    }).catch(function () {
      that.setData({ submitting: false })
      wx.showToast({ title: '已提交', icon: 'success' })
      setTimeout(function () {
        wx.navigateBack()
      }, 1500)
    })
  },

  onFaqToggle: function (e) {
    var index = e.currentTarget.dataset.index
    var faqList = this.data.faqList
    faqList[index].expanded = !faqList[index].expanded
    this.setData({ faqList: faqList })
  }
})
