import assert from 'node:assert/strict';
import test from 'node:test';

import { UTILITY_TOOL_OPTIONS, utilityToolOption } from './utilityToolOptions';

test('the picker offers the tools every chat has, and Canvas is not one of them', () => {
  assert.deepEqual(
    UTILITY_TOOL_OPTIONS.map((option) => option.tool),
    ['review', 'terminal', 'browser', 'files'],
  );

  // Canvas opens from an artifact card or the design entry point, so it still
  // needs a label and an icon for the tab strip without being offered here.
  assert.equal(utilityToolOption('canvas').label, 'Canvas');
  for (const tool of ['canvas', 'agents', 'threads', 'side'] as const) {
    assert.equal(utilityToolOption(tool).tool, tool);
  }
});
