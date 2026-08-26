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

test('weeklyTrendChange: 由移動平均頭尾換算 kg/週', () => {
  const ma = [
    { date: '2026-08-01', avg: 61 },
    { date: '2026-08-08', avg: 60 },   // 7 天掉 1kg
  ];
  const r = calc.weeklyTrendChange(ma);
  assert.ok(Math.abs(r - (-1)) < 1e-9); // -1 kg/週
});

test('dailyEnergyBalance: kg/週 → kcal/日（-0.5kg/週 ≈ -550）', () => {
  const r = calc.dailyEnergyBalance(-0.5);
  assert.ok(Math.abs(r - (-550)) < 1e-9); // -0.5*7700/7
});

test('estimateIntake: 平均TDEE + 每日能量平衡', () => {
  const r = calc.estimateIntake(2000, -0.5); // 2000 + (-550)
  assert.ok(Math.abs(r - 1450) < 1e-9);
});
