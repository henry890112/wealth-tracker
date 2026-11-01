import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSavedNotificationStrategies } from '../src/utils/notificationStrategySelection.js';

const allowed = new Set(['hybrid', 'kd-cross', 'price-sr-touch']);
const defaults = ['hybrid'];

test('saved notification strategies remain selected instead of the technical chart selection', () => {
  assert.deepEqual(resolveSavedNotificationStrategies(['price-sr-touch', 'kd-cross'], allowed, defaults), ['price-sr-touch', 'kd-cross']);
  assert.deepEqual(resolveSavedNotificationStrategies(['hybrid'], allowed, defaults), ['hybrid']);
});

test('missing or unsupported saved strategies use notification defaults', () => {
  assert.deepEqual(resolveSavedNotificationStrategies(null, allowed, defaults), ['hybrid']);
  assert.deepEqual(resolveSavedNotificationStrategies([], allowed, defaults), ['hybrid']);
  assert.deepEqual(resolveSavedNotificationStrategies(['removed', 'kd-cross', 'kd-cross'], allowed, defaults), ['kd-cross']);
});
