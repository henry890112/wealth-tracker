import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSwitchAssets, comparisonTargetKey, normalizeComparisonTarget, switchAssetKey } from '../src/features/technical/assetSelection.js';
import { allSettledWithConcurrency } from '../src/features/trends/concurrency.js';

test('標的切換合併同市場持倉，保留加權成本與自選狀態', () => {
  const assets = buildSwitchAssets(
    [
      { symbol: 'AAPL', market_type: 'US', current_shares: 2, average_cost: 100 },
      { symbol: 'AAPL', market_type: 'US', current_shares: 3, average_cost: 110 },
    ],
    [{ symbol: 'AAPL', market_type: 'US', name: 'Apple' }],
  );
  assert.equal(assets.length, 1);
  assert.equal(assets[0].current_shares, 5);
  assert.equal(assets[0].average_cost, 106);
  assert.equal(assets[0].name, 'Apple');
  assert.equal(assets[0].isHolding, true);
  assert.equal(assets[0].isWatchlist, true);
});

test('比較標的的市場與代碼使用相同識別鍵', () => {
  assert.equal(comparisonTargetKey({ symbol: 'aapl', market: 'us' }), switchAssetKey({ symbol: 'AAPL', market_type: 'US' }));
  assert.equal(normalizeComparisonTarget({ symbol: 'btc', market: 'cryptocurrency' }).market_type, 'CRYPTO');
});

test('限流批次保留原順序與單筆錯誤', async () => {
  let active = 0;
  let peak = 0;
  const results = await allSettledWithConcurrency([1, 2, 3, 4], 2, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    if (value === 3) throw new Error('unavailable');
    return value * 10;
  });
  assert.equal(peak <= 2, true);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
  assert.equal(results[3].value, 40);
});
