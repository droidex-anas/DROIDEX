import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReasoningEffortDisplay } from './reasoningEffort';

test('displays the selected effort for a model with reasoning support', () => {
  assert.equal(
    resolveReasoningEffortDisplay('low', { supportedReasoningEfforts: ['low', 'high'] }),
    'low',
  );
});

test('keeps an unset effort provider-managed instead of inventing a selection', () => {
  assert.equal(
    resolveReasoningEffortDisplay(undefined, { supportedReasoningEfforts: ['high'] }),
    undefined,
  );
});

test('hides the indicator for a known model without supported reasoning efforts', () => {
  assert.equal(resolveReasoningEffortDisplay('high', { supportedReasoningEfforts: [] }), undefined);
  // A known model whose capability list is absent counts as no support.
  assert.equal(resolveReasoningEffortDisplay('high', {}), undefined);
});

test('keeps the indicator while the model is unknown (list still loading)', () => {
  assert.equal(resolveReasoningEffortDisplay('low', undefined), 'low');
});

test('keeps an unset effort while the model is unknown', () => {
  assert.equal(resolveReasoningEffortDisplay(undefined, undefined), undefined);
});
