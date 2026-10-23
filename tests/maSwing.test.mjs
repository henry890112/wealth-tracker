import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStrategyLibrary, normalizeMaSwingSettings } from '../src/services/strategyEngines.js';

const rowsFor = closes => closes.map((close, i) => ({
  time: new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10),
  close, open: close, high: close + 1, low: close - 1, volume: 1000,
}));
const evaluate = (rows, settings = {}, context = {}) => evaluateStrategyLibrary(rows, {
  ...context, strategySettings: { 'trend-ma-swing': settings },
}).find(item => item.key === 'trend-ma-swing');
const history = () => rowsFor([
  ...Array.from({ length: 90 }, (_, i) => 100 + i),
  175, 174, 200, 205, 210, 180, 100, 95,
]);

test('defaults and invalid selections are normalized', () => {
  assert.deepEqual(normalizeMaSwingSettings(null), { entry: 20, shortExit: 10, longExit: 60, abovePeriod: 60, risingPeriod: 60 });
  assert.deepEqual(normalizeMaSwingSettings({ entry: '40', shortExit: -1, longExit: 200 }), { entry: 40, shortExit: 10, longExit: 60, abovePeriod: 60, risingPeriod: 60 });
  assert.deepEqual(normalizeMaSwingSettings({ entry: 120, abovePeriod: 200, risingPeriod: 120 }), { entry: 60, shortExit: 10, longExit: 60, abovePeriod: 60, risingPeriod: 60 });
  assert.deepEqual(normalizeMaSwingSettings({ entry: null, shortExit: null, longExit: null, abovePeriod: 20, risingPeriod: null }), { entry: null, shortExit: null, longExit: null, abovePeriod: 20, risingPeriod: null });
  assert.deepEqual(normalizeMaSwingSettings({ requireAboveMa60: false, requireRisingMa60: true }), { entry: 20, shortExit: 10, longExit: 60, abovePeriod: null, risingPeriod: 60 });
  assert.deepEqual(normalizeMaSwingSettings({ shortExit: 60, longExit: 5 }), { entry: 20, shortExit: 5, longExit: 60, abovePeriod: 60, risingPeriod: 60 });
});
test('trend filters can select independent moving-average periods', () => {
  const defaultResult = evaluate(history());
  const customResult = evaluate(history(), { abovePeriod: 20, risingPeriod: 40 });
  const noAboveFilter = evaluate(history(), { abovePeriod: null, risingPeriod: 60 });
  const noSlopeFilter = evaluate(history(), { abovePeriod: 60, risingPeriod: null });
  const noMaFilters = evaluate(history(), { abovePeriod: null, risingPeriod: null });
  assert.match(defaultResult.reason, /收盤站上 MA60/);
  assert.match(defaultResult.reason, /MA60 近 5 日上揚/);
  assert.match(customResult.reason, /收盤站上 MA20/);
  assert.match(customResult.reason, /MA40 近 5 日上揚/);
  assert.match(noAboveFilter.reason, /不限制收盤與均線/);
  assert.match(noAboveFilter.reason, /MA60 近 5 日上揚/);
  assert.match(noSlopeFilter.reason, /收盤站上 MA60/);
  assert.match(noSlopeFilter.reason, /不限制均線斜率/);
  assert.match(noMaFilters.reason, /不限制收盤與均線/);
  assert.match(noMaFilters.reason, /不限制均線斜率/);
});
test('exit moving averages do not silently block a valid entry', () => {
  const rows = rowsFor([
    ...Array.from({ length: 20 }, () => 100),
    50, 48, 47, 49, 52,
  ]);
  const result = evaluate(rows, { entry: 5, shortExit: null, longExit: 20, abovePeriod: null, risingPeriod: null });
  assert.deepEqual(result.events.map(event => event.action), ['entry']);
  assert.match(result.reason, /收盤站上 MA5/);
  assert.match(result.reason, /出場均線只用於出場/);
});
test('entry fires when the price is already above the entry MA as the filters become ready', () => {
  const rows = rowsFor([
    150, 150, 150, 150, 150,
    100, 100, 100, 100, 100,
    110, 112, 114, 116, 118, 120,
  ]);
  const result = evaluate(rows, { entry: 5, shortExit: null, longExit: null, abovePeriod: null, risingPeriod: 5 });
  assert.deepEqual(result.events.map(event => event.action), ['entry']);
  assert.equal(result.events[0].time, rows[13].time);
  assert.match(result.events[0].text, /進場 MA5/);
});
test('entry and separate short/long exits require an earlier simulated entry', () => {
  const result = evaluate(history());
  assert.deepEqual(result.events.map(event => event.action), ['entry', 'shortExit', 'entry', 'shortExit', 'longExit']);
  assert.equal(result.longHeld, false);
  assert.equal(result.status, 'none'); // historical exit is not a fresh signal forever
  assert.match(result.events[0].text, /MA20/);
});
test('settings update overlay values and remove obsolete events', () => {
  const rows = history();
  const initial = evaluate(rows);
  const changed = evaluate(rows, { entry: 60, shortExit: 20, longExit: 40 });
  assert.notDeepEqual(changed.events, initial.events);
  assert.deepEqual(changed.overlay.series.map(series => series.name), ['進場 MA60', '第一段出場 MA20', '全部出場 MA40']);
  assert.equal(changed.overlay.series[0].points.at(-1).value,
    rows.slice(-60).reduce((sum, row) => sum + row.close, 0) / 60);
});
test('disabled entry line does not create signals or an entry overlay', () => {
  const result = evaluate(history(), { entry: null, shortExit: null, longExit: null });
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.overlay.series, []);
  assert.match(result.reason, /進場線未啟用/);
});
test('disabled exit lines remain optional and are omitted from overlays', () => {
  const result = evaluate(history(), { shortExit: null, longExit: null });
  assert.deepEqual(result.events.map(event => event.action), ['entry']);
  assert.equal(result.longHeld, true);
  assert.deepEqual(result.overlay.series.map(series => series.name), ['進場 MA20']);
  assert.match(result.reason, /第一段出場未啟用/);
  assert.match(result.reason, /全部出場未啟用/);
});
test('long exit wins on simultaneous crossings', () => {
  const rows = history().slice(0, 95);
  rows.push({ ...history()[96], close: 90 });
  const result = evaluate(rows);
  assert.equal(result.events.at(-1).action, 'longExit');
  assert.equal(result.events.filter(event => event.time === rows.at(-1).time).length, 1);
});
test('intraday entry is pending and does not create a simulated position', () => {
  const rows = rowsFor([
    150, 150, 150, 150, 150,
    100, 100, 100, 100, 100,
    110, 112, 114, 116,
  ]);
  const result = evaluate(rows, { entry: 5, shortExit: null, longExit: null, abovePeriod: null, risingPeriod: 5 }, { isIntraday: true });
  assert.equal(result.status, 'watch');
  assert.match(result.signal.text, /待收盤/);
  assert.equal(result.longHeld, false);
});
test('insufficient or missing data does not throw or create an entry', () => {
  assert.equal(evaluate(history().slice(0, 20), { entry: 60 }).status, 'unavailable');
  const rows = history();
  rows.at(-1).close = null;
  assert.equal(evaluate(rows).status, 'unavailable');
});
test('history replay only contains events available in that prefix', () => {
  const rows = history();
  const full = evaluate(rows);
  for (let end = 90; end < rows.length; end += 1) {
    const prefix = evaluate(rows.slice(0, end));
    assert.deepEqual(prefix.events, full.events.filter(event => event.time <= rows[end - 1].time));
  }
});

test('short chart ranges retain full-history moving averages and position state', () => {
  const rows = history();
  const visible = rows.slice(-3);
  const result = evaluateStrategyLibrary(visible, {}, { fullHistoryRows: rows })
    .find(item => item.key === 'trend-ma-swing');
  const full = evaluate(rows);
  assert.equal(result.status, full.status);
  assert.equal(result.longHeld, full.longHeld);
  assert.deepEqual(result.events, full.events.filter(event => event.time >= visible[0].time));
  assert.equal(result.overlay.series[0].points.length, 3);
  assert.equal(result.overlay.series[0].points.at(-1).value, full.overlay.series[0].points.at(-1).value);
});
