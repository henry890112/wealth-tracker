import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPerformanceSort, sortPerformanceRows } from '../src/features/trends/performanceSort.js';

const rows = [
  { symbol: '7928', totalPnl: -12690, totalReturn: -0.38, realizedReturn: -0.38 },
  { symbol: 'TSLA', totalPnl: 12589, totalReturn: 0.19, realizedReturn: null },
  { symbol: '6291', totalPnl: -12876, totalReturn: -0.14, realizedReturn: null },
];

test('clicking a heading starts the appropriate sort and toggles direction', () => {
  assert.deepEqual(nextPerformanceSort(null, 'totalPnl'), { key: 'totalPnl', direction: 'desc' });
  assert.deepEqual(nextPerformanceSort({ key: 'totalPnl', direction: 'desc' }, 'totalPnl'), { key: 'totalPnl', direction: 'asc' });
  assert.deepEqual(nextPerformanceSort(null, 'symbol'), { key: 'symbol', direction: 'asc' });
  assert.deepEqual(nextPerformanceSort({ key: 'symbol', direction: 'asc' }, 'symbol'), { key: 'symbol', direction: 'desc' });
});

test('numeric sorting uses signed values and keeps unavailable rates last', () => {
  assert.deepEqual(sortPerformanceRows(rows, { key: 'totalPnl', direction: 'desc' }).map(row => row.symbol), ['TSLA', '7928', '6291']);
  assert.deepEqual(sortPerformanceRows(rows, { key: 'totalPnl', direction: 'asc' }).map(row => row.symbol), ['6291', '7928', 'TSLA']);
  assert.deepEqual(sortPerformanceRows(rows, { key: 'realizedReturn', direction: 'asc' }).map(row => row.symbol), ['7928', '6291', 'TSLA']);
  assert.deepEqual(sortPerformanceRows(rows, { key: 'realizedReturn', direction: 'desc' }).map(row => row.symbol), ['7928', '6291', 'TSLA']);
});

test('symbol sorting is numeric-aware and does not mutate the original rows', () => {
  const original = rows.map(row => row.symbol);
  assert.deepEqual(sortPerformanceRows(rows, { key: 'symbol', direction: 'asc' }).map(row => row.symbol), ['6291', '7928', 'TSLA']);
  assert.deepEqual(sortPerformanceRows(rows, null).map(row => row.symbol), original);
  assert.deepEqual(rows.map(row => row.symbol), original);
});

test('cost price sorting leaves closed or unavailable positions at the end', () => {
  const costRows = [
    { symbol: 'A', averageCostPrice: 120 },
    { symbol: 'B', averageCostPrice: null },
    { symbol: 'C', averageCostPrice: 85 },
  ];
  assert.deepEqual(sortPerformanceRows(costRows, { key: 'averageCostPrice', direction: 'asc' }).map(row => row.symbol), ['C', 'A', 'B']);
  assert.deepEqual(sortPerformanceRows(costRows, { key: 'averageCostPrice', direction: 'desc' }).map(row => row.symbol), ['A', 'C', 'B']);
});
