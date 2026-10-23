import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateExpectedMove, normalizeAnnualIv, selectAtmIv } from '../src/services/optionsExpectedMove.js';

test('normalizes decimal and percent IV without accepting missing or implausible values', () => {
  assert.equal(normalizeAnnualIv(0.4), 0.4);
  assert.equal(normalizeAnnualIv(40), 0.4);
  assert.equal(normalizeAnnualIv(null), null);
  assert.equal(normalizeAnnualIv(400), null);
});

test('uses the nearest call and put of the selected expiry', () => {
  const result = selectAtmIv([
    { type: 'call', expiration: '2026-11-20', strike: 100, impliedVolatility: 0.3 },
    { type: 'put', expiration: '2026-11-20', strike: 100, impliedVolatility: 50 },
    { type: 'call', expiration: '2026-11-20', strike: 110, impliedVolatility: 0.8 },
    { type: 'call', expiration: '2026-12-18', strike: 100, impliedVolatility: 0.9 },
  ], 101, '2026-11-20');
  assert.equal(result.annualIv, 0.4);
  assert.equal(result.contractCount, 2);
  assert.deepEqual(result.strikes, [100, 100]);
});

test('expected range follows annual IV square-root-of-time and is symmetric around spot', () => {
  const result = calculateExpectedMove({ spot: 100, expiration: '2027-10-21', annualIv: 0.2, now: '2026-10-21T00:00:00Z' });
  assert.equal(result.days, 365);
  assert.equal(result.move, 20);
  assert.equal(result.lower, 80);
  assert.equal(result.upper, 120);
  assert.equal(result.movePercent, 20);
});

test('does not draw expected move without valid forward expiry, spot or IV', () => {
  assert.equal(calculateExpectedMove({ spot: 100, expiration: '2026-10-20', annualIv: 0.2, now: '2026-10-21T00:00:00Z' }), null);
  assert.equal(calculateExpectedMove({ spot: 0, expiration: '2026-11-20', annualIv: 0.2 }), null);
  assert.equal(calculateExpectedMove({ spot: 100, expiration: '2026-11-20', annualIv: 40 }), null);
  assert.equal(selectAtmIv([{ type: 'call', expiration: '2026-11-20', strike: 100, impliedVolatility: null }], 100, '2026-11-20'), null);
});
