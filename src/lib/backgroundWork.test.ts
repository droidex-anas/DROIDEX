import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveBackgroundWorkTier } from './backgroundWork';

test('visible documents stay interactive; hidden windows pause work and battery deepens it', () => {
  const tier = (documentVisible: boolean, windowVisible: boolean, onBattery: boolean) =>
    resolveBackgroundWorkTier({ documentVisible, windowVisible, onBattery });
  assert.equal(tier(true, true, true), 'interactive');
  assert.equal(tier(false, true, false), 'hidden');
  assert.equal(tier(true, false, true), 'low-power');
});
