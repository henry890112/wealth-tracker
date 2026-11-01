import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTechnicalData, supportResistanceTouchSignal } from '../supabase/functions/signal-notifications/technicalAnalysis.shared.js';
import { NOTIFICATION_STRATEGY_KEYS } from '../src/services/strategyOptions.js';

const history = () => Array.from({ length: 80 }, (_, index) => ({
  time: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  open: 100,
  high: index === 44 || index === 54 ? 110 : 102,
  low: index === 40 || index === 48 ? 95 : 98,
  close: 100,
  volume: 1000,
}));

test('near known support yields a bullish observation, not a confirmed entry', () => {
  const rows = history();
  rows.at(-1).close = 95;
  const signals = supportResistanceTouchSignal(rows);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].key, 'price-sr-touch');
  assert.equal(signals[0].direction, 'bullish');
  assert.equal(signals[0].status, 'watch');
  assert.match(signals[0].reason, /支撐區/);
});

test('near known resistance yields a bearish observation', () => {
  const rows = history();
  rows.at(-1).close = 110;
  rows.at(-1).high = 112;
  const signals = supportResistanceTouchSignal(rows);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].direction, 'bearish');
  assert.equal(signals[0].status, 'watch');
});

test('resistance warns before the price enters the R1 zone', () => {
  const rows = history();
  rows.at(-1).close = 108.6;
  const zone = { price: 110, lower: 109.4, upper: 110.6, touches: 2 };
  const signals = supportResistanceTouchSignal(rows, { supports: [], resistances: [zone], atr: 1 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].direction, 'bearish');
  assert.deepEqual(signals[0].zone, zone);
  assert.match(signals[0].reason, /接近R1 壓力區/);
  assert.match(signals[0].reason, /距區間/);
});

test('resistance does not warn outside the capped early-warning distance', () => {
  const rows = history();
  rows.at(-1).close = 107;
  const zone = { price: 110, lower: 109.4, upper: 110.6, touches: 2 };
  assert.deepEqual(supportResistanceTouchSignal(rows, { supports: [], resistances: [zone], atr: 1 }), []);
});

test('one completed pivot alone does not create a chart support alert', () => {
  const rows = history();
  rows[48].low = 98;
  rows.at(-1).close = 95;
  assert.deepEqual(supportResistanceTouchSignal(rows), []);
});

test('one completed pivot alone does not create a chart resistance alert', () => {
  const rows = history();
  rows[54].high = 102;
  rows.at(-1).close = 110;
  assert.deepEqual(supportResistanceTouchSignal(rows), []);
});

test('signal zone is the displayed S1 even when price is below its center', () => {
  const rows = history();
  rows.at(-1).close = 94.8;
  const analysis = analyzeTechnicalData(rows, rows.length, { marketType: 'US', notificationStrategies: ['price-sr-touch'] });
  const signal = analysis.strategies.find(item => item.key === 'price-sr-touch' && item.direction === 'bullish');
  assert.ok(analysis.supports[0].price > rows.at(-1).close);
  assert.deepEqual(signal?.zone, analysis.supports[0]);
  assert.match(signal.reason, /S1 支撐區/);
});

test('a breached support is no longer displayed or sent as a buy observation', () => {
  const rows = history();
  rows.at(-1).close = 90;
  const analysis = analyzeTechnicalData(rows, rows.length, { marketType: 'US', notificationStrategies: ['price-sr-touch'] });
  assert.equal(analysis.supports.some(level => level.price === 95), false);
  assert.equal(analysis.strategies.some(item => item.key === 'price-sr-touch' && item.direction === 'bullish' && item.status === 'watch'), false);
});

test('does not notify outside known levels or based on the current candle alone', () => {
  assert.deepEqual(supportResistanceTouchSignal(history()), []);
  const rows = history();
  rows[40].low = 98;
  rows[48].low = 98;
  rows.at(-1).low = 95;
  rows.at(-1).close = 95;
  assert.deepEqual(supportResistanceTouchSignal(rows), []);
});

test('support/resistance alert is selectable in notification settings', () => {
  assert.equal(NOTIFICATION_STRATEGY_KEYS.has('price-sr-touch'), true);
});

test('notification analysis includes the selected level strategy', () => {
  const rows = history();
  rows.at(-1).close = 95;
  const analysis = analyzeTechnicalData(rows, rows.length, { marketType: 'US', notificationStrategies: ['price-sr-touch'] });
  const signal = analysis.strategies.find(item => item.key === 'price-sr-touch');
  assert.equal(signal?.status, 'watch');
  assert.equal(signal?.direction, 'bullish');
  assert.deepEqual(signal?.zone, analysis.supports[0]);
});
