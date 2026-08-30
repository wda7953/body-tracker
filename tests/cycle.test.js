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

test('cyclePhase: 30天週期/7天經期 → 四期邊界正確', () => {
  // ovDay = 30 - 14 = 16
  const name = (d) => calc.cyclePhase(d, 30, 7).name;
  assert.strictEqual(name(1), '月經期');    // 1..7
  assert.strictEqual(name(7), '月經期');
  assert.strictEqual(name(8), '濾泡期');    // 8..14（< ovDay-1=15）
  assert.strictEqual(name(14), '濾泡期');
  assert.strictEqual(name(15), '排卵期');   // ovDay±1 = 15..17
  assert.strictEqual(name(17), '排卵期');
  assert.strictEqual(name(18), '黃體期');   // 18..30
  assert.strictEqual(name(30), '黃體期');
});

test('cyclePhase: 超過平均週期 → 黃體期（已逾期）', () => {
  assert.strictEqual(calc.cyclePhase(31, 30, 7).key, 'late');
});

test('cyclePhase: currentDay 無效 → unknown，不拋錯', () => {
  assert.strictEqual(calc.cyclePhase(null, 30, 7).key, 'unknown');
  assert.strictEqual(calc.cyclePhase(0, 30, 7).key, 'unknown');
});

test('cyclePhase: 短週期（21天）排卵日不早於經期結束', () => {
  // ovDay = max(8, 21-14=7) = 8
  const r = calc.cyclePhase(8, 21, 7);
  assert.strictEqual(r.name, '排卵期');   // ovDay±1 = 7..9，但第7天仍算月經期，第8天為排卵期
});
