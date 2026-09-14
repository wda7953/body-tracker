// body-tracker/tests/api.test.js
// 針對「後端卡住 → 前端永遠停在載入中」的回歸測試：apiGet 必須有逾時保護
const test = require('node:test');
const assert = require('node:assert');

// 瀏覽器全域替身（api.js 內用 localStorage 存密碼）
global.localStorage = {
  _s: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};

const api = require('../js/api.js');

test('apiGet: 後端一直不回應時，會在逾時後 reject，而不是永遠 hang', async () => {
  // fetch 永不 resolve，但遵守 AbortSignal（逾時 abort 才會 reject）
  global.fetch = (url, opts) => new Promise((_, reject) => {
    const sig = opts && opts.signal;
    if (sig) sig.addEventListener('abort', () => {
      const e = new Error('Aborted'); e.name = 'AbortError'; reject(e);
    });
  });
  await assert.rejects(
    api.apiGet('getAll', {}, 50),   // 50ms 逾時
    /逾時|timeout/i,
  );
});

test('apiGet: 後端正常回應時照常回傳 json', async () => {
  global.fetch = async () => ({ json: async () => ({ ok: true, data: { x: 1 } }) });
  const r = await api.apiGet('getSettings');
  assert.deepStrictEqual(r, { ok: true, data: { x: 1 } });
});
