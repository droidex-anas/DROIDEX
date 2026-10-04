import assert from 'node:assert/strict';
import test from 'node:test';

import { bridgeFeature } from './missionFeatures.js';

test('bridgeFeature passes a well-formed feature through, omitting absent optional fields', () => {
  const feature = {
    id: 'f1',
    description: 'Ship the thing',
    status: 'in_progress',
    skillName: 'build',
    preconditions: ['a'],
    expectedBehavior: ['b'],
    verificationSteps: ['c'],
    fulfills: ['req-1'],
    milestone: 'M1',
  };
  assert.deepEqual(bridgeFeature(feature), feature);

  const bare = bridgeFeature({
    id: 'f2',
    description: 'Validate the thing',
    status: 'completed',
    skillName: 'verify',
  });
  assert.deepEqual(bare, {
    id: 'f2',
    description: 'Validate the thing',
    status: 'completed',
    skillName: 'verify',
    preconditions: [],
    expectedBehavior: [],
    verificationSteps: [],
  });
  assert.equal('fulfills' in bare, false);
  assert.equal('milestone' in bare, false);
});

test('bridgeFeature repairs malformed input into a valid feature instead of leaking it', () => {
  assert.equal(bridgeFeature({ id: 'f3', status: 'blocked' }).status, 'pending');
  assert.deepEqual(bridgeFeature({ id: 'f4', preconditions: ['a', 7, null] }).preconditions, ['a']);
  assert.deepEqual(bridgeFeature({ id: 'f4', fulfills: 'req-1' }).fulfills, undefined);
  assert.equal(bridgeFeature({ id: 'f5' }).description, 'f5');
  assert.deepEqual(bridgeFeature(null), {
    id: 'feature',
    description: 'Feature',
    status: 'pending',
    skillName: '',
    preconditions: [],
    expectedBehavior: [],
    verificationSteps: [],
  });
});
