import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKTEST_COMBINATION_COUNT, BACKTEST_WARMUP_BARS, areMaBacktestRowsEqual, buildMaSwingActions, isValidMaSwingExitPair, prepareMaBacktest, backtestMaSwing, searchMaSwing } from '../src/services/maSwingBacktest.js';
import { evaluateStrategyLibrary } from '../src/services/strategyEngines.js';
const rows = () => Array.from({ length: 1500 }, (_, i) => ({
  time: new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), open: 100 + i, close: 100 + i,
}));
const settings = { entry: 5, shortExit: null, longExit: null, abovePeriod: null, risingPeriod: null };
test('optimizer only compares MA5 through MA60', () => {
  assert.equal(BACKTEST_COMBINATION_COUNT, 4680);
  assert.equal(BACKTEST_WARMUP_BARS, 65);
  assert.equal(isValidMaSwingExitPair(5, 60), true);
  assert.equal(isValidMaSwingExitPair(60, 5), false);
  assert.equal(isValidMaSwingExitPair(null, 5), true);
  assert.equal(isValidMaSwingExitPair(60, null), true);
});
test('live array replacements do not invalidate unchanged closed-session backtests', () => {
  const previous = rows().slice(0, 80);
  const samePrices = previous.map(row => ({ ...row, volume: 999999 }));
  const changedClose = previous.map(row => ({ ...row }));
  changedClose.at(-1).close += 1;
  assert.equal(areMaBacktestRowsEqual(previous, samePrices), true);
  assert.equal(areMaBacktestRowsEqual(previous, changedClose), false);
  assert.equal(areMaBacktestRowsEqual(previous, previous.slice(1)), false);
});
test('next-open fill, equal sleeves, costs and final mark-to-market', () => {
  const input = rows().map(row => ({ ...row, open: 100, close: 100 }));
  const trigger = input.length - 15;
  for (let i = trigger; i < input.length; i += 1) {
    input[i].open = 101 + i - trigger;
    input[i].close = 101 + i - trigger;
  }
  const data = prepareMaBacktest(input);
  const result = backtestMaSwing(data, settings, 1);
  const expected = (input.at(-1).close / (input[trigger + 1].open * 1.001) - 1) * 100;
  assert.ok(Math.abs(result.returnPct - expected) < 1e-8);
  assert.equal(result.entries, 1);
  assert.equal(result.closedLegs, 0);
});
test('an entry condition inherited from before the window is not a new trade', () => {
  const result = backtestMaSwing(prepareMaBacktest(rows()), settings, 1);
  assert.equal(result.entries, 0);
  assert.equal(result.returnPct, 0);
});
test('backtest actions match the events shown by the chart strategy', () => {
  const input = rows().slice(0, 120).map(row => ({ ...row, high: row.close + 1, low: row.close - 1, volume: 1000 }));
  const actions = buildMaSwingActions(prepareMaBacktest(input), settings)
    .map(({ time, action }) => ({ time, action }));
  const chartEvents = evaluateStrategyLibrary(input, {
    strategySettings: { 'trend-ma-swing': settings },
  }).find(item => item.key === 'trend-ma-swing').events
    .map(({ time, action }) => ({ time, action }));
  assert.deepEqual(actions, chartEvents);
});
test('disabled entry stays in cash and insufficient warm-up is unavailable', () => {
  assert.equal(backtestMaSwing(prepareMaBacktest(rows()), { ...settings, entry: null }, 12).returnPct, 0);
  assert.equal(backtestMaSwing(prepareMaBacktest(rows().slice(-60)), settings, 1), null);
  assert.ok(backtestMaSwing(prepareMaBacktest(rows()), settings, 36));
});
test('invalid prices are rejected instead of producing misleading returns', () => {
  const input = rows(); input.at(-1).open = null;
  assert.equal(backtestMaSwing(prepareMaBacktest(input), settings, 1), null);
});
test('search supports cancellation without publishing a partial winner', async () => {
  let cancelled = false;
  const result = await searchMaSwing(prepareMaBacktest(rows()), 1, () => { cancelled = true; }, () => cancelled);
  assert.equal(result, null);
});
