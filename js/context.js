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

// 百分位（線性插值），p 為 0..100。空陣列回 null。
function percentile(arr, p) {
  const a = (arr || []).filter(v => v != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  if (a.length === 1) return a[0];
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return (lo === hi) ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}

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

  // 均線本身的方向：近 14 個 7 日均線點換算 kg/週，> 0 視為上升
  const ma = Calc.movingAverage(weights, 7);
  const kgPerWeek = Calc.weeklyTrendChange(ma.slice(-14));
  // 加平穩帶：單日跳高只讓 7 日均線微升（約 spike/7 kg/週），不應被當成趨勢上升
  const trendRising = (kgPerWeek != null) ? kgPerWeek > o.flatBand : null;

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

    // 🩸 荷爾蒙型水腫
    if (inPeriodToday) {
      causes.push({ icon: '🩸', label: '荷爾蒙型水腫', detail: '生理期中 → 荷爾蒙自然儲水' });
    } else if (isLuteal) {
      causes.push({ icon: '🩸', label: '荷爾蒙型水腫', detail: `黃體期（預計 ${daysUntilNext} 天後來）→ 經前儲水` });
    }

    // 💪 訓練發炎型
    if (activeHigh) {
      causes.push({ icon: '💪', label: '訓練發炎型', detail: '昨天活動量偏高 → 肌肉修復儲水' });
    }

    verdict = causes.length ? '多半是水不是脂肪，維持節奏，3–5 天後再看均線。' : '數據平穩，照常執行。';
  } else {
    verdict = '數據平穩，照常執行。';
  }

  return { deltaVsYesterday, deltaVsTrend, trendRising, causes, verdict };
}

// 變數名加前綴避免瀏覽器多個 <script> 共用全域作用域時撞名
const contextApi = { weightContext, percentile, DEFAULTS };
if (typeof module !== 'undefined') { module.exports = contextApi; }
if (typeof window !== 'undefined') { window.Context = contextApi; }
