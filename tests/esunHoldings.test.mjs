import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeEsunHolding } from '../esun-bridge/src/holdings.mjs';

test('E.Sun holding prefers current net quantity after a partial sale', () => {
  const holding = normalizeEsunHolding({
    stkNo: '2327',
    stkNa: '國巨',
    qty: '50',
    stkDats: [{ qty: '100' }],
    costSum: '-27,639',
    priceMkt: '599',
    valueMkt: '29,950',
  });

  assert.equal(holding.quantity, 50);
  assert.equal(holding.costBasis, 27_639);
  assert.equal(holding.averageCost, 552.78);
  assert.equal(holding.marketValue, 29_950);
});

test('E.Sun holding only sums detail quantities when current net quantity is absent', () => {
  const holding = normalizeEsunHolding({
    stkNo: '2454',
    stkDats: [{ qty: '30' }, { qty: '20' }],
    costSum: '-50,000',
    priceMkt: '1,100',
  });

  assert.equal(holding.quantity, 50);
  assert.equal(holding.averageCost, 1_000);
  assert.equal(holding.marketValue, 55_000);
});

test('E.Sun holding trusts an explicit zero net quantity over stale lot details', () => {
  const holding = normalizeEsunHolding({
    stkNo: '2330',
    qty: '0',
    stkDats: [{ qty: '100' }],
    costSum: '0',
  });

  assert.equal(holding.quantity, 0);
});

test('E.Sun holding reconciles a stale quantity with broker market value and price', () => {
  const holding = normalizeEsunHolding({
    stkNo: '2327',
    qty: '100',
    stkDats: [{ qty: '100' }],
    costSum: '-27,639',
    priceMkt: '599',
    valueMkt: '29,950',
  });

  assert.equal(holding.quantity, 50);
  assert.equal(holding.averageCost, 552.78);
});
