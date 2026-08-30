# 今日體重情境（成因判斷）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 body-tracker 儀表板頂部新增一塊每天常駐的「今日體重情境」卡片，用已撈的 Garmin 恢復訊號 + 生理期，判斷體重上升是水腫／沒睡飽／訓練發炎／還是真的變胖。

**Architecture:** 全部判斷邏輯放進一支新的零相依純函式檔 `js/context.js`（比照 `js/calc.js`），對外主函式 `weightContext(input)` 回傳成因陣列與彙整建議，用 `node --test` 完整覆蓋。`index.html` 只負責把 `getAll` 撈到的資料組成輸入、呼叫 `weightContext`、渲染卡片。不動撈取端、後端 GAS、LINE。

**Tech Stack:** 純 JavaScript（ES2017，無框架無相依）、Node 內建 `node:test` / `node:assert`、瀏覽器直接載入 `<script>`。

**設計文件：** `docs/specs/2026-08-30-weight-context-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `js/context.js` | 建立 | 純函式：`weightContext()` 主函式 + 內部 helper（`percentile`、`trailingValues`、`mean`、`num`）。零相依，Node 用 `require('./calc.js')`、瀏覽器用 `window.Calc`。 |
| `tests/context.test.js` | 建立 | `node --test` 案例，覆蓋各成因、多重疊加、資料不足、邊界。 |
| `index.html` | 修改 | 載入 `js/context.js`；組輸入、呼叫 `weightContext`、渲染「今日體重情境」卡片（插在最上方 advice 之後）。 |

**測試策略：** `context.js` 是唯一被單元測試的面；`index.html` 只做接線（比照現有 `calc.js`/`advice.js` 有測、`index.html` 不測的既定模式）。故 Task 1–7 為 TDD，Task 8 為手動驗證接線。

---

## Task 1: context.js 骨架 + 兩個 delta（比昨天、比均線）

**Files:**
- Create: `js/context.js`
- Test: `tests/context.test.js`

- [ ] **Step 1: 寫失敗測試**

`tests/context.test.js`:
```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL（`Cannot find module '../js/context.js'`）

- [ ] **Step 3: 寫最小實作**

`js/context.js`:
```js
// body-tracker/js/context.js
// 今日體重情境：用已撈的 Garmin 恢復訊號 + 生理期，判斷體重上升的成因。
// 純函式，零相依，Node 與瀏覽器共用（結尾同時支援 module.exports 與 window.Context）。
const Calc = (typeof require !== 'undefined') ? require('./calc.js')
           : (typeof window !== 'undefined' ? window.Calc : null);

// 各項預設閾值（皆可由 input.opts 覆寫）
const DEFAULTS = {
  trendThreshold: 0.2,     // 今日高於基準多少 kg 才進入成因判斷
  trendWindow: 7,          // 「均線基準」取今日之前幾天平均
  minTrendDays: 3,         // 基準至少要幾天資料，否則不判斷
  rhrDelta: 3,             // 靜息心率高於基準多少 bpm 算偏高
  rhrBaselineDays: 14,     // RHR 基準取樣天數
  rhrMinDays: 5,           // RHR 基準至少幾天才啟用
  sleepLow: 60,            // 睡眠分低於此算差
  stressHigh: 50,          // 壓力高於此算高
  batteryLow: 40,          // 身體電量低於此算低
  activePercentile: 80,    // 昨日 active_kcal 落在前幾百分位算偏高
  activeBaselineDays: 14,  // active_kcal 基準取樣天數
  activeMinDays: 10,       // active_kcal 基準至少幾天才啟用
  lutealDays: 7,           // 預測經期前幾天內算黃體期
  flatBand: 0.1,           // 均線週變化絕對值小於此視為「平穩」（單日跳高不算趨勢上升）
};

// 字串/空值 → 數字或 null（表格手動編輯可能留下空字串）
function num(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function mean(arr) { return (arr && arr.length) ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }

function weightContext(input) {
  input = input || {};
  const o = Object.assign({}, DEFAULTS, input.opts || {});
  const today = input.today;

  const weights = [...(input.weights || [])]
    .map(w => ({ date: String(w.date).slice(0, 10), value: num(w.value) }))
    .filter(w => w.value != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const todayW = weights.find(w => w.date === today);
  const todayWeight = todayW ? todayW.value : null;

  // 昨天日曆日字串（供比昨天、訓練發炎共用）
  const yStr = (() => { const d = Calc.parseLocalDate(today); d.setDate(d.getDate() - 1); return Calc.formatLocalDate(d); })();

  // 比昨天：嚴格取「今日前一天」的體重；漏量則 null，不拿更早的日期冒充昨天
  const priorW = weights.filter(w => w.date < today);
  const yWeight = weights.find(w => w.date === yStr);
  const yesterdayWeight = yWeight ? yWeight.value : null;
  const deltaVsYesterday = (todayWeight != null && yesterdayWeight != null)
    ? +(todayWeight - yesterdayWeight).toFixed(2) : null;

  // 比均線：今日之前 trendWindow 天的體重平均（需 >= minTrendDays 才算）
  const trendVals = priorW.slice(-o.trendWindow).map(w => w.value);
  const trendBaseline = trendVals.length >= o.minTrendDays ? mean(trendVals) : null;
  const deltaVsTrend = (todayWeight != null && trendBaseline != null)
    ? +(todayWeight - trendBaseline).toFixed(2) : null;

  const causes = [];
  let verdict;
  if (deltaVsTrend == null) {
    verdict = '資料累積中，多記幾天體重就能判斷。';
  } else {
    verdict = '數據平穩，照常執行。';
  }

  return { deltaVsYesterday, deltaVsTrend, trendRising: null, causes, verdict };
}

// 變數名加前綴避免瀏覽器多個 <script> 共用全域作用域時撞名
const contextApi = { weightContext, DEFAULTS };
if (typeof module !== 'undefined') { module.exports = contextApi; }
if (typeof window !== 'undefined') { window.Context = contextApi; }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): weightContext 骨架 + 比昨天/比均線 delta"
```

---

## Task 2: 均線方向 trendRising（複用 calc）

**Files:**
- Modify: `js/context.js`
- Test: `tests/context.test.js`

- [ ] **Step 1: 寫失敗測試**

在 `tests/context.test.js` 末尾加：
```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL（trendRising 目前恆為 null）

- [ ] **Step 3: 實作**

在 `weightContext` 內，`const causes = [];` 這行**之前**插入：
```js
  // 均線本身的方向：近 14 個 7 日均線點換算 kg/週，> 0 視為上升
  const ma = Calc.movingAverage(weights, 7);
  const kgPerWeek = Calc.weeklyTrendChange(ma.slice(-14));
  // 加平穩帶：單日跳高只讓 7 日均線微升（約 spike/7 kg/週），不應被當成趨勢上升
  const trendRising = (kgPerWeek != null) ? kgPerWeek > o.flatBand : null;
```
並把回傳物件的 `trendRising: null` 改成 `trendRising`。

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): 加入均線方向 trendRising"
```

---

## Task 3: 恢復不足型水腫（🌙）

**Files:**
- Modify: `js/context.js`
- Test: `tests/context.test.js`

判斷條件（今日 daily 快照）：HRV 狀態為 LOW/UNBALANCED/POOR，或 RHR 高於近14天基準 +rhrDelta，或睡眠分<60，或壓力>50，或電量<40。任一成立即命中，detail 列出實際命中項。RHR 基準需 >= rhrMinDays 天。

- [ ] **Step 1: 寫失敗測試**

加：
```js
// 造一串「平的」體重，讓今日剛好高於均線 0.4（進入成因判斷）
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL（causes 目前恆為空）

- [ ] **Step 3: 實作**

在 `weightContext` 內、`trendRising` 那段**之後**插入今日快照與 RHR 基準計算：
```js
  // 今日 daily 快照（對應昨晚睡眠、當日 HRV/壓力/電量/RHR）
  const daily = input.daily || [];
  const todayDaily = daily.find(d => String(d.date).slice(0, 10) === today) || {};
  const hrvStatus = todayDaily.hrv_status || null;
  const sleep = num(todayDaily.sleep_score);
  const stress = num(todayDaily.avg_stress);
  const battery = num(todayDaily.body_battery);
  const rhr = num(todayDaily.resting_hr);

  // 取今日之前最近 n 筆某欄位有效值（由新到舊）
  const trailing = (key, n) => (daily || [])
    .filter(d => String(d.date).slice(0, 10) < today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(d => num(d[key]))
    .filter(v => v != null)
    .slice(0, n);

  const rhrTrail = trailing('resting_hr', o.rhrBaselineDays);
  const rhrBase = rhrTrail.length >= o.rhrMinDays ? mean(rhrTrail) : null;
```

然後把 `const causes = [];` 之後、`if (deltaVsTrend == null)` 判斷**改寫**成完整分支（本 Task 先做「進入成因判斷 + 恢復不足」，後續 Task 補其他成因）：
```js
  const causes = [];
  let verdict;
  const isUp = deltaVsTrend != null && deltaVsTrend > o.trendThreshold;

  if (deltaVsTrend == null) {
    verdict = '資料累積中，多記幾天體重就能判斷。';
  } else if (isUp) {
    // 🌙 恢復不足型水腫
    const rec = [];
    const HRV_ZH = { LOW: '偏低', UNBALANCED: '失衡', POOR: '差' };
    if (hrvStatus && HRV_ZH[hrvStatus]) rec.push('HRV' + HRV_ZH[hrvStatus]);
    if (rhr != null && rhrBase != null && rhr > rhrBase + o.rhrDelta) rec.push('靜息心率偏高');
    if (sleep != null && sleep < o.sleepLow) rec.push('睡眠分' + Math.round(sleep));
    if (stress != null && stress > o.stressHigh) rec.push('壓力' + Math.round(stress));
    if (battery != null && battery < o.batteryLow) rec.push('電量' + Math.round(battery));
    if (rec.length) causes.push({ icon: '🌙', label: '恢復不足型水腫', detail: rec.join('、') + ' → 儲水' });

    verdict = causes.length ? '多半是水不是脂肪，維持節奏，3–5 天後再看均線。' : '數據平穩，照常執行。';
  } else {
    verdict = '數據平穩，照常執行。';
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): 恢復不足型水腫判斷(HRV/RHR/睡眠/壓力/電量)"
```

---

## Task 4: 荷爾蒙型水腫（🩸）

**Files:**
- Modify: `js/context.js`
- Test: `tests/context.test.js`

生理期中（今日落在某經期開始日起 periodDays 天內）→ 命中「生理期中」；否則若今日在預測經期前 lutealDays 天內 → 命中「黃體期」。用 `Calc.cycleStats` + `Calc.periodDateSet`。

- [ ] **Step 1: 寫失敗測試**

加：
```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL

- [ ] **Step 3: 實作**

在 `weightContext` 內、RHR 基準計算之後、`const causes = []` 之前插入生理期計算：
```js
  // 生理期狀態
  const cycleStarts = (input.cycleStarts || []).map(s => String(s).slice(0, 10)).filter(Boolean);
  const periodDays = input.periodDays || 7;
  const cs = Calc.cycleStats(cycleStarts, input.cycleDays || 30, Calc.parseLocalDate(today));
  const periodSet = Calc.periodDateSet(cycleStarts, periodDays);
  const inPeriodToday = periodSet.has(today);
  const daysUntilNext = cs.predictedNext
    ? Math.round((Calc.parseLocalDate(cs.predictedNext) - Calc.parseLocalDate(today)) / 86400000)
    : null;
  const isLuteal = !inPeriodToday && daysUntilNext != null
    && daysUntilNext > 0 && daysUntilNext <= o.lutealDays;
```

在 `isUp` 分支內、恢復不足那段 `if (rec.length) ...` 之後、`verdict = ...` 之前插入：
```js
    // 🩸 荷爾蒙型水腫
    if (inPeriodToday) {
      causes.push({ icon: '🩸', label: '荷爾蒙型水腫', detail: '生理期中 → 荷爾蒙自然儲水' });
    } else if (isLuteal) {
      causes.push({ icon: '🩸', label: '荷爾蒙型水腫', detail: `黃體期（預計 ${daysUntilNext} 天後來）→ 經前儲水` });
    }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（10 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): 荷爾蒙型水腫判斷(經期/黃體期)"
```

---

## Task 5: 訓練發炎型（💪）+ percentile helper

**Files:**
- Modify: `js/context.js`
- Test: `tests/context.test.js`

昨日 `active_kcal` 落在近 14 天前 20%（>= 80 百分位）→ 命中。基準需 >= activeMinDays 天。先加可測的 `percentile` helper。

- [ ] **Step 1: 寫失敗測試**

加：
```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL（`ctx.percentile is not a function`）

- [ ] **Step 3: 實作**

在 `js/context.js` 的 `mean` 函式之後加 `percentile`：
```js
// 百分位（線性插值），p 為 0..100。空陣列回 null。
function percentile(arr, p) {
  const a = (arr || []).filter(v => v != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return (lo === hi) ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
```

在生理期計算之後、`const causes = []` 之前，加昨日活動量判斷：
```js
  // 訓練發炎：昨日（日曆昨天，yStr 已在前面宣告）active_kcal 是否落在近14天前 activePercentile 百分位
  const yesterdayDaily = daily.find(d => String(d.date).slice(0, 10) === yStr) || {};
  const yesterdayActive = num(yesterdayDaily.active_kcal);
  // 基準排除昨日本身（比較「昨日 vs 昨日之前」），且用嚴格 > 避免全平（值全相等時 p80=該值）誤命中
  const activeHist = (daily || [])
    .filter(d => String(d.date).slice(0, 10) < yStr)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(d => num(d.active_kcal)).filter(v => v != null)
    .slice(0, o.activeBaselineDays);
  const activeP = activeHist.length >= o.activeMinDays ? percentile(activeHist, o.activePercentile) : null;
  const activeHigh = (yesterdayActive != null && activeP != null) && yesterdayActive > activeP;
```

在 `isUp` 分支內、荷爾蒙那段之後、`verdict = ...` 之前，加：
```js
    // 💪 訓練發炎型
    if (activeHigh) {
      causes.push({ icon: '💪', label: '訓練發炎型', detail: '昨天活動量偏高 → 肌肉修復儲水' });
    }
```

把 `percentile` 加進 `contextApi` 匯出：
```js
const contextApi = { weightContext, percentile, DEFAULTS };
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（15 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): 訓練發炎型判斷 + percentile helper"
```

---

## Task 6: 可能真胖 / 正常波動 / 未上升分支 + verdict 完整化

**Files:**
- Modify: `js/context.js`
- Test: `tests/context.test.js`

上升但無任何水腫成因：均線也上升 → 📈 可能真的變胖；否則 → ✅ 正常波動。未上升：均線下降給鼓勵、平穩給平穩。verdict 依情況給句子。

- [ ] **Step 1: 寫失敗測試**

加：
```js
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
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: FAIL（📈/✅ 尚未產生、未上升分支 verdict 未細分）

- [ ] **Step 3: 實作**

把 `isUp` 分支結尾的 `verdict = causes.length ? ... : ...;` **整段替換**為：
```js
    if (causes.length) {
      verdict = causes.length >= 2
        ? '幾個因素疊在一起推高，多半是水不是脂肪，維持節奏，3–5 天後再看均線。'
        : '多半是水不是脂肪，維持節奏，3–5 天後再看均線。';
    } else if (trendRising) {
      causes.push({ icon: '📈', label: '可能真的變胖', detail: '恢復訊號正常，但 7 日均線也在上升' });
      verdict = '均線也在上升，留意近期攝食。';
    } else {
      causes.push({ icon: '✅', label: '正常波動', detail: '恢復訊號正常、均線沒上升，純鎖水' });
      verdict = '免緊張，鎖水而已。';
    }
```

把最後的 `else { verdict = '數據平穩，照常執行。'; }`（未上升分支）**替換**為：
```js
  } else {
    verdict = (kgPerWeek != null && kgPerWeek < 0)
      ? '均線下降中、恢復良好，節奏很好。'
      : '數據平穩，照常執行。';
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（18 tests）

- [ ] **Step 5: Commit**

```bash
cd body-tracker
git add js/context.js tests/context.test.js
git commit -m "feat(context): 可能真胖/正常波動/未上升分支 + verdict 完整化"
```

---

## Task 7: 多重成因疊加 + 邊界 +0.2

**Files:**
- Test: `tests/context.test.js`（僅補測試，驗證前面組合行為正確）

- [ ] **Step 1: 寫測試**

加：
```js
test('多重成因：生理期 + 沒睡飽 同時命中，兩個都列出', () => {
  const weights = flatThenSpike(0.4);
  const daily = [{ date: '2026-08-27', sleep_score: 52 }];
  const r = ctx.weightContext({
    today: '2026-08-27', weights, daily, cycleStarts: ['2026-08-25'],
  });
  assert.ok(r.causes.find(x => x.icon === '🌙'), '應有恢復不足');
  assert.ok(r.causes.find(x => x.icon === '🩸'), '應有荷爾蒙');
  assert.strictEqual(r.causes.length, 2);
  assert.match(r.verdict, /疊在一起/);
});

test('邊界：剛好高於均線 +0.2（非嚴格大於）→ 不進入成因判斷', () => {
  const weights = flatThenSpike(0.2);   // 55.2 - 55.0 = 0.2，等於門檻
  const daily = [{ date: '2026-08-27', sleep_score: 40 }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.strictEqual(r.deltaVsTrend, 0.2);
  assert.strictEqual(r.causes.find(x => x.icon === '🌙'), undefined);  // 未超過門檻，不判成因
});

test('邊界：高於均線 +0.21（超過門檻）→ 進入成因判斷', () => {
  const weights = flatThenSpike(0.21);
  const daily = [{ date: '2026-08-27', sleep_score: 40 }];
  const r = ctx.weightContext({ today: '2026-08-27', weights, daily, cycleStarts: [] });
  assert.ok(r.causes.find(x => x.icon === '🌙'));
});
```

- [ ] **Step 2: 跑測試**

Run: `cd body-tracker && node --test tests/context.test.js`
Expected: PASS（21 tests）。若「邊界 +0.2」案失敗，確認 `isUp` 用的是嚴格 `>`（`deltaVsTrend > o.trendThreshold`），非 `>=`。

- [ ] **Step 3: 跑整包測試確認沒弄壞既有**

Run: `cd body-tracker && node --test tests/`
Expected: 全部 PASS（既有 21 + 新增 21 ≈ 42 tests）

- [ ] **Step 4: Commit**

```bash
cd body-tracker
git add tests/context.test.js
git commit -m "test(context): 多重成因疊加 + 門檻邊界"
```

---

## Task 8: 接進 index.html 儀表板

**Files:**
- Modify: `index.html`

把 `weightContext` 接上真實資料並渲染卡片。此檔無單元測試，改用手動驗證。

- [ ] **Step 1: 載入 context.js**

在 `index.html` 的 `<script src="js/api.js"></script>` **之前**（context 依賴 calc，需在 calc 之後）加一行：
```html
  <script src="js/context.js"></script>
```
放在 `<script src="js/calc.js"></script>` 之後即可（現有順序 calc → advice → chart → api，插在 chart 與 api 之間或 calc 之後皆可）。

- [ ] **Step 2: 加樣式**

在 `<style>` 內 `.advice { ... }` 規則之後加「今日體重情境」卡片樣式：
```css
    /* 今日體重情境卡 */
    .wctx .deltas { display: flex; gap: 16px; font-size: 13px; color: #9aa4b2; margin-bottom: 10px; font-variant-numeric: tabular-nums; }
    .wctx .deltas b { color: #fff; font-weight: 700; }
    .wctx .cause { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; line-height: 1.5; margin: 6px 0; color: #e6edf3; }
    .wctx .cause .ic { font-size: 16px; flex: 0 0 auto; }
    .wctx .verdict { font-size: 13px; color: #b6c2d0; line-height: 1.5; margin-top: 10px; padding-top: 10px; border-top: 1px solid #232c38; }
```

- [ ] **Step 3: 組輸入、呼叫、渲染**

在 `index.html` 的 `<script>` 內，`const advice = Advice.dailyAdvice(...)` 那行**之後**、`el.innerHTML = ...` 之前，加：
```js
      // 今日體重情境：把成因判斷所需資料組給 Context.weightContext
      const wctx = Context.weightContext({
        today: todayLocal,
        weights,                 // 已過濾為 [{date, value}]
        daily: dailyAsc,         // 含 resting_hr/hrv_status/sleep_score/avg_stress/body_battery/active_kcal
        cycleStarts,             // 生理期開始日字串陣列
        periodDays, cycleDays,
      });
      const fmtDelta = (v) => v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + 'kg';
      const causeRows = wctx.causes.map(c =>
        `<div class="cause"><span class="ic">${c.icon}</span><span>${c.label}（${c.detail}）</span></div>`
      ).join('');
      const wctxCard = `
        <div class="card wctx">
          <h2>今日體重情境</h2>
          <div class="deltas"><span>比昨天 <b>${fmtDelta(wctx.deltaVsYesterday)}</b></span><span>比7日均線 <b>${fmtDelta(wctx.deltaVsTrend)}</b></span></div>
          ${causeRows}
          <div class="verdict">→ ${wctx.verdict}</div>
        </div>`;
```

- [ ] **Step 4: 把卡片插入畫面**

把 `el.innerHTML = \`` 開頭的樣板裡、第一行 `<div class="card advice">💡 ${advice}</div>` **之後**插入 `${wctxCard}`：
```js
      el.innerHTML = `
        <div class="card advice">💡 ${advice}</div>
        ${wctxCard}
        ${cycleCard}
```

- [ ] **Step 5: 手動驗證（本機開檔或部署後）**

1. 本機：`cd body-tracker && python3 -m http.server 8080`，瀏覽器開 `http://localhost:8080/`，輸入密碼進 App。
2. 確認儀表板頂部（💡 建議下方）出現「今日體重情境」卡片，顯示「比昨天 / 比7日均線」兩個數字。
3. 對照當天實際狀況：若體重高於均線且睡不好/生理期，卡片應列出對應 🌙/🩸 成因；否則顯示 ✅ 或鼓勵語。
4. Console 無錯誤（特別是 `Context is not defined` → 表示 script 順序錯，回 Step 1）。

Expected: 卡片正常顯示、數字合理、無 console 錯誤。

- [ ] **Step 6: Commit**

```bash
cd body-tracker
git add index.html
git commit -m "feat: 儀表板加入今日體重情境卡片(接 weightContext)"
```

---

## Task 9: 部署與收尾

**Files:** 無（部署 + README 待辦更新）

- [ ] **Step 1: 推上 GitHub Pages**

```bash
cd body-tracker
git push
```
GitHub Pages 會自動重新部署；等 1–2 分鐘。

- [ ] **Step 2: 手機驗證**

iPhone 開 `https://wda7953.github.io/body-tracker/`，確認「今日體重情境」卡片正常顯示。

- [ ] **Step 3: 更新 auto-memory**

在 `project-body-tracker.md` 補一行：新增「今日體重情境」成因判斷卡片（context.js，用 Garmin 恢復訊號+生理期判水腫/沒睡飽/訓練發炎/真胖，門檻+0.2kg，訓練發炎型試用中）。

---

## Self-Review

**Spec 覆蓋：**
- 每天常駐面板 → Task 8（卡片無條件渲染）✅
- 比昨天 + 比7日均線兩數字 → Task 1 + Task 8 ✅
- 成因錨定7日均線、門檻 +0.2 嚴格大於 → Task 1（deltaVsTrend）+ Task 3（isUp）+ Task 7（邊界）✅
- 五類成因 → 🌙 Task 3、🩸 Task 4、💪 Task 5、📈/✅ Task 6 ✅
- 多重成因全列出 → Task 7 ✅
- 未上升時鼓勵/平穩語 → Task 6 ✅
- 資料缺失跳過（RHR≥5、active≥10、trend≥3）→ Task 1/3/5 各有測試 ✅
- HRV 狀態對應（BALANCED 正常，LOW/UNBALANCED/POOR 不良，null 跳過）→ Task 3 ✅
- 訓練發炎用近14天前20% → Task 5 ✅
- 只動前端、不碰撈取/後端/LINE → 全計畫僅改 js/context.js、tests、index.html ✅

**Placeholder scan：** 無 TBD/TODO；每個 code step 都有完整程式碼。

**型別一致性：** `weightContext` 回傳 `{deltaVsYesterday, deltaVsTrend, trendRising, causes:[{icon,label,detail}], verdict}` 全程一致；helper `num/mean/percentile/trailing` 命名前後統一；匯出 `window.Context` 與 `Context.weightContext` 呼叫一致。

**Scope：** 單一子系統（前端成因判斷），一份計畫可獨立產出可測、可用的成果。
