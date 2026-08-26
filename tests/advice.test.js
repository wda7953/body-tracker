// body-tracker/tests/advice.test.js
const test = require('node:test');
const assert = require('node:assert');
const { dailyAdvice } = require('../js/advice.js');

test('恢復不足優先：睡眠差 → 提示先睡好', () => {
  const msg = dailyAdvice({ sleepScore: 45, avgStress: 30, bodyBattery: 70, weightKgPerWeek: -0.4, weightStalled: false });
  assert.match(msg, /恢復|睡好/);
});

test('恢復正常但均線卡住 → 假停滯提示', () => {
  const msg = dailyAdvice({ sleepScore: 80, avgStress: 25, bodyBattery: 80, weightKgPerWeek: -0.02, weightStalled: true });
  assert.match(msg, /卡住|鎖水/);
});

test('穩定下降且恢復良好 → 維持', () => {
  const msg = dailyAdvice({ sleepScore: 85, avgStress: 20, bodyBattery: 85, weightKgPerWeek: -0.4, weightStalled: false });
  assert.match(msg, /維持|節奏很好/);
});

test('缺任何指標不報錯，回傳字串', () => {
  const msg = dailyAdvice({});
  assert.strictEqual(typeof msg, 'string');
  assert.ok(msg.length > 0);
});
