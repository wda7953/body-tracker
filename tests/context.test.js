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

test('荷爾蒙型：今日在經期內 → 命中 🩸 生理期中', () => {
  const weights = flatThenSpike(0.4);
  // 8/25 開始的經期，periodDays 預設 7 → 8/27 仍在期內
  const r = ctx.weightContext({
    today: '2026-08-27', weights, daily: [], cycleStarts: ['2026-08-25'],
  });
  const c = r.causes.find(x => x.icon === '🩸');
  assert.ok(c);
  assert.match(c.detail, /生理期中/);
});

test('荷爾蒙型：今日在預測經期前7天內（黃體期）→ 命中 🩸 黃體期', () => {
  const weights = flatThenSpike(0.4);
  // 上次 7/30 開始，週期 30 天 → 預測下次約 8/29；8/27 距 2 天 → 黃體期
  const r = ctx.weightContext({
    today: '2026-08-27', weights, daily: [], cycleStarts: ['2026-06-30', '2026-07-30'], cycleDays: 30,
  });
  const c = r.causes.find(x => x.icon === '🩸');
  assert.ok(c);
  assert.match(c.detail, /黃體期/);
});

test('荷爾蒙型：無生理期資料 → 不命中 🩸', () => {
  const weights = flatThenSpike(0.4);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [], cycleStarts: [] });
  assert.strictEqual(r.causes.find(x => x.icon === '🩸'), undefined);
});

test('percentile：線性插值，p80 正確', () => {
  const a = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.strictEqual(ctx.percentile(a, 80), 82);   // 0.8*(10-1)=7.2 → 80+0.2*(90-80)
  assert.strictEqual(ctx.percentile([], 80), null);
  assert.strictEqual(ctx.percentile([42], 80), 42);
});

// 造 10 天 active_kcal 基準（不含今日與昨日）都在 300，昨日給高值
function activeBaselineDaily(base, yesterdayVal) {
  const days = ['2026-08-16','2026-08-17','2026-08-18','2026-08-19','2026-08-20',
                '2026-08-21','2026-08-22','2026-08-23','2026-08-24','2026-08-25'];
  const rows = days.map(date => ({ date, active_kcal: base }));
  rows.push({ date: '2026-08-26', active_kcal: yesterdayVal });  // 昨日
  return rows;
}

test('訓練發炎型：昨日 active_kcal 落在前20% → 命中 💪', () => {
  const weights = flatThenSpike(0.4);
  const daily = activeBaselineDaily(300, 900);   // 昨日 900 遠高於前20%
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.ok(r.causes.find(x => x.icon === '💪'));
});

test('訓練發炎型：昨日 active_kcal 平平 → 不命中', () => {
  const weights = flatThenSpike(0.4);
  const daily = activeBaselineDaily(300, 300);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.strictEqual(r.causes.find(x => x.icon === '💪'), undefined);
});

test('訓練發炎型：基準天數不足（<10）→ 不命中', () => {
  const weights = flatThenSpike(0.4);
  const daily = [
    { date: '2026-08-24', active_kcal: 300 }, { date: '2026-08-25', active_kcal: 300 },
    { date: '2026-08-26', active_kcal: 900 },  // 昨日高，但基準只有 3 天
  ];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.strictEqual(r.causes.find(x => x.icon === '💪'), undefined);
});

test('可能真胖：上升且均線也上升、無恢復問題 → 📈', () => {
  // 一路緩升，今日再高於前7均線 > 0.2；daily 全正常
  const weights = wSeries([
    ['2026-08-20', 54.4], ['2026-08-21', 54.5], ['2026-08-22', 54.6],
    ['2026-08-23', 54.7], ['2026-08-24', 54.8], ['2026-08-25', 54.9],
    ['2026-08-26', 55.0], ['2026-08-27', 55.4],
  ]);
  const daily = [{ date: '2026-08-27', sleep_score: 85, avg_stress: 25, body_battery: 80, hrv_status: 'BALANCED' }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.ok(r.causes.find(x => x.icon === '📈'));
  assert.match(r.verdict, /攝食/);
});

test('正常波動：上升但均線沒上升、無恢復問題 → ✅ 鎖水', () => {
  const weights = flatThenSpike(0.4);   // 前面全平、今日一次跳高 → 均線幾乎不動
  const daily = [{ date: '2026-08-27', sleep_score: 85, avg_stress: 25, body_battery: 80, hrv_status: 'BALANCED' }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  const c = r.causes.find(x => x.icon === '✅');
  assert.ok(c);
  assert.match(r.verdict, /鎖水|水/);
});

test('未上升：均線下降 → 鼓勵語，causes 空', () => {
  const weights = wSeries([
    ['2026-08-20', 56.0], ['2026-08-21', 55.8], ['2026-08-22', 55.6],
    ['2026-08-23', 55.4], ['2026-08-24', 55.2], ['2026-08-25', 55.0],
    ['2026-08-26', 54.8], ['2026-08-27', 54.6],
  ]);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [], cycleStarts: [] });
  assert.strictEqual(r.causes.length, 0);
  assert.match(r.verdict, /下降|節奏/);
});

test('未上升：均線平穩（全平）→ 平穩語，causes 空', () => {
  const weights = wSeries([
    ['2026-08-20', 55.0], ['2026-08-21', 55.0], ['2026-08-22', 55.0],
    ['2026-08-23', 55.0], ['2026-08-24', 55.0], ['2026-08-25', 55.0],
    ['2026-08-26', 55.0], ['2026-08-27', 55.0],
  ]);
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily: [], cycleStarts: [] });
  assert.strictEqual(r.causes.length, 0);
  assert.match(r.verdict, /平穩|照常/);
});
