// Preserve every rule while presenting paragraphs as short, readable points.
function sections(content) {
  return String(content || '').split(/\n\s*\n/).filter(function(block) { return block.trim(); }).map(function(block) {
    var lines = block.trim().split(/\n/), heading = lines.length > 1 ? lines.shift() : '';
    return { title: heading, items: (lines.join('\n').match(/[^。；]+[。；]?/g) || []).filter(function(item) { return item.trim(); }) };
  });
}
module.exports = { sections: sections };
