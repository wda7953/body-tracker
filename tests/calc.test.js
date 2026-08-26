// body-tracker/tests/calc.test.js
const test = require('node:test');
const assert = require('node:assert');
const calc = require('../js/calc.js');

test('movingAverage: 視窗內取平均，不足視窗用現有點', () => {
  const s = [
    { date: '2026-08-01', value: 60 },
    { date: '2026-08-02', value: 62 },
    { date: '2026-08-03', value: 61 },
  ];
  const r = calc.movingAverage(s, 2);
  assert.strictEqual(r[0].avg, 60);            // 只有自己
  assert.strictEqual(r[1].avg, 61);            // (60+62)/2
  assert.strictEqual(r[2].avg, 61.5);          // (62+61)/2
});

test('movingAverage: null/undefined 視為空陣列，不拋錯', () => {
  assert.deepStrictEqual(calc.movingAverage(null), []);
  assert.deepStrictEqual(calc.movingAverage(undefined), []);
});

test('movingAverage: window <= 0 應拋出錯誤', () => {
  assert.throws(() => calc.movingAverage([{ date: '2026-08-01', value: 60 }], 0), /window must be >= 1/);
  assert.throws(() => calc.movingAverage([{ date: '2026-08-01', value: 60 }], -1), /window must be >= 1/);
});

test('movingAverage: 輸入未排序時，輸出仍依日期升冪排列', () => {
  const s = [
    { date: '2026-08-03', value: 61 },
    { date: '2026-08-01', value: 60 },
    { date: '2026-08-02', value: 62 },
  ];
  const r = calc.movingAverage(s, 2);
  assert.deepStrictEqual(r.map(p => p.date), ['2026-08-01', '2026-08-02', '2026-08-03']);
});

test('weeklyTrendChange: 由移動平均頭尾換算 kg/週', () => {
  const ma = [
    { date: '2026-08-01', avg: 61 },
    { date: '2026-08-08', avg: 60 },   // 7 天掉 1kg
  ];
  const r = calc.weeklyTrendChange(ma);
  assert.ok(Math.abs(r - (-1)) < 1e-9); // -1 kg/週
});

test('weeklyTrendChange: 輸入反序仍能算出正確（非正負顛倒）結果', () => {
  const ma = [
    { date: '2026-08-08', avg: 60 },
    { date: '2026-08-01', avg: 61 },
  ];
  const r = calc.weeklyTrendChange(ma);
  assert.ok(Math.abs(r - (-1)) < 1e-9); // 內部應先排序，不可依賴呼叫端順序
});

test('dailyEnergyBalance: kg/週 → kcal/日（-0.5kg/週 ≈ -550）', () => {
  const r = calc.dailyEnergyBalance(-0.5);
  assert.ok(Math.abs(r - (-550)) < 1e-9); // -0.5*7700/7
});

test('estimateIntake: 平均TDEE + 每日能量平衡', () => {
  const r = calc.estimateIntake(2000, -0.5); // 2000 + (-550)
  assert.ok(Math.abs(r - 1450) < 1e-9);
});

test('projectGoal: 減脂中 → 回傳週數與 ETA', () => {
  const r = calc.projectGoal(60, 57, -0.5, new Date('2026-08-27'));
  assert.ok(Math.abs(r.weeksToGoal - 6) < 1e-9); // (57-60)/-0.5 = 6 週
  assert.strictEqual(r.etaDate, '2026-10-08');    // +42 天
});

test('projectGoal: 趨勢方向相反（在變胖但目標更輕）→ null', () => {
  assert.strictEqual(calc.projectGoal(60, 57, +0.3), null);
});

test('projectGoal: 無趨勢（0）→ null', () => {
  assert.strictEqual(calc.projectGoal(60, 57, 0), null);
});

test('projectGoal: 已達目標（remaining=0）→ weeksToGoal 0，ETA=基準日', () => {
  const r = calc.projectGoal(57, 57, -0.5, new Date(2026, 7, 27)); // 本地建構日期，避開時區疑慮
  assert.strictEqual(r.weeksToGoal, 0);
  assert.strictEqual(r.etaDate, '2026-08-27');
});

test('projectGoal: 未帶 fromDate 時用本地今天日期，不受時區/時刻影響（NEVER-#2 時區規則）', () => {
  const now = new Date();
  const r = calc.projectGoal(60, 57, -0.5); // 6 週
  assert.match(r.etaDate, /^\d{4}-\d{2}-\d{2}$/);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  base.setDate(base.getDate() + Math.round(6 * 7));
  const pad2 = (n) => String(n).padStart(2, '0');
  const expected = `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
  assert.strictEqual(r.etaDate, expected);
});
