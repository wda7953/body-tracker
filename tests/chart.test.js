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
