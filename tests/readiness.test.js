// body-tracker/tests/readiness.test.js
const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/readiness.js');

const goodDaily = (date) => ({ date, hrv_status: 'BALANCED', sleep_score: 85, avg_stress: 25, body_battery: 80 });
const poorDaily = (date) => ({ date, hrv_status: 'LOW', sleep_score: 50, avg_stress: 60, body_battery: 35 });

test('沒有近期訓練 → hasTraining false、verdict 提示去記錄、時鐘全綠', () => {
  const r = R.recoveryClocks({ today: '2026-09-29', training: [], daily: [goodDaily('2026-09-29')] });
  assert.strictEqual(r.hasTraining, false);
  assert.strictEqual(r.verdict.level, 'unknown');
  assert.ok(r.clocks.every(c => c.status === 'green'));
});

test('今天剛衝刺 → 神經肌肉/組織/協調紅燈、verdict 避開高速高衝擊', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [{ date: '2026-09-29', session: 'sprint', intensity: 'normal' }],
    daily: [goodDaily('2026-09-29')],
  });
  const byKey = Object.fromEntries(r.clocks.map(c => [c.key, c]));
  assert.strictEqual(byKey.neuromuscular.readiness, 0);
  assert.strictEqual(byKey.neuromuscular.status, 'red');
  assert.strictEqual(byKey.tissue.status, 'red');
  assert.strictEqual(r.verdict.level, 'easy');
  assert.match(r.verdict.title, /高速|高衝擊/);
});

test('衝刺後 3 天（恢復天數 3）→ 神經肌肉回到綠燈', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [{ date: '2026-09-26', session: 'sprint', intensity: 'normal' }],
    daily: [goodDaily('2026-09-29')],
  });
  const nm = r.clocks.find(c => c.key === 'neuromuscular');
  assert.strictEqual(nm.readiness, 100);      // elapsed 3 / recDays 3
  assert.strictEqual(nm.status, 'green');
});

test('昨天重量訓練 → 肌肉紅燈、verdict 肌肉修復中', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [{ date: '2026-09-28', session: 'strength', intensity: 'normal' }],
    daily: [goodDaily('2026-09-29')],
  });
  const m = r.clocks.find(c => c.key === 'muscle');
  assert.strictEqual(m.readiness, 40);        // elapsed 1 / recDays 2.5 = 40%
  assert.strictEqual(m.status, 'red');
  // 重量也壓神經肌肉/組織 → 標題落在「避開高速高衝擊」，但 avoid 清單須動態涵蓋重量訓練
  assert.ok(r.verdict.avoid.includes('重量訓練'), 'avoid 應含重量訓練：' + r.verdict.avoid.join(','));
});

test('自律神經差 → 不管時鐘，verdict 一律先恢復', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [{ date: '2026-09-20', session: 'easy' }],   // 早就恢復
    daily: [poorDaily('2026-09-29')],
  });
  assert.strictEqual(r.autonomic.status, 'poor');
  assert.strictEqual(r.verdict.level, 'rest');
});

test('自律神經差會放慢恢復（同一筆訓練 poor 比 good 就緒度更低）', () => {
  const training = [{ date: '2026-09-27', session: 'strength', intensity: 'normal' }]; // elapsed 2
  const g = R.recoveryClocks({ today: '2026-09-29', training, daily: [goodDaily('2026-09-29')] });
  const p = R.recoveryClocks({ today: '2026-09-29', training, daily: [poorDaily('2026-09-29')] });
  const gm = g.clocks.find(c => c.key === 'muscle').readiness;
  const pm = p.clocks.find(c => c.key === 'muscle').readiness;
  assert.ok(pm < gm, `poor(${pm}) 應低於 good(${gm})`);
});

test('全部恢復且自律神經良好 → verdict ready', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [{ date: '2026-09-24', session: 'long', intensity: 'normal' }], // 5 天前，已過各時鐘
    daily: [goodDaily('2026-09-29')],
  });
  assert.strictEqual(r.verdict.level, 'ready');
});

test('取最被壓的訓練：同期衝刺+easy，神經肌肉看衝刺', () => {
  const r = R.recoveryClocks({
    today: '2026-09-29',
    training: [
      { date: '2026-09-29', session: 'easy' },
      { date: '2026-09-29', session: 'sprint' },
    ],
    daily: [goodDaily('2026-09-29')],
  });
  assert.strictEqual(r.clocks.find(c => c.key === 'neuromuscular').readiness, 0);
});
