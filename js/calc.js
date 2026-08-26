// body-tracker/js/calc.js
// 純函式減脂計算核心。零外部相依，Node 與瀏覽器共用（結尾同時支援 module.exports 與 window.Calc）。
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

module.exports = { KCAL_PER_KG, movingAverage };
