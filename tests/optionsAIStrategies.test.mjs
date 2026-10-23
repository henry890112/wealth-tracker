import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOptionStrategies, optionPayoffAtExpiration } from '../src/services/optionsAIStrategies.js';

const contracts = [
  { type: 'call', strike: 100, expiration: '2027-01-15', bid: 5, ask: 6, openInterest: 120, multiplier: 100 },
  { type: 'call', strike: 110, expiration: '2027-01-15', bid: 2, ask: 3, openInterest: 90, multiplier: 100 },
  { type: 'put', strike: 100, expiration: '2027-01-15', bid: 4, ask: 5, openInterest: 110, multiplier: 100 },
  { type: 'put', strike: 90, expiration: '2027-01-15', bid: 1, ask: 2, openInterest: 80, multiplier: 100 },
];
const strategies = buildOptionStrategies({ contracts, spot: 100, budget: 500, expiration: '2027-01-15' });
const byKey = key => strategies.find(item => item.key === key);

test('uses ask to buy and bid to sell, with defined-risk debit spread math', () => {
  const bull = byKey('bull_call_spread');
  assert.equal(bull.cost, 400);
  assert.equal(bull.maxLoss, 400);
  assert.equal(bull.maxGain, 600);
  assert.deepEqual(bull.breakeven, [104]);
  assert.equal(bull.affordableContracts, 1);
  assert.equal(optionPayoffAtExpiration(bull, 95), -400);
  assert.equal(optionPayoffAtExpiration(bull, 104), 0);
  assert.equal(optionPayoffAtExpiration(bull, 115), 600);
});

test('calculates bearish put spread and long options at expiration', () => {
  const bear = byKey('bear_put_spread');
  assert.equal(bear.cost, 400);
  assert.equal(bear.maxGain, 600);
  assert.deepEqual(bear.breakeven, [96]);
  assert.equal(optionPayoffAtExpiration(bear, 85), 600);
  assert.equal(optionPayoffAtExpiration(bear, 105), -400);
  assert.equal(byKey('long_call').maxGain, null);
  assert.equal(optionPayoffAtExpiration(byKey('long_call'), 105), -100);
  assert.equal(byKey('long_put').maxGain, 9500);
});

test('straddle has two break-even prices and budget is per contract group', () => {
  const straddle = byKey('straddle');
  assert.equal(straddle.cost, 1100);
  assert.deepEqual(straddle.breakeven, [89, 111]);
  assert.equal(straddle.affordableContracts, 0);
  assert.equal(optionPayoffAtExpiration(straddle, 100), -1100);
  assert.equal(optionPayoffAtExpiration(straddle, 115), 400);
});

test('does not fabricate strategies from missing or crossed quotes', () => {
  assert.deepEqual(buildOptionStrategies({ contracts: [{ ...contracts[0], ask: null }], spot: 100 }), []);
  assert.deepEqual(buildOptionStrategies({ contracts: [{ ...contracts[0], bid: 7 }], spot: 100 }), []);
  assert.deepEqual(buildOptionStrategies({ contracts, spot: null }), []);
  assert.equal(optionPayoffAtExpiration(byKey('long_call'), -1), null);
});

test('rejects impossible debit spread rather than reporting a fake profit', () => {
  const impossible = buildOptionStrategies({ contracts: [
    { ...contracts[0], ask: 15 }, { ...contracts[1], bid: 1 },
  ], spot: 100 });
  assert.equal(impossible.some(item => item.key === 'bull_call_spread'), false);
});
