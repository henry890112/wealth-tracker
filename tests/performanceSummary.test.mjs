import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeVisiblePerformanceRows } from '../src/features/trends/performanceSummary.js';

const rows = [
  { market: 'TW', symbol: '7928', realizedCost: 100, realizedPnl: -20, openCost: 0, unrealizedPnl: 0 },
  { market: 'TW', symbol: '5347', realizedCost: 0, realizedPnl: 0, openCost: 200, unrealizedPnl: 30 },
  { market: 'US', symbol: 'GOOGL', realizedCost: 40, realizedPnl: 10, openCost: 60, unrealizedPnl: -15 },
];

test('visible market rows drive total, realized and unrealized summary together', () => {
  const all = summarizeVisiblePerformanceRows(rows);
  const tw = summarizeVisiblePerformanceRows(rows.filter(row => row.market === 'TW'));
  assert.equal(all.totalPnl, 5);
  assert.equal(tw.totalPnl, 10);
  assert.equal(tw.totalCost, 300);
  assert.equal(tw.realizedPnl, -20);
  assert.equal(tw.unrealizedPnl, 30);
  assert.equal(tw.totalReturn, 10 / 300);
  assert.equal(tw.realizedReturn, -0.2);
  assert.equal(tw.unrealizedReturn, 0.15);
});

test('search or position subsets use only shown rows and do not invent missing cost returns', () => {
  const closed = summarizeVisiblePerformanceRows(rows.filter(row => row.symbol === '7928'));
  assert.equal(closed.totalPnl, -20);
  assert.equal(closed.unrealizedReturn, null);
  const empty = summarizeVisiblePerformanceRows([]);
  assert.equal(empty.totalPnl, 0);
  assert.equal(empty.totalReturn, null);
});
