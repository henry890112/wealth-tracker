import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findOverlappingInitialPositionIds,
  getTransactionSourceLabel,
} from '../src/lib/transactionReconciliation.js';

const initial = {
  id: 'opening-2327',
  asset_id: 'asset-2327',
  type: 'BUY',
  shares: 100,
  price: 555.24,
  trans_date: '2026-09-30T05:28:42.620Z',
  external_source: 'initial_position',
};

test('matches an opening snapshot to a nearby E.Sun fill with the same quantity', () => {
  const ids = findOverlappingInitialPositionIds([initial], [{
    asset_id: 'asset-2327',
    type: 'BUY',
    shares: 100,
    price: 552,
    trans_date: '2026-09-29T16:00:00.000Z',
  }]);

  assert.deepEqual(ids, ['opening-2327']);
});

test('does not suppress a distinct additional purchase', () => {
  const ids = findOverlappingInitialPositionIds([initial], [{
    asset_id: 'asset-2327',
    type: 'BUY',
    shares: 50,
    price: 552,
    trans_date: '2026-09-29T16:00:00.000Z',
  }]);

  assert.deepEqual(ids, []);
});

test('does not suppress a fill that is too far from the opening snapshot', () => {
  const ids = findOverlappingInitialPositionIds([initial], [{
    asset_id: 'asset-2327',
    type: 'BUY',
    shares: 100,
    price: 552,
    trans_date: '2026-10-10T16:00:00.000Z',
  }]);

  assert.deepEqual(ids, []);
});

test('labels imported and opening-position records clearly', () => {
  assert.equal(getTransactionSourceLabel({ external_source: 'esun' }), '玉山成交');
  assert.equal(getTransactionSourceLabel({ external_source: 'initial_position' }), '期初持倉');
  assert.equal(getTransactionSourceLabel({ external_source: null }), '一般交易');
});
