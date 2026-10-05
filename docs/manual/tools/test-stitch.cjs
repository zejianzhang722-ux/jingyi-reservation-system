const assert = require('node:assert/strict');
const { PNG } = require('D:/工青协/volunteer-platform/.local/automation/node_modules/pngjs');
const { stitchVertical, stitchHorizontal } = require('./capture-stitch.cjs');

function frame(width, height, rows) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    png.data[i] = typeof rows === 'function' ? rows(x, y) : rows[y];
    png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255;
  }
  return png;
}
function pixel(png, x, y) { return png.data[(y * png.width + x) * 4]; }

const vertical = stitchVertical([
  { image: frame(4, 6, [10, 21, 22, 23, 24, 90]), offset: 0 },
  { image: frame(4, 6, [10, 24, 25, 26, 27, 90]), offset: 3 }
], { total: 9, fixedStart: 1, fixedEnd: 1 });
assert.equal(vertical.height, 9);
assert.deepEqual(Array.from({ length: 9 }, (_, y) => pixel(vertical, 2, y)), [10, 21, 22, 23, 24, 25, 26, 27, 90]);

const horizontal = stitchHorizontal([
  { image: frame(6, 3, (x) => [10, 21, 22, 23, 24, 90][x]), offset: 0 },
  { image: frame(6, 3, (x) => [10, 24, 25, 26, 27, 90][x]), offset: 3 }
], { total: 9, fixedStart: 1, fixedEnd: 1 });
assert.equal(horizontal.width, 9);
assert.deepEqual(Array.from({ length: 9 }, (_, x) => pixel(horizontal, x, 1)), [10, 21, 22, 23, 24, 25, 26, 27, 90]);
console.log('PASS: 纵向与横向拼接去重、固定边框只出现一次');
