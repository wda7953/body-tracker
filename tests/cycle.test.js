// body-tracker/tests/cycle.test.js
// 生理期／週期計算的純函式測試
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../js/calc.js');

test('cycleStats: 0 筆 → 用預設週期、其餘為 null，不拋錯', () => {
  const r = calc.cycleStats([], 30, new Date('2026-08-30T09:00:00'));
  assert.strictEqual(r.avgCycle, 30);
  assert.strictEqual(r.lastStart, null);
  assert.strictEqual(r.predictedNext, null);
  assert.strictEqual(r.currentDay, null);
  assert.strictEqual(r.estimated, true);
});

test('cycleStats: 1 筆 → 週期用預設，預測 = 開始日 + 預設天數', () => {
  const r = calc.cycleStats(['2026-08-01'], 30, new Date('2026-08-30T09:00:00'));
  assert.strictEqual(r.avgCycle, 30);
  assert.strictEqual(r.lastStart, '2026-08-01');
  assert.strictEqual(r.predictedNext, '2026-08-31');
  assert.strictEqual(r.currentDay, 30);          // 8/1 是第1天，8/30 是第30天
  assert.strictEqual(r.estimated, true);
});

test('cycleStats: ≥2 筆 → 用實際間隔平均，estimated=false', () => {
  // 間隔 28、30 → 平均 29
  const r = calc.cycleStats(['2026-06-04', '2026-07-02', '2026-08-01'], 30, new Date('2026-08-10T09:00:00'));
  assert.strictEqual(r.avgCycle, 29);
  assert.strictEqual(r.lastStart, '2026-08-01');
  assert.strictEqual(r.predictedNext, '2026-08-30');   // 8/1 + 29
  assert.strictEqual(r.currentDay, 10);
  assert.strictEqual(r.estimated, false);
});

test('cycleStats: 輸入未排序也正確取最後一次', () => {
  const r = calc.cycleStats(['2026-08-01', '2026-06-04', '2026-07-02'], 30, new Date('2026-08-05T00:00:00'));
  assert.strictEqual(r.lastStart, '2026-08-01');
  assert.strictEqual(r.currentDay, 5);
});

test('periodDateSet: 每個開始日展開 periodDays 天', () => {
  const set = calc.periodDateSet(['2026-08-01'], 7);
  assert.strictEqual(set.size, 7);
  assert.ok(set.has('2026-08-01'));
  assert.ok(set.has('2026-08-07'));
  assert.ok(!set.has('2026-08-08'));
});

test('periodBands: 相鄰 true 併成一段，單點也有寬度', () => {
  //      idx: 0     1     2      3      4
  const flags = [false, true, true, false, true];
  const bands = calc.periodBands(flags);
  assert.deepStrictEqual(bands, [
    { from: 0.5, to: 2.5 },   // idx 1~2
    { from: 3.5, to: 4.5 },   // idx 4（單點）
  ]);
});

test('periodBands: 全 false → 空陣列', () => {
  assert.deepStrictEqual(calc.periodBands([false, false]), []);
});
