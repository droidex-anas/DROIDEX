import assert from 'node:assert/strict';
import test from 'node:test';

import { selectInstallChannel } from './InstallStep';

test('selectInstallChannel keeps an available selection and replaces a missing one', () => {
  assert.equal(selectInstallChannel(['script', 'brew'], 'brew'), 'brew');
  assert.equal(selectInstallChannel(['npm'], 'brew'), 'npm');
  assert.equal(selectInstallChannel([], 'brew'), null);
});
