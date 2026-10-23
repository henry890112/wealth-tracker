import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateIntradayDailyRows,
  hasCompleteDailyOhlc,
  mergeIntradayDailyRows,
} from '../supabase/functions/market-history/intradayFallback.mjs';

function chartBars(date, count = 78, start = '13:30:00.000Z') {
  const firstTimestamp = Date.parse(`${date}T${start}`) / 1000;
  const timestamps = Array.from({ length: count }, (_, index) => firstTimestamp + index * 300);
  const quote = {
    open: timestamps.map((_, index) => index === 0 ? 100 : 100 + index / 10),
    high: timestamps.map((_, index) => index === 20 ? 120 : 101 + index / 10),
    low: timestamps.map((_, index) => index === 30 ? 90 : 99 + index / 10),
    close: timestamps.map((_, index) => 100 + (index + 1) / 10),
    volume: timestamps.map(() => 10),
  };
  return { timestamps, quote };
}

function yahooChart(days) {
  const bars = days.map(([date, count, start]) => chartBars(date, count, start));
  return {
    meta: { exchangeTimezoneName: 'America/New_York' },
    timestamp: bars.flatMap(({ timestamps }) => timestamps),
    indicators: {
      quote: [Object.fromEntries(['open', 'high', 'low', 'close', 'volume'].map((field) => [
        field,
        bars.flatMap(({ quote }) => quote[field]),
      ]))],
    },
  };
}

test('aggregates complete US regular-session candles using exchange-local dates', () => {
  const rows = aggregateIntradayDailyRows(yahooChart([
    ['2026-10-21', 78],
    ['2026-10-22', 78],
  ]), {
    targetDates: ['2026-10-21', '2026-10-22'],
    todayDate: '2026-10-23',
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    time: '2026-10-21', open: 100, high: 120, low: 90, close: 107.8, volume: 780,
  });
  assert.equal(rows[1].time, '2026-10-22');
});

test('does not create candles for partial sessions, current day, or non-target dates', () => {
  const rows = aggregateIntradayDailyRows(yahooChart([
    ['2026-10-21', 24],
    ['2026-10-22', 78],
  ]), {
    targetDates: ['2026-10-21'],
    todayDate: '2026-10-22',
  });
  assert.deepEqual(rows, []);
});

test('rejects an otherwise full session with a multi-bar data gap', () => {
  const result = yahooChart([['2026-10-21', 78]]);
  result.timestamp.splice(30, 3);
  for (const values of Object.values(result.indicators.quote[0])) values.splice(30, 3);

  assert.deepEqual(aggregateIntradayDailyRows(result, {
    targetDates: ['2026-10-21'],
    todayDate: '2026-10-23',
  }), []);
});

test('replaces only incomplete requested daily rows and preserves valid daily data', () => {
  const existing = [
    { time: '2026-10-20', open: 80, high: 90, low: 79, close: 88, volume: 100 },
    { time: '2026-10-21', open: 0, high: 0, low: 0, close: 0, volume: 0 },
  ];
  const fallback = [{ time: '2026-10-21', open: 100, high: 120, low: 90, close: 107.8, volume: 780 }];
  const rows = mergeIntradayDailyRows(existing, fallback, ['2026-10-21']);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].time, '2026-10-20');
  assert.equal(rows[1].time, '2026-10-21');
  assert.equal(hasCompleteDailyOhlc(rows[1]), true);
  assert.equal(mergeIntradayDailyRows(existing, [], ['2026-10-21']).length, 1);
});
