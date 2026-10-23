import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateOptionsAnalytics,
  calculateScenarioGexCurve,
  estimateGammaFromDeltaCurve,
  filterContractsByRange,
  inferSpotFromPutCallParity,
  normalizeOptionSymbol,
  normalizeTaiwanOptionSymbol,
  parseTaifexStockProducts,
} from '../src/services/optionsAnalyticsCalculator.js';

test('normalizes an underlying ticker without accepting arbitrary text', () => {
  assert.equal(normalizeOptionSymbol(' fico '), 'FICO');
  assert.equal(normalizeOptionSymbol('brk/b<script>'), 'BRK/BSCRIPT');
});

test('normalizes Taiwan stock and option product codes', () => {
  assert.equal(normalizeTaiwanOptionSymbol(' 2330.tw '), '2330TW');
  assert.equal(normalizeTaiwanOptionSymbol('txo'), 'TXO');
});

test('parses official TAIFEX option products and contract multiplier', () => {
  const html = `<table><tr>
    <td>CD</td><td>台灣積體電路製造股份有限公司</td><td>2330</td><td>台積電</td>
    <td>●<span>是股票期貨標的</span></td><td>●<span>是股票選擇權標的</span></td>
    <td>●<span>是股票選擇權週契約標的</span></td><td>◎</td><td></td><td></td><td></td>
    <td>2,000</td><td>8:45~13:45</td><td>17:25~次日05:00</td>
  </tr></table>`;
  assert.deepEqual(parseTaifexStockProducts(html), [{
    baseCode: 'CD', contract: 'CDO', symbol: '2330', name: '台積電', multiplier: 2000, weekly: true,
  }]);
});

test('infers Taiwan underlying reference from put-call settlement parity', () => {
  assert.equal(inferSpotFromPutCallParity([
    { type: 'call', strike: 100, settlementPrice: 7 },
    { type: 'put', strike: 100, settlementPrice: 2 },
    { type: 'call', strike: 105, settlementPrice: 3 },
    { type: 'put', strike: 105, settlementPrice: 3 },
  ]), 105);
});

test('estimates positive gamma from the official delta curve', () => {
  const rows = estimateGammaFromDeltaCurve({
    spot: 100,
    rows: [
      { type: 'call', expiration: '2026-10-21', strike: 90, delta: 0.8 },
      { type: 'call', expiration: '2026-10-21', strike: 100, delta: 0.5 },
      { type: 'call', expiration: '2026-10-21', strike: 110, delta: 0.2 },
    ],
  });
  assert.ok(Math.abs(rows[1].gamma - 0.03) < 1e-12);
});

test('calculates signed gamma exposure and walls by strike', () => {
  const result = calculateOptionsAnalytics({
    spot: 100,
    contracts: [
      { type: 'call', strike: 105, gamma: 0.05, openInterest: 100, volume: 30, multiplier: 100 },
      { type: 'put', strike: 95, gamma: 0.04, openInterest: 200, volume: 50, multiplier: 100 },
      { type: 'call', strike: 110, gamma: 0.02, openInterest: 50, volume: 10, multiplier: 100 },
    ],
  });
  assert.equal(result.callWall, 105);
  assert.equal(result.putWall, 95);
  assert.equal(result.totalGex, -20000);
  assert.equal(result.totalCallVolume, 40);
  assert.equal(result.totalPutVolume, 50);
  assert.equal(result.usableContracts, 3);
});

test('filters strikes around spot but supports an unrestricted range', () => {
  const contracts = [{ strike: 70 }, { strike: 80 }, { strike: 100 }, { strike: 120 }, { strike: 130 }];
  assert.deepEqual(filterContractsByRange(contracts, 100, 0.2).map(item => item.strike), [80, 100, 120]);
  assert.equal(filterContractsByRange(contracts, 100, null).length, 5);
});

test('scenario GEX reprices the full option chain at each hypothetical underlying price', () => {
  const curve = calculateScenarioGexCurve({
    prices: [90, 100, 110],
    asOf: '2026-01-01T20:00:00Z',
    riskFreeRate: 0,
    contracts: [
      { type: 'call', strike: 100, expiration: '2027-01-01', impliedVolatility: 0.2, openInterest: 10, multiplier: 100 },
      { type: 'put', strike: 90, expiration: '2027-01-01', impliedVolatility: 0.25, openInterest: 4, multiplier: 100 },
    ],
  });
  assert.deepEqual(curve.map(point => point.price), [90, 100, 110]);
  assert.ok(curve.every(point => point.callGex > 0 && point.putGex < 0));
  assert.ok(curve.every(point => Math.abs(point.totalGex - (point.callGex + point.putGex)) < 1e-9));
});

test('timezone-less Cboe snapshot timestamps are parsed consistently as UTC', () => {
  const input = {
    prices: [90, 100, 110],
    contracts: [{ type: 'call', strike: 100, expiration: '2026-10-09', impliedVolatility: 0.3, openInterest: 10, multiplier: 100 }],
  };
  const wireTimestamp = calculateScenarioGexCurve({ ...input, asOf: '2026-10-07 02:15:50' });
  const explicitUtc = calculateScenarioGexCurve({ ...input, asOf: '2026-10-07T02:15:50Z' });
  assert.deepEqual(wireTimestamp, explicitUtc);
});
