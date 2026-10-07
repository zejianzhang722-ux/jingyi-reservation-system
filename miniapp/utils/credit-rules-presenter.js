function sections(rules) {
  var tiers = rules.bookingTiers || [];
  return [
    { title: '信用分与登录', items: ['初始' + rules.initialScore + '分，最高' + rules.maxScore + '分，最低0分。', '信用分不限制登录；只调整预约日期、次数和时段。'] },
    { title: '加分与扣分', items: ['爽约一次扣' + Math.abs(rules.noshowPenalty) + '分；违规使用扣' + Math.abs(rules.violationPenalty) + '分。', (rules.rewardDescription || '完成预约及有效反馈可获得奖励。').split('。')[0] + '。', '变动记录仅显示实际增减分数。'] },
    { title: '各区间的预约权限', items: tiers.map(function(tier, index) { return (index ? tier.minScore + '–' + (tiers[index - 1].minScore - 1) + '分' : '≥' + tier.minScore + '分') + '：' + (tier.advanceDays ? '可提前' + tier.advanceDays + '天' : '仅当天') + '；每天同类功能房最多' + tier.dailyLimit + '次；' + (tier.startTime ? tier.startTime + '–' + tier.endTime : '按房间开放时间') + '。' }) },
    { title: '计数与生效方式', items: ['次数按使用日期、同类功能房计算；加入组团也计入，发起人不重复计数。', '取消或被拒绝释放次数；所有预约和参与的组团不得时间重叠。', '权限随当前分数即时调整；已有预约仍可查看、取消、签到和签退。'] }
  ];
}
module.exports = { sections: sections };
