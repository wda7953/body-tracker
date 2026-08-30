// body-tracker/js/calc.js
// 純函式減脂計算核心。零外部相依，Node 與瀏覽器共用（結尾同時支援 module.exports 與 window.Calc）。
const KCAL_PER_KG = 7700; // 每公斤脂肪約含 7700 kcal

// 7 日移動平均。series: [{date:'YYYY-MM-DD', value:Number}]
// null/undefined 視為空陣列；window 必須 >= 1（否則拋錯，避免靜默算出 NaN）
// 回傳依日期升冪、每點附 avg（不足視窗天數就用截至該點的現有資料平均）
function movingAverage(series, window = 7) {
  if (window <= 0) throw new Error('window must be >= 1');
  const sorted = [...(series || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((pt, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = sorted.slice(start, i + 1);
    const avg = slice.reduce((s, p) => s + p.value, 0) / slice.length;
    return { date: pt.date, value: pt.value, avg };
  });
}

// 由移動平均序列的頭尾點換算 kg/週（負值=下降）；資料不足或跨距為 0 回傳 null
// 內部先依日期升冪排序一份副本，不依賴呼叫端是否已排序
function weeklyTrendChange(maSeries) {
  if (!maSeries || maSeries.length < 2) return null;
  const sorted = [...maSeries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (new Date(last.date) - new Date(first.date)) / 86400000;
  if (days <= 0) return null;
  return ((last.avg - first.avg) / days) * 7;
}

// kg/週 → 每日熱量平衡（kcal/日，負值=缺口）
function dailyEnergyBalance(kgPerWeek) {
  return (kgPerWeek * KCAL_PER_KG) / 7;
}

// 推估每日攝食 = 平均 TDEE + 每日能量平衡（平衡為負代表吃得比 TDEE 少）
function estimateIntake(avgTDEE, kgPerWeek) {
  return avgTDEE + dailyEnergyBalance(kgPerWeek);
}

// 補零到兩位數（月/日格式化用）
function pad2(n) { return String(n).padStart(2, '0'); }

// 把 Date 格式化成本地 Y/M/D 的 'YYYY-MM-DD'（NOT toISOString，避免 UTC 轉換位移日期）
function formatLocalDate(dt) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

// 把 'YYYY-MM-DD' 解析成「本地」午夜（加 T00:00:00，避免被當 UTC 午夜而在正時區位移一天）
function parseLocalDate(s) { return new Date(String(s).slice(0, 10) + 'T00:00:00'); }

// ── 生理期／週期計算（純函式，Node 與瀏覽器共用，可測試）──
// startDates: 生理期「開始日」字串陣列 'YYYY-MM-DD'（順序不拘）
// 回傳 { avgCycle, lastStart, predictedNext, currentDay, estimated }
//  - 資料 0 筆：全部給 null（除了 avgCycle 用預設），不報錯
//  - 只有 1 筆：週期用 defaultCycle（estimated=true 代表用預設值、非實測平均）
//  - ≥2 筆：avgCycle 用實際間隔平均（四捨五入）
function cycleStats(startDates, defaultCycle = 30, today = new Date()) {
  const ds = [...(startDates || [])].map(s => s && String(s).slice(0, 10)).filter(Boolean).sort();
  if (ds.length === 0) {
    return { avgCycle: defaultCycle, lastStart: null, predictedNext: null, currentDay: null, estimated: true };
  }
  let avgCycle = defaultCycle, estimated = true;
  if (ds.length >= 2) {
    let sum = 0, cnt = 0;
    for (let i = 1; i < ds.length; i++) {
      const gap = Math.round((parseLocalDate(ds[i]) - parseLocalDate(ds[i - 1])) / 86400000);
      if (gap > 0) { sum += gap; cnt++; }
    }
    if (cnt) { avgCycle = Math.round(sum / cnt); estimated = false; }
  }
  const lastStart = ds[ds.length - 1];
  const next = parseLocalDate(lastStart); next.setDate(next.getDate() + avgCycle);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const currentDay = Math.floor((t - parseLocalDate(lastStart)) / 86400000) + 1;
  return { avgCycle, lastStart, predictedNext: formatLocalDate(next), currentDay, estimated };
}

// 依「週期第幾天」判斷所在階段。回傳 { key, name, note }
//  分期以「黃體期固定約 14 天」回推排卵日（ovDay = avgCycle - 14），再依個人週期縮放：
//   月經期(1..periodDays) → 濾泡期(..排卵前) → 排卵期(排卵日±1) → 黃體期(排卵後..) → 逾期(>avgCycle)
function cyclePhase(currentDay, avgCycle = 30, periodDays = 7) {
  if (currentDay == null || currentDay < 1) return { key: 'unknown', name: '—', note: '' };
  const ovDay = Math.max(periodDays + 1, Math.round(avgCycle) - 14);   // 排卵日（至少在經期結束後）
  if (currentDay > Math.round(avgCycle)) return { key: 'late', name: '黃體期（已逾期）', note: '預計日已過，快來了' };
  if (currentDay <= periodDays)          return { key: 'menstrual', name: '月經期', note: '易水腫，體重上升多為水分' };
  if (currentDay < ovDay - 1)            return { key: 'follicular', name: '濾泡期', note: '狀態回升，適合安排強度' };
  if (currentDay <= ovDay + 1)           return { key: 'ovulation', name: '排卵期', note: '體能高點' };
  return { key: 'luteal', name: '黃體期', note: '易嘴饞、水腫，別被體重嚇到' };
}

// 生理期日期集合：每個開始日往後算 periodDays 天，回傳 Set<'YYYY-MM-DD'>
// 給圖表判斷「哪幾天要標記」用
function periodDateSet(startDates, periodDays = 7) {
  const set = new Set();
  (startDates || []).map(s => s && String(s).slice(0, 10)).filter(Boolean).forEach(s => {
    const base = parseLocalDate(s);
    for (let i = 0; i < periodDays; i++) {
      const d = new Date(base); d.setDate(d.getDate() + i);
      set.add(formatLocalDate(d));
    }
  });
  return set;
}

// 把「一串是否落在生理期內」的布林序列，壓成連續色塊 [{from,to}]（用分數索引，±0.5 讓單點也有寬度）
// flags[i] 對應圖表第 i 個點；相鄰的 true 併成一段
function periodBands(flags) {
  const bands = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (start < 0) start = i; }
    else if (start >= 0) { bands.push({ from: start - 0.5, to: (i - 1) + 0.5 }); start = -1; }
  }
  return bands;
}

// 預估達標。currentTrendWeight=目前趨勢體重, targetWeight=目標, kgPerWeek=週趨勢
// 方向不一致或無趨勢回傳 null；否則回 {weeksToGoal, etaDate:'YYYY-MM-DD'}
// ETA 一律用 fromDate 的「本地」年/月/日推算日曆天數，不用 toISOString（那是 UTC 日曆天，
// 會因時區與時刻不同而位移一天，是 NEVER-#2 那類時區 bug）
function projectGoal(currentTrendWeight, targetWeight, kgPerWeek, fromDate = new Date()) {
  if (!kgPerWeek) return null;
  const remaining = targetWeight - currentTrendWeight;
  const base = new Date(fromDate);
  const dateOnly = new Date(base.getFullYear(), base.getMonth(), base.getDate()); // 去掉時分秒
  if (remaining === 0) return { weeksToGoal: 0, etaDate: formatLocalDate(dateOnly) };
  if (Math.sign(remaining) !== Math.sign(kgPerWeek)) return null;
  const weeks = remaining / kgPerWeek;
  const eta = new Date(dateOnly);
  eta.setDate(eta.getDate() + Math.round(weeks * 7));
  return { weeksToGoal: weeks, etaDate: formatLocalDate(eta) };
}

// 變數名加前綴避免瀏覽器多個 <script> 共用全域作用域時撞名（各檔都叫 api 會 "already declared"）
const calcApi = {
  KCAL_PER_KG, movingAverage,
  weeklyTrendChange, dailyEnergyBalance, estimateIntake, projectGoal,
  formatLocalDate, parseLocalDate, cycleStats, cyclePhase, periodDateSet, periodBands,
};

// Node 與瀏覽器環境各自掛載，互不干擾（不使用 var module 保險寫法，避免在瀏覽器洩漏 window.module）
if (typeof module !== 'undefined') { module.exports = calcApi; }
if (typeof window !== 'undefined') { window.Calc = calcApi; }
