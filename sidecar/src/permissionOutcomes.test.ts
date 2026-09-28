import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAlwaysOutcome,
  isApprovalOutcome,
  normalizePermissionOutcome,
} from './permissionOutcomes.js';

test('always-allow uses the canonical outcome', () => {
  assert.equal(normalizePermissionOutcome('proceed_always'), 'proceed_always');
  assert.equal(isAlwaysOutcome('proceed_always'), true);
  assert.equal(isApprovalOutcome('proceed_always'), true);
});

test('cancel and refuse are not approvals', () => {
  assert.equal(normalizePermissionOutcome('cancel'), 'cancel');
  assert.equal(isApprovalOutcome('cancel'), false);
  assert.equal(isAlwaysOutcome('cancel'), false);
  assert.equal(normalizePermissionOutcome('refuse'), 'refuse');
  assert.equal(isApprovalOutcome('refuse'), false);
  assert.equal(isAlwaysOutcome('refuse'), false);
});

test('rejects unknown permission outcomes before they reach a provider', () => {
  assert.throws(() => normalizePermissionOutcome('always_yes'), /Unsupported permission outcome/);
  assert.equal(isAlwaysOutcome('always_yes'), false);
  assert.throws(
    () => normalizePermissionOutcome('proceed_always_tools'),
    /Unsupported permission outcome/,
  );
});
