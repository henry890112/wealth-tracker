import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeQuarterSeriesByPriority } from '../supabase/functions/financial-reports/quarterSeries.shared.js';

test('fills missing net-income quarters from a fallback SEC concept', () => {
  const primary = [{ end: '2026-05-03', value: 9_310_000_000 }];
  const fallback = [
    { end: '2026-05-03', value: 1 },
    { end: '2026-08-02', value: 13_088_000_000 },
  ];
  assert.deepEqual(mergeQuarterSeriesByPriority([primary, fallback]), [
    primary[0],
    fallback[1],
  ]);
});

test('does not turn a missing quarter into a fabricated zero', () => {
  assert.deepEqual(mergeQuarterSeriesByPriority([[], []]), []);
});
