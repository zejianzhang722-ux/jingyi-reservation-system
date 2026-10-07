var rulesPresenter = require('../../utils/rules-presenter')
var request = require('../../utils/request')
var util = require('../../utils/util')

Page({
  data: {
    type: '',
    typeName: '',
    rules: '', rulesSections: [],
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
        rules: data.content || data || '', rulesSections: rulesPresenter.sections(data.content || data || ''),
        loading: false
      })
    }).catch(function () {
      that.setData({
        rules: that.getDefaultRules(), rulesSections: rulesPresenter.sections(that.getDefaultRules()),
        loading: false
      })
    })
  },

  getDefaultRules: function () {
    return require('../../utils/reservation-rules')();
  }
})
