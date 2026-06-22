var util = require('../../utils/util')

Component({
  properties: {
    days: {
      type: Number,
      value: 4
    },
    selectedDate: {
      type: String,
      value: ''
    }
  },

  data: {
    dateList: [],
    currentIndex: 0
  },

  observers: {
    'days': function (days) {
      this.setData({
        dateList: util.getDateList(days)
      })
    }
  },

  lifetimes: {
    attached: function () {
      var list = util.getDateList(this.data.days)
      this.setData({
        dateList: list,
        currentIndex: 0
      })
      if (list.length > 0 && !this.data.selectedDate) {
        this.triggerEvent('change', { date: list[0].date })
      }
    }
  },

  methods: {
    onDateTap: function (e) {
      var index = e.currentTarget.dataset.index
      var item = this.data.dateList[index]
      this.setData({
        currentIndex: index
      })
      this.triggerEvent('change', { date: item.date })
    }
  }
})
