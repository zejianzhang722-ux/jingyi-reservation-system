const { PNG } = require('D:/工青协/volunteer-platform/.local/automation/node_modules/pngjs');

function asImage(value) { return Buffer.isBuffer(value) ? PNG.sync.read(value) : value; }
function copyRow(source, target, sourceY, targetY) {
  if (targetY < 0 || targetY >= target.height) return;
  source.data.copy(target.data, targetY * target.width * 4, sourceY * source.width * 4, (sourceY + 1) * source.width * 4);
}
function copyColumn(source, target, sourceX, targetX) {
  if (targetX < 0 || targetX >= target.width) return;
  for (let y = 0; y < target.height; y++) {
    const from = (y * source.width + sourceX) * 4;
    const to = (y * target.width + targetX) * 4;
    source.data.copy(target.data, to, from, from + 4);
  }
}
function validate(frames, total, dimension, fixedStart, fixedEnd) {
  if (!frames.length || !Number.isInteger(total) || total < 1) throw Error('无效的拼接尺寸');
  const size = frames[0].image[dimension];
  if (fixedStart + fixedEnd >= size) throw Error('固定边框占满截图');
  if (frames.some(frame => frame.image[dimension] !== size || !Number.isFinite(frame.offset))) throw Error('截图片段尺寸或偏移不一致');
  if (total > size && frames.length < 2) throw Error('页面超出首屏，但没有滚动片段');
}
function stitchVertical(parts, options) {
  const frames = parts.map(part => ({ image: asImage(part.image), offset: Math.round(part.offset) }));
  const { total, fixedStart = 0, fixedEnd = 0 } = options;
  validate(frames, total, 'height', fixedStart, fixedEnd);
  const width = frames[0].image.width;
  if (frames.some(frame => frame.image.width !== width)) throw Error('纵向截图宽度不一致');
  const out = new PNG({ width, height: total });
  const covered = new Uint8Array(total);
  for (const { image, offset } of frames) {
    const top = offset === 0 ? 0 : fixedStart;
    for (let y = top; y < image.height - fixedEnd; y++) {
      const dest = offset + y;
      if (dest >= total - fixedEnd) break;
      copyRow(image, out, y, dest);
      covered[dest] = 1;
    }
  }
  const final = frames[frames.length - 1].image;
  for (let y = 0; y < fixedEnd; y++) {
    copyRow(final, out, final.height - fixedEnd + y, total - fixedEnd + y);
    covered[total - fixedEnd + y] = 1;
  }
  const missing = covered.findIndex(value => !value);
  if (missing >= 0) throw Error(`纵向截图缺失第 ${missing} 行，请缩小滚动步长`);
  return out;
}
function stitchHorizontal(parts, options) {
  const frames = parts.map(part => ({ image: asImage(part.image), offset: Math.round(part.offset) }));
  const { total, fixedStart = 0, fixedEnd = 0 } = options;
  validate(frames, total, 'width', fixedStart, fixedEnd);
  const height = frames[0].image.height;
  if (frames.some(frame => frame.image.height !== height)) throw Error('横向截图高度不一致');
  const out = new PNG({ width: total, height });
  const covered = new Uint8Array(total);
  for (const { image, offset } of frames) {
    const left = offset === 0 ? 0 : fixedStart;
    for (let x = left; x < image.width - fixedEnd; x++) {
      const dest = offset + x;
      if (dest >= total - fixedEnd) break;
      copyColumn(image, out, x, dest);
      covered[dest] = 1;
    }
  }
  const final = frames[frames.length - 1].image;
  for (let x = 0; x < fixedEnd; x++) {
    copyColumn(final, out, final.width - fixedEnd + x, total - fixedEnd + x);
    covered[total - fixedEnd + x] = 1;
  }
  const missing = covered.findIndex(value => !value);
  if (missing >= 0) throw Error(`横向截图缺失第 ${missing} 列，请缩小滚动步长`);
  return out;
}
module.exports = { stitchVertical, stitchHorizontal };
