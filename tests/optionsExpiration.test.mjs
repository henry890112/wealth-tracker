import test from 'node:test';
import assert from 'node:assert/strict';
import { daysUntilExpiration, expirationCountdownLabel } from '../src/utils/optionsExpiration.js';

test('US expiration countdown follows New York date across the UTC day boundary', () => {
  const now = new Date('2026-10-21T02:00:00Z'); // Oct 20 in New York
  assert.equal(daysUntilExpiration('2026-10-21', 'US', now), 1);
  assert.equal(expirationCountdownLabel('2026-10-21', 'US', now), '1 天後');
  assert.equal(expirationCountdownLabel('2026-10-20', 'US', now), '今天到期');
});

test('Taiwan expiration countdown follows Taipei date', () => {
  const now = new Date('2026-10-21T02:00:00Z');
  assert.equal(daysUntilExpiration('2026-10-21', 'TW', now), 0);
  assert.equal(expirationCountdownLabel('2026-10-23', 'TW', now), '2 天後');
});

test('invalid and expired dates are identified', () => {
  const now = new Date('2026-10-21T16:00:00Z');
  assert.equal(expirationCountdownLabel('2026-10-20', 'TW', now), '已到期');
  assert.equal(daysUntilExpiration('2026-02-30', 'US', now), null);
  assert.equal(expirationCountdownLabel('bad', 'US', now), '日期無效');
});
