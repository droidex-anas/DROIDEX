import assert from 'node:assert/strict';
import test from 'node:test';
import type { PermissionMode, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderApprovalRequest } from '../interactions.js';
import type { Autonomy } from '../../protocol.js';
import { ClaudePermissionModes } from './claudePermissionModes.js';
import { claudeCanUseTool, claudePermissionMode } from './claudePermissions.js';
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

test('Auto is probed once, with one notice and default fallback when refused, withdrawn if the user moves on', async () => {
  const calls: PermissionMode[] = [];
  const query = {
    setPermissionMode: async (mode: PermissionMode) => {
      calls.push(mode);
      if (mode === 'auto') throw new Error('Auto is not supported');
    },
  };
  const modes = new ClaudePermissionModes(
    'medium',
    false,
    () => undefined,
    async () => undefined,
    async () => undefined,
  );
  await modes.initialize(query);
  assert.deepEqual(calls, ['auto', 'default']);
  assert.match(modes.takeNotice() ?? '', /approvals still ask/);
  await modes.change(Promise.resolve(), { autonomy: 'low', planning: false });
  await modes.change(Promise.resolve(), { autonomy: 'medium', planning: false });
  assert.deepEqual(calls, ['auto', 'default', 'acceptEdits', 'default']);
  assert.equal(modes.takeNotice(), undefined);

  // The notice is withdrawn when the user selects another mode before it is delivered.
  const reselected = new ClaudePermissionModes(
    'medium',
    false,
    () => undefined,
    async () => undefined,
    async () => undefined,
  );
  await reselected.initialize(query);
  await reselected.change(Promise.resolve(), { autonomy: 'high', planning: false });
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
  const modes = new ClaudePermissionModes(
    'medium',
    true,
    () => undefined,
    async () => undefined,
    async () => undefined,
  );
  await modes.initialize(query);
  await modes.change(Promise.resolve(), { autonomy: 'low', planning: true });
  assert.deepEqual(calls, ['auto', 'plan']);
  await modes.change(Promise.resolve(), {
    autonomy: modes.selection(),
    planning: false,
  });
  assert.equal(calls.at(-1), 'acceptEdits');
  reject = true;
  await assert.rejects(
    modes.change(Promise.resolve(), { autonomy: 'high', planning: false }),
    /refused/,
  );
  assert.equal(modes.selection(), 'low');
  reject = false;
  const writesAfterRefusal = calls.length;
  let started = false;
  await modes.startTurn(() => {
    started = true;
  });
  assert.equal(started, true);
  assert.equal(calls.length, writesAfterRefusal, 'an ordinary prompt must not retry Full access');
  assert.equal(modes.selection(), 'low');
});

test('Claude rechecks automatic grants after revocation and cancellation crosses the callback await', async () => {
  for (const tool of ['Bash', 'Edit']) {
    let level: Autonomy = tool === 'Bash' ? 'high' : 'low';
    let asked = 0;
    const callback = claudeCanUseTool(
      'chat',
      {
        requestApproval: async () => {
          asked += 1;
          return 'refuse';
        },
        requestQuestion: async () => ({ cancelled: true, answers: [] }),
        cancelPending: () => {},
        isActive: () => true,
      },
      () => false,
      () => level,
    );
    const abort = new AbortController();
    const options = { signal: abort.signal, toolUseID: 'tool', requestId: 'request' };
    const input = tool === 'Bash' ? { command: 'pwd' } : { file_path: 'file.ts' };
    const pending = callback(tool, input, options);
    level = 'off';
    assert.equal((await pending)?.behavior, 'deny');
    assert.equal(asked, 1);
    level = 'high';
    const cancelled = callback(tool, input, options);
    abort.abort();
    assert.equal((await cancelled)?.behavior, 'deny');
    assert.equal(asked, 1);
  }
});

test('Claude coalesces queued grants into the latest revocation before native dispatch', async () => {
  const calls: PermissionMode[] = [];
  let acceptMedium = () => {};
  let markMediumStarted = () => {};
  const medium = new Promise<void>((resolve) => {
    acceptMedium = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markMediumStarted = resolve;
  });
  let holdMedium = false;
  const query = {
    async setPermissionMode(mode: PermissionMode) {
      calls.push(mode);
      if (holdMedium && mode === 'auto') {
        markMediumStarted();
        await medium;
      }
    },
  };
  const modes = new ClaudePermissionModes(
    'off',
    false,
    () => undefined,
    async () => undefined,
    async () => undefined,
  );
  await modes.initialize(query);
  calls.length = 0;
  holdMedium = true;
  const mediumChange = modes.change(Promise.resolve(), { autonomy: 'medium' });
  await started;
  const high = modes.change(Promise.resolve(), { autonomy: 'high' });
  const off = modes.change(Promise.resolve(), { autonomy: 'off' });
  assert.equal(modes.selection(), 'off');
  let turns = 0;
  const turn = modes.startTurn(() => {
    assert.equal(calls.at(-1), 'default');
    turns += 1;
  });
  assert.equal(turns, 0);
  acceptMedium();
  await Promise.all([mediumChange, high, off, turn]);
  assert.deepEqual(calls, ['auto', 'default']);
  assert.equal(modes.selection(), 'off');
  assert.equal(turns, 1);
});

test('Claude retires an unsafe runtime when interruption fails or revocation stays refused', async () => {
  for (const interruptFails of [true, false]) {
    let closed = false;
    let nativeMode: PermissionMode = 'bypassPermissions';
    let interrupts = 0;
    const modes = new ClaudePermissionModes(
      'high',
      false,
      () => {
        if (closed) throw new Error('closed');
      },
      async () => {
        interrupts += 1;
        if (interruptFails) throw new Error('interrupt refused');
      },
      async () => {
        closed = true;
      },
    );
    const query = {
      async setPermissionMode(mode: PermissionMode) {
        if (mode === 'default') throw new Error('revocation refused');
        nativeMode = mode;
      },
    };
    await modes.initialize(query);
    await assert.rejects(
      modes.change(Promise.resolve(), { autonomy: 'off' }),
      /revocation refused/,
    );
    assert.equal(modes.selection(), 'off');
    assert.equal(closed, true);
    assert.equal(nativeMode, 'bypassPermissions');
    assert.ok(interrupts > 0);
    let turns = 0;
    await assert.rejects(
      modes.startTurn(() => {
        turns += 1;
      }),
      /closed/,
    );
    assert.equal(turns, 0);
  }
});

test('closing during the Auto probe prevents restoration and later publication', async () => {
  const calls: PermissionMode[] = [];
  let closed = false;
  const modes = new ClaudePermissionModes(
    'medium',
    false,
    () => {
      if (closed) throw new Error('closed');
    },
    async () => undefined,
    async () => undefined,
  );
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
      resumeId: 'provider-spec',
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
    () => 'high',
  );
  assert.equal(options.permissionMode, 'plan');
  assert.equal(options.resume, 'provider-spec');
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
    () => 'off',
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
