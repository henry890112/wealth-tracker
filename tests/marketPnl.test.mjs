import assert from 'node:assert/strict';
import test from 'node:test';
import { getDayPnlPresentation, getMarketDateString } from '../src/lib/marketPnl.js';

const usAsset = (sourceTime, overrides = {}) => ({
  market_type: 'US',
  day_pnl: 100,
  price_source_time: sourceTime,
  price_quote_status: 'official_close',
  ...overrides,
});

test('US quote before Monday open is labelled as the previous trading session', () => {
  const presentation = getDayPnlPresentation(
    [usAsset('2026-10-09T20:00:00.000Z')],
    'US',
    new Date('2026-10-12T10:27:00.000Z'),
  );
  assert.equal(presentation.label, '上一交易日損益（10/9）');
  assert.equal(presentation.isPreviousSession, true);
});

test('US quote from the current New York trading date is labelled today', () => {
  const presentation = getDayPnlPresentation(
    [usAsset('2026-10-12T15:30:00.000Z', { price_quote_status: 'intraday' })],
    'US',
    new Date('2026-10-12T15:35:00.000Z'),
  );
  assert.equal(presentation.label, '今日損益');
  assert.equal(presentation.isPreviousSession, false);
});

test('crypto uses a 24-hour label', () => {
  const presentation = getDayPnlPresentation([
    { market_type: 'Crypto', day_pnl: 10, price_source_time: '2026-10-12T10:00:00.000Z' },
  ], 'Crypto', new Date('2026-10-12T10:27:00.000Z'));
  assert.equal(presentation.label, '近 24 小時損益');
});

test('assets without a usable day P&L are not treated as a zero quote', () => {
  const presentation = getDayPnlPresentation([
    { market_type: 'US', day_pnl: null, price_source_time: '2026-10-09T20:00:00.000Z' },
  ], 'US', new Date('2026-10-12T10:27:00.000Z'));
  assert.equal(presentation.label, '單日損益');
});

test('market date conversion follows the exchange timezone', () => {
  const timestamp = '2026-10-10T01:00:00.000Z';
  assert.equal(getMarketDateString(timestamp, 'US'), '2026-10-09');
  assert.equal(getMarketDateString(timestamp, 'TW'), '2026-10-10');
});
