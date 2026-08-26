// body-tracker/js/chart.js
// 零相依 inline SVG 折線圖。回傳 SVG 字串，可直接塞進 innerHTML。
// opts: { width, height, series:[{name,color,points:[{x,y}]}], targetY?, targetColor? }
// x 用點的索引順序，y 依所有 series 的值域自動縮放。
function lineChartSVG(opts) {
  const { width = 320, height = 140, series = [], targetY = null, targetColor = '#C62828' } = opts || {};
  const pad = 8;
  const allY = [];
  series.forEach(s => s.points.forEach(p => allY.push(p.y)));
  if (targetY != null) allY.push(targetY);
  if (allY.length === 0) return `<svg viewBox="0 0 ${width} ${height}" width="100%"></svg>`;
  let minY = Math.min(...allY), maxY = Math.max(...allY);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const maxLen = Math.max(...series.map(s => s.points.length), 1);
  const sx = (i) => pad + (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * (width - 2 * pad));
  const sy = (v) => pad + (1 - (v - minY) / (maxY - minY)) * (height - 2 * pad);
  const polylines = series.map(s => {
    const pts = s.points.map((p, i) => `${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts}"/>`;
  }).join('');
  const target = targetY != null
    ? `<line x1="${pad}" y1="${sy(targetY).toFixed(1)}" x2="${width - pad}" y2="${sy(targetY).toFixed(1)}" stroke="${targetColor}" stroke-width="1" stroke-dasharray="4 3"/>`
    : '';
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" preserveAspectRatio="none">${target}${polylines}</svg>`;
}

const api = { lineChartSVG };
if (typeof module !== 'undefined') { module.exports = api; }
if (typeof window !== 'undefined') { window.Chart = api; }
