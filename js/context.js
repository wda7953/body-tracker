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
