// body-tracker/tests/context.test.js
const test = require('node:test');
const assert = require('node:assert');
const ctx = require('../js/context.js');

// 共用：造一串每日體重
function wSeries(pairs) { return pairs.map(([date, value]) => ({ date, value })); }

test('deltaVsYesterday / deltaVsTrend：今日高於前7日平均與昨日', () => {
  const weights = wSeries([
    ['2026-08-20', 55.0], ['2026-08-21', 55.0], ['2026-08-22', 55.0],
    ['2026-08-23', 55.0], ['2026-08-24', 55.0], ['2026-08-25', 55.0],
    ['2026-08-26', 55.0], ['2026-08-27', 55.8],
  ]);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [], cycleStarts: [] });
  assert.strictEqual(r.deltaVsYesterday, 0.8);   // 55.8 - 55.0
  assert.strictEqual(r.deltaVsTrend, 0.8);       // 55.8 - 前7天平均55.0
});

test('資料不足（前<3天）→ deltaVsTrend null、verdict 為累積中', () => {
  const weights = wSeries([['2026-08-26', 55.0], ['2026-08-27', 55.8]]);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [], cycleStarts: [] });
  assert.strictEqual(r.deltaVsTrend, null);
  assert.match(r.verdict, /資料累積中/);
});
