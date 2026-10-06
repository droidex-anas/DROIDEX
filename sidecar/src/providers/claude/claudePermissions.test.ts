import assert from 'node:assert/strict';
import test from 'node:test';
import type { PermissionMode, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderApprovalRequest } from '../interactions.js';
import { ClaudePermissionModes } from './claudePermissionModes.js';
import { claudeCanUseTool, claudePermissionMode } from './claudePermissions.js';
import { sessionOptions } from './claudeOptions.js';
import { claudeCanvasHook } from './claudeCanvasHook.js';

test('Claude Canvas read hook keeps each tool-use ID on its original lease', async () => {
  let active: string | undefined = 'turn-first';
  const hook = claudeCanvasHook(() => active).hooks[0];
  const read = (tool_use_id: string, tool_input: Record<string, unknown> = {}) =>
    hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'mcp__droidex-canvas__canvas_read',
        tool_input,
        tool_use_id,
        session_id: 'chat-one',
        transcript_path: '/unused',
        cwd: '/unused',
      },
      tool_use_id,
      { signal: new AbortController().signal },
    );
  assert.deepEqual(await read('use-one'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { scopeId: 'turn-first' } },
  });
  active = 'turn-second';
  assert.deepEqual(await read('use-one'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { scopeId: 'turn-first' } },
  });
  assert.deepEqual(await read('use-two'), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { scopeId: 'turn-second' } },
  });
  assert.deepEqual(await read('use-explicit', { scopeId: 'turn-first' }), {
    hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { scopeId: 'turn-first' } },
  });
  assert.match(
    JSON.stringify(await read('use-explicit', { scopeId: 'turn-second' })),
    /scope_expired/,
  );
  active = undefined;
  assert.match(JSON.stringify(await read('use-three')), /scope_expired/);
});

test('Claude maps product permission modes to distinct CLI modes', () => {
  assert.deepEqual(
    ['off', 'low', 'medium', 'high'].map((level) => {
      assert.ok(level === 'off' || level === 'low' || level === 'medium' || level === 'high');
      return claudePermissionMode(level);
    }),
    ['default', 'acceptEdits', 'auto', 'bypassPermissions'],
  );
});

test('Auto is probed once, with one notice and default fallback when refused, withdrawn if the user moves on', async () => {
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

  // The notice is withdrawn when the user selects another mode before it is delivered.
  const reselected = new ClaudePermissionModes('medium', false, () => undefined);
  await reselected.initialize(query);
  await reselected.change(query, Promise.resolve(), () => ({ autonomy: 'high', planning: false }));
  assert.equal(reselected.takeNotice(), undefined);
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

test('reopening Spec keeps plan mode even when Full access is selected', () => {
  const options = sessionOptions(
    {
      appSessionId: 'app-spec',
      executable: '/unused',
      cwd: '/workspace',
      autonomy: 'high',
      interactionMode: 'spec',
      resume: true,
      models: [],
      mcpServers: {},
      interactions: {
        requestApproval: async () => 'cancel',
        requestQuestion: async () => ({ cancelled: true, answers: [] }),
        isActive: () => true,
        cancelPending: () => undefined,
      },
    },
    new AbortController(),
    () => true,
    () => undefined,
  );
  assert.equal(options.permissionMode, 'plan');
  assert.equal(options.resume, 'app-spec');
});

test("an Always allow narrower than its tool never becomes the CLI's rule for the whole tool", async () => {
  const approvals: ProviderApprovalRequest[] = [];
  const canUseTool = claudeCanUseTool(
    'chat',
    {
      requestApproval: (approval) => {
        approvals.push(approval);
        return Promise.resolve('proceed_always');
      },
      requestQuestion: () => Promise.resolve({ cancelled: true, answers: [] }),
      cancelPending: () => {},
      isActive: () => true,
    },
    () => false,
  );
  const suggestions: PermissionUpdate[] = [
    { type: 'addRules', rules: [{ toolName: 'tool' }], behavior: 'allow', destination: 'session' },
  ];
  const options = {
    signal: new AbortController().signal,
    suggestions,
    toolUseID: 'call',
    requestId: 'request',
  };

  const spawn = await canUseTool(
    'mcp__droidex-sessions__thread_spawn',
    { reportBack: true },
    options,
  );
  assert.equal(approvals.at(-1)?.signature, 'mcp::droidex-sessions::thread_spawn::thread');
  assert.deepEqual(spawn, { behavior: 'allow' });

  const whole = await canUseTool('mcp__github__create_issue', { title: 'Bug' }, options);
  assert.equal(approvals.at(-1)?.signature, 'mcp::github::create_issue');
  assert.deepEqual(whole, { behavior: 'allow', updatedPermissions: suggestions });
});
