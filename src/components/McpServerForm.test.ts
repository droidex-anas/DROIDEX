import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMcpVariables } from '../lib/mcpConfig.js';

test('MCP variables preserve values containing equals signs', () => {
  assert.deepEqual(parseMcpVariables('Authorization=Bearer abc==\nX-Team=platform'), {
    Authorization: 'Bearer abc==',
    'X-Team': 'platform',
  });
});

test('MCP variables reject malformed lines and duplicate keys instead of guessing', () => {
  assert.throws(() => parseMcpVariables('Authorization'), /Expected KEY=VALUE/);
  assert.throws(() => parseMcpVariables(' =value'), /Expected KEY=VALUE/);
  assert.throws(
    () => parseMcpVariables('Authorization=first\nAuthorization=second'),
    /Duplicate key “Authorization”/,
  );
});
