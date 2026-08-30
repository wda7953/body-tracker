// body-tracker/js/chart.js
// 零相依 inline SVG 折線圖。回傳 SVG 字串，可直接塞進 innerHTML。
// opts: { width, height, series:[{name,color,points:[{x,y}]}], targetY?, targetColor?, bands? }
// x 用點的索引順序，y 依所有 series 的值域自動縮放。
// bands:[{from,to,color?}] —— 用「分數索引」畫背景色塊（生理期標記用），畫在折線底下不搶戲。
function lineChartSVG(opts) {
  const { width = 320, height = 140, series = [], targetY = null, targetColor = '#C62828', bands = [] } = opts || {};
  const pad = 8;
  const allY = [];
  // 只把 finite 的 y 值餵進 min/max，避免單一筆壞資料（NaN/Infinity）把整張圖的縮放搞壞
  series.forEach(s => s.points.forEach(p => { if (Number.isFinite(p.y)) allY.push(p.y); }));
  if (Number.isFinite(targetY)) allY.push(targetY);
  if (allY.length === 0) return `<svg viewBox="0 0 ${width} ${height}" width="100%"></svg>`;
  let minY = Math.min(...allY), maxY = Math.max(...allY);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const maxLen = Math.max(...series.map(s => s.points.length), 1);
  const scaleX = (i) => pad + (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * (width - 2 * pad));
  const scaleY = (v) => pad + (1 - (v - minY) / (maxY - minY)) * (height - 2 * pad);
  const polylines = series.map(s => {
    const pts = s.points.map((p, i) => `${scaleX(i).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
  }).join('');
  const target = Number.isFinite(targetY)
    ? `<line x1="${pad}" y1="${scaleY(targetY).toFixed(1)}" x2="${width - pad}" y2="${scaleY(targetY).toFixed(1)}" stroke="${targetColor}" stroke-width="1" stroke-dasharray="4 3"/>`
    : '';
  // 背景色塊（生理期）：畫在最底層，clamp 在繪圖範圍內
  const rects = (bands || []).map(b => {
    const x1 = Math.max(pad, scaleX(b.from));
    const x2 = Math.min(width - pad, scaleX(b.to));
    const w = Math.max(0, x2 - x1);
    if (w <= 0) return '';
    return `<rect x="${x1.toFixed(1)}" y="${pad}" width="${w.toFixed(1)}" height="${(height - 2 * pad).toFixed(1)}" fill="${b.color || 'rgba(255,92,138,0.12)'}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">${rects}${target}${polylines}</svg>`;
}

// 變數名加前綴避免瀏覽器多個 <script> 共用全域作用域時撞名
const chartApi = { lineChartSVG };
if (typeof module !== 'undefined') { module.exports = chartApi; }
if (typeof window !== 'undefined') { window.Chart = chartApi; }
