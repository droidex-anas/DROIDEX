import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHILD_TOKEN_STREAM_OPTIONS,
  childTokenStream,
  isStreamFidelity,
  observedChildStreamFidelity,
  publishedStreamFidelity,
} from './childStreamFidelity.js';
import { childSummary, newChildState } from './ChildSessionState.js';

test('the fidelity vocabulary is closed and a token stream declaration is coupled to includePartialMessages', () => {
  const stream = childTokenStream();
  assert.equal(stream.fidelity, 'token');
  assert.equal(stream.options.includePartialMessages, true);
  assert.equal(stream.options, CHILD_TOKEN_STREAM_OPTIONS);
  for (const fidelity of ['token', 'tool', 'state']) assert.equal(isStreamFidelity(fidelity), true);
  assert.equal(isStreamFidelity('streaming'), false);
  assert.equal(isStreamFidelity(undefined), false);
});

test('observed children publish state fidelity until a token stream is declared', () => {
  assert.equal(observedChildStreamFidelity(), 'state');
  assert.equal(publishedStreamFidelity(undefined), 'state');
  assert.equal(publishedStreamFidelity('tool'), 'tool');
  const child = newChildState({
    parentAppSessionId: 'parent',
    childSessionId: 'child-a',
    role: 'worker',
    modelId: 'model-default',
    updatedAt: 1,
  });
  assert.equal(childSummary(child).streamFidelity, 'state');
  child.streamFidelity = 'token';
  assert.equal(childSummary(child).streamFidelity, 'token');
});
