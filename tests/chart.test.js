// body-tracker/tests/chart.test.js
const test = require('node:test');
const assert = require('node:assert');
const { lineChartSVG } = require('../js/chart.js');

test('產生含 polyline 的 SVG 字串', () => {
  const svg = lineChartSVG({
    width: 300, height: 120,
    series: [
      { name: 'raw', color: '#bbb', points: [{ x: 0, y: 60 }, { x: 1, y: 61 }] },
      { name: 'ma', color: '#7A5C3E', points: [{ x: 0, y: 60 }, { x: 1, y: 60.5 }] },
    ],
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /polyline/);
});

test('空資料不報錯', () => {
  const svg = lineChartSVG({ width: 300, height: 120, series: [] });
  assert.match(svg, /<svg/);
});

test('所有 y 值相同（平線）也能產生有效 SVG，不出現 NaN', () => {
  const svg = lineChartSVG({
    width: 300, height: 120,
    series: [{ name: 'raw', color: '#bbb', points: [{ x: 0, y: 60 }, { x: 1, y: 60 }, { x: 2, y: 60 }] }],
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /polyline/);
  assert.doesNotMatch(svg, /NaN/);
});

test('非 finite 的 y 值不會拖累其他點的縮放（min/max 只採 finite 值）', () => {
  const svg = lineChartSVG({
    width: 300, height: 120,
    series: [{ name: 'raw', color: '#bbb', points: [{ x: 0, y: 60 }, { x: 1, y: NaN }, { x: 2, y: 62 }] }],
  });
  assert.match(svg, /<svg/);
  const m = svg.match(/points="([^"]+)"/);
  const pts = m[1].split(' ');
  // 好的資料點（第一、三點）換算後座標必須是有效數字，不能因為中間夾雜 NaN 而整條線報廢
  assert.ok(Number.isFinite(parseFloat(pts[0].split(',')[1])));
  assert.ok(Number.isFinite(parseFloat(pts[2].split(',')[1])));
});
