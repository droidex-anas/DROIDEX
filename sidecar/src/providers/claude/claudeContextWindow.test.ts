import assert from 'node:assert/strict';
import test from 'node:test';

import { claudeContextEnv, claudeContextModel } from './claudeContextWindow.js';

test('Claude context choices round-trip suffixes and isolate the 200k launch environment', () => {
  const catalog = [
    { value: 'sonnet', resolvedModel: 'claude-sonnet-4-6', displayName: 'Sonnet', description: '' },
    { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)', description: 'Extended context' },
    { value: 'native', displayName: 'Native (1M context)', description: '1M context window' },
  ];
  assert.equal(claudeContextModel('claude-sonnet-4-6', 1000000, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('sonnet[1M]', 200000, catalog), 'sonnet');
  assert.equal(claudeContextModel('sonnet[1m]', undefined, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('native', 1000000, catalog), 'native');
  const env = { CLAUDE_CODE_DISABLE_1M_CONTEXT: 'global', PATH: '/bin' };
  assert.deepEqual(claudeContextEnv(env, 200000), { ...env, CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' });
  assert.deepEqual(claudeContextEnv(env, 1000000), { PATH: '/bin' });
  assert.deepEqual(claudeContextEnv(env, undefined), env);
  assert.equal(env.CLAUDE_CODE_DISABLE_1M_CONTEXT, 'global');
});
