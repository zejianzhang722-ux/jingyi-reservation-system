function show(page, options) {
  var component = page && page.selectComponent && page.selectComponent('#app-dialog');
  if (component) return component.open(options);
  var fallback = Object.assign({}, options);
  if (!fallback.content && options.sections) fallback.content = options.sections.map(function(section) { return section.title + '\n' + section.items.map(function(item) { return '• ' + item }).join('\n') }).join('\n\n');
  return wx.showModal(fallback);
}
module.exports = { show: show };
