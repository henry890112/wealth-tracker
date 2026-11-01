import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PNL_METRICS,
  buildTradePnlViews,
  filterTradePnlSeries,
  signedPnlAmount,
} from '../src/features/trends/tradePnl.js';

const points = [
  { date: '2026-10-01', realizedPnl: 0, unrealizedPnl: 10, totalPnl: 10, totalCost: 100 },
  { date: '2026-10-02', realizedPnl: 5, unrealizedPnl: 8, totalPnl: 13, totalCost: 100 },
  { date: '2026-10-05', realizedPnl: 3, unrealizedPnl: 6, totalPnl: 9, totalCost: 110 },
];

test('daily realized, unrealized and total changes stay aligned with the chart series', () => {
  const { daily, series } = buildTradePnlViews([...points].reverse());
  assert.deepEqual(series.map(point => point.date), points.map(point => point.date));
  assert.equal(daily['2026-10-02'].realizedDiff, 5);
  assert.equal(daily['2026-10-02'].unrealizedDiff, -2);
  assert.equal(daily['2026-10-02'].totalDiff, 3);
  assert.equal(daily['2026-10-05'].totalDiff, -4);
  assert.equal(daily['2026-10-05'].totalPct, -4);
  assert.equal(PNL_METRICS.find(metric => metric.key === 'total').changeKey, 'totalDiff');
});

test('date range filter selects chart points without mutating the source', () => {
  const series = buildTradePnlViews(points).series;
  assert.deepEqual(filterTradePnlSeries(series, { days: 'ALL' }, { start: '2026-10-02', end: '2026-10-05' }).map(point => point.date), ['2026-10-02', '2026-10-05']);
  assert.equal(series.length, 3);
  assert.equal(signedPnlAmount(-4), '−4');
});
