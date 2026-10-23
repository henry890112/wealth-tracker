import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  calculateFifoPositionAccounting,
  applyCompleteFifoPositionCosts,
} = require('../src/lib/positionAccounting.js');

test('FIFO removes the sold lots from open cost instead of subtracting sale proceeds', () => {
  const transactions = [
    { id: 'a', asset_id: 'cbrs', type: 'BUY', shares: 4, price: 189.71, trans_date: '2026-08-25' },
    { id: 'b', asset_id: 'cbrs', type: 'BUY', shares: 1, price: 182.9, trans_date: '2026-08-25' },
    { id: 'c', asset_id: 'cbrs', type: 'BUY', shares: 10, price: 168.42, trans_date: '2026-10-02' },
    { id: 'd', asset_id: 'cbrs', type: 'BUY', shares: 4, price: 162.83, trans_date: '2026-10-08' },
    { id: 'e', asset_id: 'cbrs', type: 'SELL', shares: 10, price: 117.35, trans_date: '2026-10-21' },
  ];

  const result = calculateFifoPositionAccounting(transactions, { cbrs: 9 });

  assert.equal(result.isComplete, true);
  assert.equal(result.openShares, 9);
  assert.ok(Math.abs(result.openCost - 1493.42) < 1e-8);
  assert.ok(Math.abs(result.averageCost - (1493.42 / 9)) < 1e-8);
  assert.ok(Math.abs(result.realizedPnl - -610.34) < 1e-8);
});

test('buy and sell fees are included in cost and realized proceeds', () => {
  const result = calculateFifoPositionAccounting([
    { type: 'BUY', shares: 2, price: 10, fee: 2, trans_date: '2026-01-01' },
    { type: 'SELL', shares: 1, price: 12, fee: 1, trans_date: '2026-01-02' },
  ], { __position__: 1 });

  assert.equal(result.isComplete, true);
  assert.equal(result.openCost, 11);
  assert.equal(result.averageCost, 11);
  assert.equal(result.realizedPnl, 0);
});

test('partial broker history and unmatched sells are not treated as complete cost data', () => {
  const result = calculateFifoPositionAccounting([
    { type: 'BUY', shares: 2, price: 10, affects_position: false, trans_date: '2026-01-01' },
    { type: 'SELL', shares: 3, price: 12, trans_date: '2026-01-02' },
  ], { broker: 2 });

  assert.equal(result.isComplete, false);
  assert.equal(result.openShares, 0);
  assert.equal(result.unmatchedSellShares, 3);
});

test('dashboard cost basis uses reconciled FIFO lots and preserves incomplete imported positions', () => {
  const assets = [
    { id: 'cbrs', category: 'investment', current_shares: 9, average_cost: 233.75 },
    { id: 'partial', category: 'investment', current_shares: 5, average_cost: 42 },
  ];
  const transactions = [
    { id: 'a', asset_id: 'cbrs', type: 'BUY', shares: 4, price: 189.71, trans_date: '2026-08-25' },
    { id: 'b', asset_id: 'cbrs', type: 'BUY', shares: 1, price: 182.9, trans_date: '2026-08-25' },
    { id: 'c', asset_id: 'cbrs', type: 'BUY', shares: 10, price: 168.42, trans_date: '2026-10-02' },
    { id: 'd', asset_id: 'cbrs', type: 'BUY', shares: 4, price: 162.83, trans_date: '2026-10-08' },
    { id: 'e', asset_id: 'cbrs', type: 'SELL', shares: 10, price: 117.35, trans_date: '2026-10-21' },
    { id: 'f', asset_id: 'partial', type: 'BUY', shares: 2, price: 40, trans_date: '2026-10-01' },
  ];

  const corrected = applyCompleteFifoPositionCosts(assets, transactions);

  assert.ok(Math.abs(corrected[0].average_cost - (1493.42 / 9)) < 1e-8);
  assert.equal(corrected[0].position_cost_source, 'fifo');
  assert.equal(corrected[1].average_cost, 42);
  assert.equal(corrected[1].position_cost_source, undefined);
});
