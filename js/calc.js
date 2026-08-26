// body-tracker/js/calc.js
// 純函式減脂計算核心。零外部相依，Node 與瀏覽器共用（結尾同時支援 module.exports 與 window.Calc）。
var module = typeof module !== 'undefined' ? module : { exports: {} };
const KCAL_PER_KG = 7700; // 每公斤脂肪約含 7700 kcal

// 7 日移動平均。series: [{date:'YYYY-MM-DD', value:Number}]
// 回傳依日期升冪、每點附 avg（不足視窗天數就用截至該點的現有資料平均）
function movingAverage(series, window = 7) {
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((pt, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = sorted.slice(start, i + 1);
    const avg = slice.reduce((s, p) => s + p.value, 0) / slice.length;
    return { date: pt.date, value: pt.value, avg };
  });
}

// 由移動平均序列的頭尾點換算 kg/週（負值=下降）；資料不足或跨距為 0 回傳 null
function weeklyTrendChange(maSeries) {
  if (!maSeries || maSeries.length < 2) return null;
  const first = maSeries[0];
  const last = maSeries[maSeries.length - 1];
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

// 預估達標。currentTrendWeight=目前趨勢體重, targetWeight=目標, kgPerWeek=週趨勢
// 方向不一致或無趨勢回傳 null；否則回 {weeksToGoal, etaDate:'YYYY-MM-DD'}
function projectGoal(currentTrendWeight, targetWeight, kgPerWeek, fromDate = new Date()) {
  if (!kgPerWeek) return null;
  const remaining = targetWeight - currentTrendWeight;
  if (remaining === 0) return { weeksToGoal: 0, etaDate: new Date(fromDate).toISOString().slice(0, 10) };
  if (Math.sign(remaining) !== Math.sign(kgPerWeek)) return null;
  const weeks = remaining / kgPerWeek;
  const eta = new Date(new Date(fromDate).getTime() + weeks * 7 * 86400000);
  return { weeksToGoal: weeks, etaDate: eta.toISOString().slice(0, 10) };
}

module.exports = {
  KCAL_PER_KG, movingAverage,
  weeklyTrendChange, dailyEnergyBalance, estimateIntake, projectGoal,
};

// 瀏覽器環境掛到 window.Calc（Node 環境 window 不存在，略過）
if (typeof window !== 'undefined') { window.Calc = module.exports; }
