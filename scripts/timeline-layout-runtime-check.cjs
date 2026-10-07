// Run after DevTools CLI auto. Uses real page data and writes no reservations.
// MINIPROGRAM_AUTOMATOR_PATH may point to an existing miniprogram-automator install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require(process.env.MINIPROGRAM_AUTOMATOR_PATH || 'miniprogram-automator');
const { selectionAtPoint } = require('../miniapp/components/timeline/selection');
const out = path.resolve(__dirname, '../.artifacts/timeline-layout');
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTO_ENDPOINT || 'ws://127.0.0.1:9420' });
  const exceptions = [], results = [];
  mini.on('exception', e => exceptions.push(e));
  try {
    const system = await mini.systemInfo();
    for (const [name, route] of [
      ['study-room', '/pages/study-room/study-room?roomId=1'],
      ['room-seat', '/pages/room-timeline/room-timeline?roomId=1'],
      ['room-group', '/pages/room-timeline/room-timeline?roomId=6&reservationMode=group']
    ]) {
      if (process.env.TIMELINE_CASE && process.env.TIMELINE_CASE !== name) continue;
      console.log('CHECK', name);
      const page = await mini.reLaunch(route);
      console.log('OPENED', page.path);
      await page.waitFor(async () => !(await page.data('loading')));
      console.log('LOADED', name);
      await page.waitFor(async () => (await page.data('rulesCountdown')) === 0);
      const rules = await page.$('.rules-modal-body');
      await rules.scrollTo(0, 10000);
      // DevTools programmatic scroll does not reliably emit scrolltolower.
      await page.callMethod('onRulesScrollToLower');
      await (await page.$('.rules-agree-row')).tap();
      await (await page.$('.rules-btn-confirm')).tap();
      assert.equal(await page.data('showRulesModal'), false);
      const date = await page.$('date-picker');
      await (await date.$$('.date-item'))[1].tap();
      await page.waitFor(async () => !(await page.data('loading')));
      const timeline = await page.$('timeline');
      const scroll = await timeline.$('.timeline-scroll-x');
      const head = await timeline.$('.timeline-header');
      const corner = await timeline.$('.timeline-header-label');
      const initial = await head.offset();
      await scroll.scrollTo(200, 10000);
      await page.waitFor(350);
      assert.equal(await page.data('showTimePicker'), false, 'Scrolling must not open a reservation');
      assert.ok(Math.abs((await head.offset()).top - initial.top) < 2, 'Time header must remain pinned');
      const scrollRect = { ...(await scroll.offset()), ...(await scroll.size()) };
      assert.ok(Math.abs((await corner.offset()).left - scrollRect.left) < 2, 'Corner must stay pinned horizontally');
      const labels = await timeline.$$('.timeline-seat-label');
      const last = labels[labels.length - 1];
      assert.ok(Math.abs((await last.offset()).left - scrollRect.left) < 2, 'Seat labels must remain pinned');
      assert.ok((await last.offset()).top + Number((await last.size()).height) <= scrollRect.top + Number(scrollRect.height) + 2, 'Last seat must be reachable');
      assert.ok(Number((await page.size()).height) <= system.windowHeight + 2, 'Page must not expand with seat count');
      await mini.pageScrollTo(10000);
      assert.equal(Number(await page.scrollTop()), 0, 'Only the timeline should scroll');
      if (name === 'study-room') await mini.screenshot({ path: path.join(out, 'frozen-timeline.png') });
      await scroll.scrollTo(200, 0);
      await page.waitFor(200);
      const block = await timeline.$('.timeline-block-free');
      assert.ok(block, 'Tomorrow must have an available slot in the test room');
      const blockRect = { ...(await block.offset()), ...(await block.size()) };
      const x = Math.max(scrollRect.left + 100, blockRect.left + 3);
      const start = Number(await block.attribute('data-start')), end = Number(await block.attribute('data-end'));
      const expected = selectionAtPoint(start, end, x, blockRect);
      await block.trigger('tap', { x, y: blockRect.top + 10 });
      await page.waitFor(async () => await page.data('showTimePicker'));
      await page.waitFor(300);
      const data = await page.data();
      assert.equal(data.selectedStartHour + data.selectedStartMin / 60, expected.start, 'Tap must map to the visible time');
      const sheet = await page.$('.time-picker');
      await page.waitFor(async () => Math.abs((await sheet.offset()).top + Number((await sheet.size()).height) - system.windowHeight) < 3);
      const sheetRect = { ...(await sheet.offset()), ...(await sheet.size()) };
      console.log('SHEET_GEOMETRY', JSON.stringify({ sheetRect, windowHeight: system.windowHeight }));
      assert.ok(sheetRect.top >= 0 && Math.abs(sheetRect.top + Number(sheetRect.height) - system.windowHeight) < 3, 'Sheet must sit at the viewport bottom');
      assert.ok(await page.$('.time-picker-mask'), 'Sheet must have a background mask');
      if (name === 'study-room') await mini.screenshot({ path: path.join(out, 'reservation-sheet.png') });
      await (await page.$('.time-picker-mask')).tap();
      assert.equal(await page.data('showTimePicker'), false);
      assert.equal(await page.$('.time-picker'), null, 'Closed sheet must not occupy document space');
      await block.trigger('tap', { x, y: blockRect.top + 10 });
      await page.waitFor(async () => await page.data('showTimePicker'));
      await (await page.$('.time-picker-close')).tap();
      assert.equal(await page.data('showTimePicker'), false);
      await block.trigger('tap', { x, y: blockRect.top + 10 });
      await page.waitFor(async () => await page.data('showTimePicker'));
      await (await page.$('.time-picker-footer .btn-confirm')).tap();
      await page.waitFor(async () => (await mini.currentPage()).path === 'pages/reservation-confirm/reservation-confirm');
      const confirmation = await (await mini.currentPage()).data();
      assert.equal(Number(confirmation.startHour) + Number(confirmation.startMin) / 60, expected.start);
      if (name !== 'room-group') assert.ok(confirmation.seatId && confirmation.seatName);
      else assert.equal(confirmation.reservationMode, 'group');
      results.push({ name, seats: labels.length, windowHeight: system.windowHeight, sheet: sheetRect, passed: true });
      console.log('PASS', name);
      fs.writeFileSync(path.join(out, name + '-report.json'), JSON.stringify({ ok: true, result: results[results.length - 1], exceptions }, null, 2));
    }
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ok: true, results, exceptions }, null, 2));
  } finally { mini.disconnect(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
