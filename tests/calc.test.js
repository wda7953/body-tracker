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
