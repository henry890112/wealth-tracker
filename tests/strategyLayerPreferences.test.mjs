import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStrategyLayers } from '../src/features/technical/strategyLayerPreferences.js';

test('support/resistance strategies always display the level layer without changing manual settings', () => {
  const manualLayers = { ma: false, levels: false, volume: true };
  for (const strategy of ['price-sr-touch', 'price-sr-flip']) {
    assert.deepEqual(resolveStrategyLayers(manualLayers, strategy), { ...manualLayers, levels: true });
  }
  assert.equal(manualLayers.levels, false);
  assert.strictEqual(resolveStrategyLayers(manualLayers, 'pullback'), manualLayers);
  assert.strictEqual(resolveStrategyLayers(manualLayers, null), manualLayers);
});
