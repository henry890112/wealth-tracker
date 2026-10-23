import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPriceGapEvents } from '../src/services/priceGaps.js';

const bar = (time, low, high, open = low, close = high) => ({ time, low, high, open, close });

test('detects only complete non-overlap between adjacent candle ranges', () => {
  const rows = [bar('2026-10-20', 98, 100), bar('2026-10-21', 103, 106), bar('2026-10-22', 101, 104)];
  assert.deepEqual(detectPriceGapEvents(rows), [
    { startTime: '2026-10-21', startIndex: 1, lower: 100, upper: 103, direction: 'up', filledIndex: null },
  ]);
});

test('records the candle that fully filled a gap for historical viewport rendering', () => {
  const rows = [bar('2026-10-20', 100, 103), bar('2026-10-21', 94, 98), bar('2026-10-22', 96, 99), bar('2026-10-23', 96, 100)];
  assert.deepEqual(detectPriceGapEvents(rows), [
    { startTime: '2026-10-21', startIndex: 1, lower: 98, upper: 100, direction: 'down', filledIndex: 3 },
  ]);
});

test('does not confuse opening price gaps or three-bar FVGs with full candle gaps', () => {
  const rows = [
    bar('2026-10-20', 96, 100, 98, 99),
    bar('2026-10-21', 98, 105, 103, 104),
    bar('2026-10-22', 102, 108, 106, 107),
  ];
  assert.deepEqual(detectPriceGapEvents(rows), []);
});

test('ignores small gaps and malformed ranges', () => {
  const rows = [bar('2026-10-20', 99, 100), bar('2026-10-21', 100.1, 103), bar('2026-10-22', 0, 0)];
  assert.deepEqual(detectPriceGapEvents(rows), []);
});

test('AVGO August sequence produces the August 18 range gap only', () => {
  const rows = [
    bar('2026-08-13', 391.31, 402.15),
    bar('2026-08-14', 385.78, 397.2),
    bar('2026-08-17', 391.31, 407.4),
    bar('2026-08-18', 369.2, 385.78),
  ];
  assert.deepEqual(detectPriceGapEvents(rows), [
    { startTime: '2026-08-18', startIndex: 3, lower: 385.78, upper: 391.31, direction: 'down', filledIndex: null },
  ]);
});
