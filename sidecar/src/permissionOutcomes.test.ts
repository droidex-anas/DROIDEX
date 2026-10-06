import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAlwaysOutcome,
  isApprovalOutcome,
  normalizePermissionOutcome,
} from './permissionOutcomes.js';

test('only the canonical outcomes pass, and only proceed_always is an always-allow', () => {
  for (const [outcome, approval, always] of [
    ['proceed_always', true, true],
    ['cancel', false, false],
    ['refuse', false, false],
  ] as const) {
    assert.equal(normalizePermissionOutcome(outcome), outcome);
    assert.equal(isApprovalOutcome(outcome), approval, outcome);
    assert.equal(isAlwaysOutcome(outcome), always, outcome);
  }
  // Unknown outcomes are rejected before they reach a provider.
  for (const unknown of ['always_yes', 'proceed_always_tools']) {
    assert.throws(() => normalizePermissionOutcome(unknown), /Unsupported permission outcome/);
    assert.equal(isAlwaysOutcome(unknown), false);
  }
});
