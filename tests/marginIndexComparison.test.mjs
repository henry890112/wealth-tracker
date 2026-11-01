import assert from 'node:assert/strict';
import test from 'node:test';
import { marginIndexRelativePoints, relativeChangePercent } from '../src/utils/marginIndexComparison.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should be near ${expected}`);

test('index and margin share the first common date as their fixed zero baseline', () => {
  const rows = marginIndexRelativePoints([
    { date: '2026-10-01', index: 100, margin: 200, ma20: 95, ma60: null },
    { date: '2026-10-02', index: 105, margin: 190, ma20: 100, ma60: 90 },
    { date: '2026-10-03', index: 110, margin: 210, ma20: 102, ma60: 92 },
  ]);
  assert.equal(rows[0].indexPercent, 0);
  assert.equal(rows[0].marginPercent, 0);
  near(rows[1].indexPercent, 5);
  near(rows[1].marginPercent, -5);
  near(rows[2].indexPercent, 10);
  near(rows[2].marginPercent, 5);
  near(rows[0].ma20Percent, -5);
  assert.equal(rows[0].ma60Percent, null);
  assert.equal(rows[1].ma20Percent, 0);
  near(rows[1].ma60Percent, -10);
});

test('invalid or missing baselines never produce misleading percentages', () => {
  assert.deepEqual(marginIndexRelativePoints([]), []);
  assert.equal(relativeChangePercent(100, 0), null);
  assert.equal(relativeChangePercent(null, 100), null);
  assert.equal(relativeChangePercent(Number.NaN, 100), null);
});
