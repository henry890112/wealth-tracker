import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateHoldingPriceReturnPct, resolveAssetAIPrice } from '../src/utils/assetAIPrice.js';

const now = Date.parse('2026-10-21T02:36:00Z');

test('AI analysis prefers a fresh intraday quote over yesterday close', () => {
  const result = resolveAssetAIPrice({ price: 168, quote_status: 'intraday', source_time: '2026-10-21T02:35:00Z', source: 'TWSE MIS', is_stale: false }, 160, now);
  assert.equal(result.price, 168);
  assert.equal(result.label, '盤中報價');
  assert.equal(result.isLive, true);
});

test('old or unavailable quotes are not labeled as current', () => {
  const delayed = resolveAssetAIPrice({ price: 168, quote_status: 'intraday', source_time: '2026-10-21T01:00:00Z' }, 160, now);
  assert.equal(delayed.price, 168);
  assert.equal(delayed.isLive, false);
  assert.match(delayed.label, /非即時/);
  const fallback = resolveAssetAIPrice({ price: 168, quote_status: 'stale', is_stale: true }, 160, now);
  assert.equal(fallback.price, 160);
  assert.match(fallback.label, /歷史收盤價/);
});

test('holding return estimate follows the same quote, not an earlier asset valuation', () => {
  assert.equal(estimateHoldingPriceReturnPct(168, 160, 1, 100), 5);
  assert.equal(estimateHoldingPriceReturnPct(168, 160, 2, 100), 10);
  assert.equal(estimateHoldingPriceReturnPct(null, 160, 1, 100), null);
});
