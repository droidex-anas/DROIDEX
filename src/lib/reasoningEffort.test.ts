import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveReasoningEffortDisplay } from './reasoningEffort';

test('the effort indicator shows only a selected effort the model can use', () => {
  // [why, selected effort, model, displayed effort]
  type Display = typeof resolveReasoningEffortDisplay;
  const cases: Array<[string, ...Parameters<Display>, ReturnType<Display>]> = [
    ['a supported selection shows', 'low', { supportedReasoningEfforts: ['low', 'high'] }, 'low'],
    // An unset effort stays provider-managed instead of inventing a selection.
    ['an unset effort stays unset', undefined, { supportedReasoningEfforts: ['high'] }, undefined],
    ['a model without efforts hides it', 'high', { supportedReasoningEfforts: [] }, undefined],
    // A known model whose capability list is absent counts as no support.
    ['an absent capability list hides it', 'high', {}, undefined],
    ['an unknown model (list loading) keeps it', 'low', undefined, 'low'],
    ['an unknown model keeps an unset effort unset', undefined, undefined, undefined],
  ];
  for (const [why, effort, model, expected] of cases) {
    assert.equal(resolveReasoningEffortDisplay(effort, model), expected, why);
  }
});
