import assert from 'node:assert/strict';
import test from 'node:test';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

import { ClaudePermissionModes } from './claudePermissionModes.js';
import { claudePermissionMode } from './claudePermissions.js';
import { sessionOptions } from './claudeOptions.js';

test('Claude maps product permission modes to distinct CLI modes', () => {
  assert.deepEqual(
    ['off', 'low', 'medium', 'high'].map((level) => {
      assert.ok(level === 'off' || level === 'low' || level === 'medium' || level === 'high');
      return claudePermissionMode(level);
    }),
    ['default', 'acceptEdits', 'auto', 'bypassPermissions'],
  );
});

test('Auto is probed once, with one notice and default fallback when refused', async () => {
  const calls: PermissionMode[] = [];
  const query = {
    setPermissionMode: async (mode: PermissionMode) => {
      calls.push(mode);
      if (mode === 'auto') throw new Error('Auto is not supported');
    },
  };
  const modes = new ClaudePermissionModes('medium', false, () => undefined);
  await modes.initialize(query);
  assert.deepEqual(calls, ['auto', 'default']);
  assert.match(modes.takeNotice() ?? '', /approvals still ask/);
  await modes.change(query, Promise.resolve(), () => ({ autonomy: 'low', planning: false }));
  await modes.change(query, Promise.resolve(), () => ({ autonomy: 'medium', planning: false }));
  assert.deepEqual(calls, ['auto', 'default', 'acceptEdits', 'default']);
  assert.equal(modes.takeNotice(), undefined);
});

test('Spec restores the chosen permission mode and rejected changes keep the selection', async () => {
  const calls: PermissionMode[] = [];
  let reject = false;
  const query = {
    setPermissionMode: async (mode: PermissionMode) => {
      calls.push(mode);
      if (reject) throw new Error('refused');
    },
  };
  const modes = new ClaudePermissionModes('medium', true, () => undefined);
  await modes.initialize(query);
  await modes.change(query, Promise.resolve(), () => ({ autonomy: 'low', planning: true }));
  assert.deepEqual(calls, ['auto', 'plan']);
  await modes.change(query, Promise.resolve(), () => ({
    autonomy: modes.selection(),
    planning: false,
  }));
  assert.equal(calls.at(-1), 'acceptEdits');
  reject = true;
  await assert.rejects(
    modes.change(query, Promise.resolve(), () => ({ autonomy: 'high', planning: false })),
    /refused/,
  );
  assert.equal(modes.selection(), 'low');
});

test('closing during the Auto probe prevents restoration and later publication', async () => {
  const calls: PermissionMode[] = [];
  let closed = false;
  const modes = new ClaudePermissionModes('medium', false, () => {
    if (closed) throw new Error('closed');
  });
  await assert.rejects(
    modes.initialize({
      setPermissionMode: async (mode) => {
        calls.push(mode);
        closed = true;
      },
    }),
    /closed/,
  );
  assert.deepEqual(calls, ['auto']);
  assert.equal(modes.takeNotice(), undefined);
});

test('a fallback notice is withdrawn when the user selects another mode before delivery', async () => {
  const modes = new ClaudePermissionModes('medium', false, () => undefined);
  const query = {
    setPermissionMode: async (mode: PermissionMode) => {
      if (mode === 'auto') throw new Error('unsupported');
    },
  };
  await modes.initialize(query);
  await modes.change(query, Promise.resolve(), () => ({ autonomy: 'high', planning: false }));
  assert.equal(modes.takeNotice(), undefined);
});


test('reopening Spec keeps plan mode even when Full access is selected', () => {
  const options = sessionOptions({
    appSessionId: 'app-spec', executable: '/unused', cwd: '/workspace',
    autonomy: 'high', interactionMode: 'spec', resume: true, mcpServers: {},
    interactions: {
      requestApproval: async () => 'cancel',
      requestQuestion: async () => ({ cancelled: true, answers: [] }),
      cancelPending: () => undefined,
    },
  }, new AbortController(), () => true, () => undefined);
  assert.equal(options.permissionMode, 'plan');
  assert.equal(options.resume, 'app-spec');
});
