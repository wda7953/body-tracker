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

test('trendRising：均線往上時為 true、往下時為 false', () => {
  // 8 天一路上升 → 近14均線點斜率為正
  const up = wSeries([
    ['2026-08-20', 54.0], ['2026-08-21', 54.2], ['2026-08-22', 54.4],
    ['2026-08-23', 54.6], ['2026-08-24', 54.8], ['2026-08-25', 55.0],
    ['2026-08-26', 55.2], ['2026-08-27', 55.4],
  ]);
  assert.strictEqual(ctx.weightContext({ today: '2026-08-27', weights: up, daily: [], cycleStarts: [] }).trendRising, true);

  const down = wSeries([
    ['2026-08-20', 56.0], ['2026-08-21', 55.8], ['2026-08-22', 55.6],
    ['2026-08-23', 55.4], ['2026-08-24', 55.2], ['2026-08-25', 55.0],
    ['2026-08-26', 54.8], ['2026-08-27', 54.6],
  ]);
  assert.strictEqual(ctx.weightContext({ today: '2026-08-27', weights: down, daily: [], cycleStarts: [] }).trendRising, false);
});

// 造 8 天「平的」體重，讓今日剛好高於均線 spike（進入成因判斷）
function flatThenSpike(spike) {
  return wSeries([
    ['2026-08-20', 55.0], ['2026-08-21', 55.0], ['2026-08-22', 55.0],
    ['2026-08-23', 55.0], ['2026-08-24', 55.0], ['2026-08-25', 55.0],
    ['2026-08-26', 55.0], ['2026-08-27', 55.0 + spike],
  ]);
}
// 造 6 天 RHR 基準都 50 的 daily（不含今日）
function rhrBaselineDaily(rhr) {
  return ['2026-08-21','2026-08-22','2026-08-23','2026-08-24','2026-08-25','2026-08-26']
    .map(date => ({ date, resting_hr: rhr }));
}

test('恢復不足型：睡眠分低 → 命中 🌙，detail 含睡眠分', () => {
  const weights = flatThenSpike(0.4);
  const daily = [{ date: '2026-08-27', sleep_score: 52 }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  const c = r.causes.find(x => x.icon === '🌙');
  assert.ok(c, '應命中恢復不足型');
  assert.match(c.detail, /睡眠分52/);
});

test('恢復不足型：HRV 偏低 → 命中，detail 含 HRV', () => {
  const weights = flatThenSpike(0.4);
  const daily = [{ date: '2026-08-27', hrv_status: 'LOW' }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.match(r.causes.find(x => x.icon === '🌙').detail, /HRV/);
});

test('恢復不足型：HRV UNBALANCED/POOR → 命中；BALANCED/NONE/空值 → 不因 HRV 命中', () => {
  const weights = flatThenSpike(0.4);
  for (const s of ['UNBALANCED', 'POOR']) {
    const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [{ date: '2026-08-27', hrv_status: s }], cycleStarts: [] });
    assert.ok(r.causes.find(x => x.icon === '🌙'), s + ' 應命中');
  }
  for (const s of ['BALANCED', 'NONE', null, '']) {
    const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [{ date: '2026-08-27', hrv_status: s }], cycleStarts: [] });
    assert.strictEqual(r.causes.find(x => x.icon === '🌙'), undefined, String(s) + ' 不應命中');
  }
});

test('恢復不足型：RHR 高於基準 +3 → 命中（基準夠天數才算）', () => {
  const weights = flatThenSpike(0.4);
  const daily = [...rhrBaselineDaily(50), { date: '2026-08-27', resting_hr: 55 }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.match(r.causes.find(x => x.icon === '🌙').detail, /靜息心率/);
});

test('恢復不足型：RHR 基準天數不足（<5）→ 不因 RHR 命中', () => {
  const weights = flatThenSpike(0.4);
  const daily = [
    { date: '2026-08-25', resting_hr: 50 }, { date: '2026-08-26', resting_hr: 50 },
    { date: '2026-08-27', resting_hr: 60 },  // 只有 2 天基準
  ];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.strictEqual(r.causes.find(x => x.icon === '🌙'), undefined);
});
