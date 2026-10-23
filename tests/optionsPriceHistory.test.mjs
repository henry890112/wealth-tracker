import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooOptionHistory } from '../src/services/optionsPriceHistory.js';

test('pairs each valid close with its own trading date', () => {
  const payload = { chart: { result: [{
    timestamp: [1792444800, 1792531200, 1792617600],
    indicators: { quote: [{ close: [217.19, null, 220.78] }] },
  }] } };
  assert.deepEqual(parseYahooOptionHistory(payload), [
    { date: '2026-10-19', close: 217.19 },
    { date: '2026-10-21', close: 220.78 },
  ]);
});

test('missing history does not invent chart points', () => {
  assert.deepEqual(parseYahooOptionHistory({ chart: { result: [] } }), []);
});

test('history is limited to the latest 30 calendar days, not 30 trading bars', () => {
  const days = ['2026-09-15', '2026-09-21', '2026-10-19'];
  const payload = { chart: { result: [{
    timestamp: days.map(day => Date.parse(`${day}T20:00:00Z`) / 1000),
    indicators: { quote: [{ close: [100, 105, 110] }] },
  }] } };
  assert.deepEqual(parseYahooOptionHistory(payload), [
    { date: '2026-09-21', close: 105 },
    { date: '2026-10-19', close: 110 },
  ]);
});
