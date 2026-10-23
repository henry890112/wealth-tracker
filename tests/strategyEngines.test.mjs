import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPatternLifecycle,
  evaluateStrategyLibrary,
  PATTERN_CONFIRMED_MAX_AGE_BARS,
  PATTERN_WATCH_MAX_AGE_BARS,
} from '../src/services/strategyEngines.js';
import { STRATEGY_LIBRARY } from '../src/services/strategyLibrary.js';
import { buildTechnicalReplayInput, getTechnicalReplayDates } from '../src/services/technicalReplay.js';

const dateAt = index => {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  return date.toISOString().slice(0, 10);
};

const makeRows = (count = 140, mapper = null) => {
  let obv = 0;
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.12 + Math.sin(index / 5) * 2;
    const open = close - Math.sin(index / 3) * 0.6;
    const high = Math.max(open, close) + 1;
    const low = Math.min(open, close) - 1;
    const volume = 1_000_000 + (index % 7) * 35_000;
    obv += index === 0 || close >= (100 + (index - 1) * 0.12 + Math.sin((index - 1) / 5) * 2) ? volume : -volume;
    const row = {
      time: dateAt(index),
      open,
      high,
      low,
      close,
      volume,
      obv,
      cmf: Math.sin(index / 9) * 0.12,
      rsi: 50 + Math.sin(index / 8) * 12,
      rsi5: 50 + Math.sin(index / 5) * 18,
      rsi10: 50 + Math.sin(index / 7) * 14,
      k: 50 + Math.sin(index / 4) * 25,
      d: 50 + Math.sin((index - 1) / 4) * 22,
      macd: Math.sin(index / 8),
      macdSignal: Math.sin((index - 2) / 8) * 0.85,
      macdHistogram: Math.sin(index / 8) - Math.sin((index - 2) / 8) * 0.85,
      adx14: 22,
      ma20: close - 0.5,
      ma40: close - 0.9,
      ma60: close - 1.2,
      ma200: close - 2,
      ema20: close - 0.45,
      ema50: close - 1,
      atr14: 2.2,
    };
    return mapper ? mapper(row, index) : row;
  });
};

const byKey = (rows, context = {}) => Object.fromEntries(
  evaluateStrategyLibrary(rows, context).map(result => [result.key, result]),
);

test('all strategy library items have one computable result', () => {
  const results = evaluateStrategyLibrary(makeRows(), { symbol: 'TEST' });
  assert.equal(results.length, STRATEGY_LIBRARY.length);
  assert.equal(new Set(results.map(item => item.key)).size, STRATEGY_LIBRARY.length);
  results.forEach(result => {
    assert.ok(['confirmed', 'watch', 'none', 'unavailable'].includes(result.status));
    assert.ok(['bullish', 'bearish', 'neutral'].includes(result.direction));
    assert.equal(typeof result.reason, 'string');
    assert.doesNotMatch(result.reason, /^計算資料不足/);
  });
});

const makeMonthQuarterTrendRows = ({ bearish = false, flat = false } = {}) => makeRows(90, (row, index) => {
  const ma20 = bearish
    ? 125 - index * (flat ? 0 : 0.2)
    : 105 + index * (flat ? 0 : 0.2);
  const ma60 = bearish
    ? 135 - index * (flat ? 0 : 0.1)
    : 95 + index * (flat ? 0 : 0.1);
  return {
    ...row,
    ma20,
    ma60,
    close: bearish ? ma20 - 2 : ma20 + 2,
  };
});

test('month and quarter moving averages confirm an aligned bullish trend', () => {
  const result = byKey(makeMonthQuarterTrendRows())['trend-month-quarter-ma'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.ma20Direction, 'up');
  assert.equal(result.signal.ma60Direction, 'up');
  assert.match(result.reason, /多頭趨勢確認/);
});

test('month and quarter moving averages confirm an aligned bearish trend', () => {
  const result = byKey(makeMonthQuarterTrendRows({ bearish: true }))['trend-month-quarter-ma'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bearish');
  assert.equal(result.signal.ma20Direction, 'down');
  assert.equal(result.signal.ma60Direction, 'down');
  assert.match(result.reason, /空頭趨勢確認/);
});

test('month and quarter moving averages do not confirm flat lines', () => {
  const result = byKey(makeMonthQuarterTrendRows({ flat: true }))['trend-month-quarter-ma'];
  assert.equal(result.status, 'watch');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.ma20Direction, 'flat');
  assert.equal(result.signal.ma60Direction, 'flat');
  assert.match(result.reason, /暫列偏多觀察/);
});

const makeMarketStructureRows = ({ bearish = false, breakStructure = false } = {}) => {
  const rows = makeRows(50, (row, index) => ({
    ...row,
    open: 105,
    high: 106,
    low: 104,
    close: 105,
    atr14: 2,
  }));
  if (bearish) {
    rows[12] = { ...rows[12], open: 113, high: 115, low: 112, close: 114 };
    rows[18] = { ...rows[18], open: 101, high: 102, low: 98, close: 99 };
    rows[26] = { ...rows[26], open: 107, high: 110, low: 106, close: 108 };
    rows[34] = { ...rows[34], open: 94, high: 95, low: 90, close: 92 };
    rows.at(-1).close = breakStructure ? 112 : 96;
    rows.at(-1).high = Math.max(rows.at(-1).high, rows.at(-1).close + 1);
  } else {
    rows[12] = { ...rows[12], open: 108, high: 110, low: 107, close: 109 };
    rows[18] = { ...rows[18], open: 94, high: 96, low: 92, close: 94 };
    rows[26] = { ...rows[26], open: 116, high: 120, low: 115, close: 118 };
    rows[34] = { ...rows[34], open: 101, high: 103, low: 100, close: 102 };
    rows.at(-1).close = breakStructure ? 97 : 110;
    rows.at(-1).low = Math.min(rows.at(-1).low, rows.at(-1).close - 1);
  }
  return rows;
};

test('market structure confirms higher highs and higher lows from completed pivots', () => {
  const result = byKey(makeMarketStructureRows())['trend-market-structure'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.structureLabel, 'HH／HL');
  assert.deepEqual(result.signal.pivotSequence.map(item => item.kind), ['high', 'low', 'high', 'low']);
  assert.equal(result.overlay.series[0].role, 'marketStructureConfirmed');
  assert.equal(result.overlay.series[1].role, 'marketStructureCandidate');
  assert.equal(result.signal.candidatePivotKind, 'high');
  assert.equal(result.signal.candidateBarsRemaining, 3);
  assert.match(result.reason, /頭頭高、底底高/);
  assert.match(result.reason, /按時間交錯/);
});

test('market structure does not confirm independently grouped highs and lows that never alternate', () => {
  const rows = makeRows(50, row => ({
    ...row,
    open: 105,
    high: 106,
    low: 104,
    close: 105,
    atr14: 2,
  }));
  rows[8] = { ...rows[8], open: 93, high: 95, low: 90, close: 92 };
  rows[14] = { ...rows[14], open: 98, high: 100, low: 95, close: 97 };
  rows[22] = { ...rows[22], open: 108, high: 110, low: 107, close: 109 };
  rows[30] = { ...rows[30], open: 118, high: 120, low: 117, close: 119 };

  const result = byKey(rows)['trend-market-structure'];

  assert.equal(result.status, 'unavailable');
  assert.equal(result.direction, 'neutral');
  assert.match(result.reason, /依時間交錯/);
});

test('market structure confirms lower highs and lower lows from completed pivots', () => {
  const result = byKey(makeMarketStructureRows({ bearish: true }))['trend-market-structure'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bearish');
  assert.equal(result.signal.structureLabel, 'LH／LL');
  assert.match(result.reason, /頭頭低、底底低/);
});

test('market structure downgrades after the latest close breaks its structural invalidation', () => {
  const result = byKey(makeMarketStructureRows({ breakStructure: true }))['trend-market-structure'];
  assert.equal(result.status, 'watch');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.structureBroken, true);
  assert.equal(result.signal.stop, null);
  assert.match(result.reason, /多頭結構已跌破/);
});

test('incomplete market structure stays uncluttered without marker, stop, or target', () => {
  const rows = makeMarketStructureRows();
  rows[34] = { ...rows[34], open: 95, high: 97, low: 92.05, close: 95 };
  const result = byKey(rows)['trend-market-structure'];
  assert.equal(result.status, 'watch');
  assert.equal(result.signal.structureLabel, 'HH／待確認');
  assert.equal(result.signal.plotMarker, false);
  assert.equal(result.signal.stop, null);
  assert.equal(result.signal.target, null);
  assert.equal(result.overlay.priceLines.length, 2);
});

test('the newest unfinished candle cannot become a confirmed market-structure pivot', () => {
  const rows = makeMarketStructureRows();
  rows.at(-1).high = 150;
  const result = byKey(rows)['trend-market-structure'];
  assert.equal(result.signal.latestHigh, 120);
  assert.equal(result.signal.structureLabel, 'HH／HL');
});

test('conflicting higher-high and lower-low structure stays neutral without a misleading arrow', () => {
  const rows = makeMarketStructureRows();
  rows[34] = { ...rows[34], open: 91, high: 93, low: 88, close: 90 };
  const result = byKey(rows)['trend-market-structure'];
  assert.equal(result.status, 'watch');
  assert.equal(result.direction, 'neutral');
  assert.equal(result.signal.structureLabel, 'HH／LL');
  assert.equal(result.signal.plotMarker, false);
});

test('a FVG created by the newest candle cannot confirm on that same candle', () => {
  const rows = makeRows(90, (row, index) => ({
    ...row,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000,
  }));
  rows.at(-1).open = 104;
  rows.at(-1).low = 103;
  rows.at(-1).high = 106;
  rows.at(-1).close = 105;
  const result = byKey(rows)['price-fvg-retest'];
  assert.notEqual(result.status, 'confirmed');
});

test('an Order Block disappears after a later close crosses its fixed invalidation price', () => {
  const rows = makeRows(40, row => ({
    ...row,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr14: 2,
  }));
  rows[30] = { ...rows[30], open: 102, high: 102, low: 99, close: 100 };
  rows[31] = { ...rows[31], open: 100, high: 106, low: 100, close: 105 };
  rows[32] = { ...rows[32], open: 101, high: 104, low: 100, close: 103 };
  rows[39] = { ...rows[39], open: 100, high: 100, low: 97, close: 98 };

  const result = byKey(rows)['price-order-block'];

  assert.equal(result.status, 'none');
  assert.equal(result.lifecycle.state, 'invalidated');
  assert.deepEqual(result.overlay, { priceLines: [], series: [], regions: [] });
  assert.match(result.reason, /收盤.*跌破.*失效價/);
});

test('an active Order Block uses concise markers and a fixed formation ATR stop', () => {
  const rows = makeRows(36, row => ({
    ...row,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    atr14: 2,
  }));
  rows[30] = { ...rows[30], open: 102, high: 102, low: 99, close: 100 };
  rows[31] = { ...rows[31], open: 100, high: 106, low: 100, close: 105 };
  rows[32] = { ...rows[32], open: 101, high: 104, low: 100, close: 103 };

  const result = byKey(rows)['price-order-block'];
  const extendedRows = [
    ...rows,
    { ...rows.at(-1), time: dateAt(36), open: 103, high: 110, low: 100, close: 103 },
  ];
  const extendedResult = byKey(extendedRows)['price-order-block'];

  assert.equal(result.status, 'confirmed');
  assert.equal(result.signal.text, 'OB 回踩確認');
  assert.equal(extendedResult.signal.stop, result.signal.stop);
  assert.equal(result.overlay.regions[0].label, 'OB 區域');
});

test('an expired Order Block no longer leaves stale price lines or regions on the chart', () => {
  const rows = makeRows(60, row => ({
    ...row,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
  }));
  rows[30] = { ...rows[30], open: 102, high: 102, low: 99, close: 100 };
  rows[31] = { ...rows[31], open: 100, high: 106, low: 100, close: 105 };
  rows[32] = { ...rows[32], open: 101, high: 104, low: 100, close: 103 };

  const result = byKey(rows)['price-order-block'];

  assert.equal(result.status, 'none');
  assert.equal(result.lifecycle.state, 'expired');
  assert.deepEqual(result.overlay, { priceLines: [], series: [], regions: [] });
});

test('MFI and CMF disagreement never becomes a confirmed money-flow signal', () => {
  const rows = makeRows(90, (row, index) => {
    const close = 100 + index;
    return {
      ...row,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      cmf: -0.2,
    };
  });
  const result = byKey(rows)['volume-mfi-cmf'];
  assert.equal(result.status, 'none');
  assert.equal(result.direction, 'neutral');
});

test('MFI and CMF divergences are independent strategies instead of one duplicated resonance strategy', () => {
  const keys = STRATEGY_LIBRARY.map(item => item.key);
  assert.ok(keys.includes('volume-mfi-divergence'));
  assert.ok(keys.includes('volume-cmf-divergence'));
  assert.equal(keys.filter(key => key.includes('resonance') || key.includes('共振')).length, 0);
});

test('CMF bullish divergence needs a later price confirmation before it confirms', () => {
  const rows = makeRows(100, row => ({ ...row, open: 100, high: 101, low: 99, close: 100, cmf: 0 }));
  rows[75] = { ...rows[75], low: 90, cmf: -0.22 };
  rows[85] = { ...rows[85], low: 85, cmf: -0.10 };
  let result = byKey(rows.slice(0, 89))['volume-cmf-divergence'];
  assert.equal(result.status, 'watch');
  assert.equal(result.direction, 'bullish');
  rows[89] = { ...rows[89], open: 100, low: 100, high: 103, close: 102, cmf: -0.06 };
  rows[90] = { ...rows[90], open: 102, low: 101, high: 103, close: 102, cmf: -0.04 };
  result = byKey(rows.slice(0, 91))['volume-cmf-divergence'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.indicatorName, 'CMF');
  assert.equal(result.signal.resonance, false);
});

test('MFI bullish divergence is calculated independently from CMF', () => {
  const rows = makeRows(100, row => ({ ...row, open: 100, high: 101, low: 99, close: 100, cmf: 0 }));
  for (let index = 62; index < 75; index += 1) {
    const close = 110 - (index - 62);
    rows[index] = { ...rows[index], open: close + 0.5, high: close + 1, low: close - 1, close };
  }
  rows[75] = { ...rows[75], open: 96, high: 97, low: 90, close: 95 };
  for (let index = 76; index < 85; index += 1) {
    const close = 96 + (index - 76);
    rows[index] = { ...rows[index], open: close - 0.5, high: close + 1, low: close - 1, close };
  }
  rows[85] = { ...rows[85], open: 104, high: 106, low: 85, close: 105 };
  rows[89] = { ...rows[89], open: 105, high: 108, low: 104, close: 107 };
  rows[90] = { ...rows[90], open: 107, high: 108, low: 106, close: 107 };
  const result = byKey(rows.slice(0, 91))['volume-mfi-divergence'];
  assert.equal(result.status, 'confirmed');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.indicatorName, 'MFI');
  assert.equal(result.signal.resonance, false);
});

test('confirmed MFI divergence downgrades to watch after the latest close falls back below confirmation', () => {
  const rows = makeRows(100, row => ({ ...row, open: 100, high: 101, low: 99, close: 100, cmf: 0 }));
  for (let index = 62; index < 75; index += 1) {
    const close = 110 - (index - 62);
    rows[index] = { ...rows[index], open: close + 0.5, high: close + 1, low: close - 1, close };
  }
  rows[75] = { ...rows[75], open: 96, high: 97, low: 90, close: 95 };
  for (let index = 76; index < 85; index += 1) {
    const close = 96 + (index - 76);
    rows[index] = { ...rows[index], open: close - 0.5, high: close + 1, low: close - 1, close };
  }
  rows[85] = { ...rows[85], open: 104, high: 106, low: 85, close: 105 };
  rows[89] = { ...rows[89], open: 105, high: 108, low: 104, close: 107 };
  rows[90] = { ...rows[90], open: 101, high: 102, low: 99, close: 100 };
  const result = byKey(rows.slice(0, 91))['volume-mfi-divergence'];
  assert.equal(result.status, 'watch');
  assert.equal(result.direction, 'bullish');
  assert.equal(result.signal.confirmationLost, true);
  assert.match(result.reason, /跌回確認線|降為觀察/);
});

test('pairs strategy requires an explicitly selected comparison asset', () => {
  const rows = makeRows();
  const result = byKey(rows, { benchmarkRows: makeRows(), symbol: 'TEST' })['stats-pairs'];
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /比較標的|第二資產/);
});

test('momentum ranking requires at least two comparison assets', () => {
  const rows = makeRows();
  const context = { symbol: 'TEST', comparisonRows: [{ symbol: 'ONE', rows: makeRows() }] };
  const result = byKey(rows, context)['stats-momentum-ranking'];
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /兩個/);
});

test('historical replay removes future rows from nested comparison and pair series', () => {
  const rows = makeRows(100);
  const cutoff = rows[79].time;
  const replay = buildTechnicalReplayInput(rows, {
    pairRows: makeRows(100),
    comparisonRows: [{ symbol: 'PEER', name: 'Peer', rows: makeRows(100) }],
  }, cutoff);
  assert.equal(replay.rows.at(-1).time, cutoff);
  assert.equal(replay.context.pairRows.at(-1).time, cutoff);
  assert.equal(replay.context.comparisonRows[0].rows.at(-1).time, cutoff);
  assert.equal(replay.context.comparisonRows[0].symbol, 'PEER');
});

test('historical replay exposes at most the latest 30 trading dates', () => {
  const rows = makeRows(100);
  const dates = getTechnicalReplayDates(rows, 100, 60);
  assert.equal(dates.length, 30);
  assert.equal(dates[0], rows[70].time);
  assert.equal(dates.at(-1), rows.at(-1).time);
});

test('renamed approximations disclose what they actually calculate', () => {
  const labels = Object.fromEntries(STRATEGY_LIBRARY.map(item => [item.key, item.label]));
  assert.match(labels['volume-vwap'], /20 日滾動/);
  assert.match(labels['volume-profile'], /估算/);
  assert.match(labels['volume-wyckoff'], /簡化/);
  assert.match(labels['stats-momentum-ranking'], /比較標的/);
});

const patternDef = { key: 'pattern-head-shoulders', label: '頭肩底／頭肩頂', category: '形態策略' };
const patternResult = (rows, eventIndex, status = 'confirmed', overrides = {}) => {
  const event = {
    time: rows[eventIndex].time,
    type: 'bullish',
    status,
    stop: 80,
    target: 200,
    ...overrides,
  };
  return {
    key: patternDef.key,
    label: patternDef.label,
    category: patternDef.category,
    status,
    direction: event.type,
    reason: '測試型態',
    signal: event,
    latestEvent: event,
    events: [event],
    overlay: { priceLines: [{ price: 100 }], series: [{ name: 'old' }], regions: [] },
  };
};

test('old pattern confirmations expire and remove chart overlays', () => {
  const rows = makeRows(80);
  const eventIndex = rows.length - PATTERN_CONFIRMED_MAX_AGE_BARS - 2;
  const result = applyPatternLifecycle(patternDef, patternResult(rows, eventIndex), rows);
  assert.equal(result.status, 'none');
  assert.equal(result.patternExpired, true);
  assert.deepEqual(result.overlay, { priceLines: [], series: [], regions: [] });
  assert.match(result.reason, /超過.*有效期限/);
});

test('old watch patterns expire sooner than confirmed patterns', () => {
  const rows = makeRows(80);
  const eventIndex = rows.length - PATTERN_WATCH_MAX_AGE_BARS - 2;
  const result = applyPatternLifecycle(patternDef, patternResult(rows, eventIndex, 'watch'), rows);
  assert.equal(result.status, 'none');
  assert.equal(result.lifecycle.maxAgeBars, PATTERN_WATCH_MAX_AGE_BARS);
});

test('recent active patterns expose their remaining validity window', () => {
  const rows = makeRows(80);
  const eventIndex = rows.length - 4;
  const result = applyPatternLifecycle(patternDef, patternResult(rows, eventIndex), rows);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.lifecycle.barsSinceSignal, 3);
  assert.equal(result.lifecycle.remainingBars, PATTERN_CONFIRMED_MAX_AGE_BARS - 3);
  assert.equal(result.signal.lifecycle.state, 'active');
});

test('pattern is removed after a later close crosses its structural stop', () => {
  const rows = makeRows(80);
  const eventIndex = rows.length - 4;
  rows[eventIndex + 1] = { ...rows[eventIndex + 1], close: 79 };
  const result = applyPatternLifecycle(patternDef, patternResult(rows, eventIndex), rows);
  assert.equal(result.status, 'none');
  assert.equal(result.lifecycle.state, 'invalidated');
  assert.match(result.reason, /結構失效價/);
});
