import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerEvent } from '../../protocol.js';
import { SessionVoice } from '../SessionVoice.js';
import { codexSession, fakeClient } from './codexTestSupport.js';

test('running Codex approvals grant only confirmed escalations, keep failed downgrades and serialize settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-permissions-'));
  const cwd = join(directory, 'workspace');
  mkdirSync(cwd);
  mkdirSync(join(cwd, '.git'));
  symlinkSync(directory, join(cwd, 'escape'));
  symlinkSync(join(directory, 'missing'), join(cwd, 'dangling'));
  const starts: Record<string, unknown>[] = [];
  const interrupted: unknown[] = [];
  const settingsWrites: Record<string, unknown>[] = [];
  let nativeSettings: Record<string, unknown> | undefined;
  let refuseHigh = false;
  let nextSettingsWrite:
    | {
        started: () => void;
        result: Promise<void>;
      }
    | undefined;
  const deferSettings = () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const result = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    nextSettingsWrite = { started: markStarted, result };
    return { started, resolve, reject };
  };
  let asked = 0;
  let turnNumber = 0;
  let markStarted: () => void = () => undefined;
  const { client, notifications, requests } = fakeClient((method, params) => {
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'thread/settings/update') {
      settingsWrites.push(params);
      const write = nextSettingsWrite;
      nextSettingsWrite = undefined;
      write?.started();
      return (write?.result ?? Promise.resolve()).then(() => {
        if (refuseHigh && params.approvalPolicy === 'never') throw new Error('refused');
        nativeSettings = params;
      });
    }
    if (method === 'thread/resume') {
      starts.push(params);
      return { thread: { id: 'thread-1' }, model: 'model' };
    }
    if (method !== 'turn/start') return undefined;
    starts.push(params);
    turnNumber += 1;
    markStarted();
    return { turn: { id: `turn-${String(turnNumber)}` } };
  });
  const session = codexSession(client, 'app-1', cwd, async () => {
    asked += 1;
    return 'cancel';
  });
  const voiceEvents: string[] = [];
  const unsubscribeVoice = session.voice.onEvent((event) => voiceEvents.push(event.kind));
  try {
    await session.open('thread-1');
    assert.equal(starts[0]?.approvalPolicy, 'untrusted');
    assert.equal(starts[0]?.sandbox, 'workspace-write');
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const stream = session.stream('edit');
    const first = stream.next();
    await started;
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-1' } });
    let itemNumber = 0;
    const approval = async (path: string, movePath?: string) => {
      const itemId = `edit-${++itemNumber}`;
      notifications.get('item/started')?.({
        threadId: 'thread-1',
        item: {
          type: 'fileChange',
          id: itemId,
          status: 'inProgress',
          changes: [
            { path, kind: { type: 'update', move_path: movePath ?? null }, diff: '+ edit' },
          ],
        },
      });
      return requests.get('item/fileChange/requestApproval')?.({
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId,
      });
    };
    assert.deepEqual(await approval('src/new.ts'), { decision: 'accept' });
    await first;
    await session.setAutonomy('off');
    assert.deepEqual(await approval('still-this-turn.ts'), { decision: 'cancel' });
    await session.setAutonomy('low');
    assert.deepEqual(await approval('accept-edits-now.ts'), { decision: 'accept' });
    for (const path of [
      '../outside',
      '.git/config',
      '.codex/config.toml',
      '.agents/rules',
      'escape/file',
      'escape/../beside-the-workspace',
      'dangling',
    ]) {
      assert.deepEqual(await approval(path), { decision: 'cancel' });
    }
    assert.deepEqual(await approval('inside.ts', '../renamed.ts'), { decision: 'cancel' });
    assert.deepEqual(
      await requests.get('item/commandExecution/requestApproval')?.({
        itemId: 'exec',
        command: 'pwd',
      }),
      { decision: 'cancel' },
    );
    assert.equal(asked, 10);
    refuseHigh = true;
    const rejectedEscalation = deferSettings();
    const writesBefore = settingsWrites.length;
    const rejected = session.setAutonomy('high');
    const refusal = assert.rejects(rejected, /refused/);
    const modelUpdate = session.setModel({ modelId: 'updated-model' });
    await rejectedEscalation.started;
    assert.equal(settingsWrites.length, writesBefore + 1);
    assert.deepEqual(await approval('../unconfirmed-full-access.ts'), { decision: 'cancel' });
    rejectedEscalation.reject(new Error('refused'));
    await refusal;
    await modelUpdate;
    assert.equal(nativeSettings?.model, 'updated-model');
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(nativeSettings?.sandboxPolicy, {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    assert.deepEqual(await approval('../rejected-full-access.ts'), { decision: 'cancel' });

    refuseHigh = false;
    const escalation = deferSettings();
    const raised = session.setAutonomy('high');
    await escalation.started;
    assert.deepEqual(await approval('../pending-full-access.ts'), { decision: 'cancel' });
    const asksBeforeFullAccess = asked;
    escalation.resolve();
    await raised;
    assert.deepEqual(await approval('../full-access.ts'), { decision: 'accept' });
    assert.deepEqual(
      await requests.get('item/commandExecution/requestApproval')?.({
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'exec-full',
        command: 'pwd',
      }),
      { decision: 'accept' },
    );
    assert.equal(asked, asksBeforeFullAccess);
    await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
    assert.equal(session.voice.isLive(), true);
    const downgrade = deferSettings();
    const lowered = session.setAutonomy('off');
    // Revocation precedes even the start of the queued native write.
    assert.deepEqual(await approval('pending-supervised.ts'), { decision: 'cancel' });
    await downgrade.started;
    downgrade.reject(new Error('refused'));
    await lowered;
    assert.deepEqual(interrupted, ['turn-1']);
    assert.equal(session.voice.isLive(), true);
    assert.deepEqual(voiceEvents, []);
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(await approval('failed-supervised.ts'), { decision: 'cancel' });
    await session.setModel({ reasoningEffort: 'high' });
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(nativeSettings?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    await stream.return(undefined);
  } finally {
    unsubscribeVoice();
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex skips queued High after Off, including behind a model write', async () => {
  const writes: Record<string, unknown>[] = [];
  let release = () => {};
  let markStarted = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let hold = false;
  const { client } = fakeClient(async (method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'thread/settings/update') {
      writes.push(params);
      if (hold) {
        hold = false;
        markStarted();
        await held;
      }
    }
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  writes.length = 0;
  hold = true;
  const medium = session.setAutonomy('medium');
  await started;
  assert.equal(session.autonomy, 'low');
  const model = session.setModel({ modelId: 'updated' });
  const high = session.setAutonomy('high');
  const off = session.setAutonomy('off');
  assert.equal(session.autonomy, 'off');
  release();
  await Promise.all([medium, model, high, off]);
  assert.ok(writes.every((params) => params.approvalPolicy !== 'never'));
  assert.deepEqual(writes.at(-1)?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.equal(writes.at(-1)?.model, 'updated');
  assert.equal(session.autonomy, 'off');
  await session.close();
});

test('Codex closes the provider runtime when a downgrade cannot be contained or applied', async () => {
  for (const interruptFails of [true, false]) {
    let refuseOff = false;
    let closes = 0;
    let turns = 0;
    let interrupts = 0;
    const { client, notifications } = fakeClient((method, params) => {
      if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
      if (method === 'thread/settings/update' && refuseOff && params.approvalPolicy === 'untrusted')
        throw new Error('revocation refused');
      if (method === 'turn/interrupt') {
        interrupts += 1;
        if (interruptFails) throw new Error('interrupt refused');
      }
      if (method === 'turn/start') turns += 1;
    });
    client.close = async () => {
      closes += 1;
    };
    const session = codexSession(client, 'app-1');
    await session.open();
    await session.setAutonomy('high');
    await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'spoken-1' } });
    refuseOff = true;
    await assert.rejects(
      session.setAutonomy('off'),
      interruptFails ? /closed/ : /revocation refused/,
    );
    assert.equal(closes, 1);
    assert.equal(session.isClosed, true);
    assert.equal(session.autonomy, 'off');
    assert.ok(interrupts > 0);
    await session.closed;
    const next = session.stream('blocked');
    await assert.rejects(next.next());
    assert.equal(turns, 0);
  }
});

test('Codex stops a downgrade only when the running turn bypasses approval callbacks', async () => {
  for (const level of ['low', 'medium', 'high'] as const) {
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const starts: Record<string, unknown>[] = [];
    let interrupts = 0;
    let refuseInterrupt = level === 'high';
    const { client, notifications } = fakeClient((method, params) => {
      if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
      if (method === 'turn/interrupt') {
        if (refuseInterrupt) {
          refuseInterrupt = false;
          throw new Error('interrupt refused');
        }
        interrupts += 1;
        notifications.get('turn/completed')?.({
          threadId: 'thread-1',
          turn: { id: 'turn-1', status: 'interrupted' },
        });
      }
      if (method !== 'turn/start') return;
      starts.push(params);
      markStarted();
      const id = `turn-${starts.length}`;
      if (starts.length > 1)
        notifications.get('turn/completed')?.({
          threadId: 'thread-1',
          turn: { id, status: 'completed' },
        });
      return { turn: { id } };
    });
    const session = codexSession(client, 'app-1');
    await session.open();
    await session.setAutonomy(level);
    const rows: string[] = [];
    const running = (async () => {
      for await (const event of session.stream('work'))
        if (event.transcript?.kind === 'status') rows.push(event.transcript.text ?? '');
    })();
    await started;
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-1' } });
    // A later thread escalation does not change the running turn's own policy.
    if (level === 'low') await session.setAutonomy('high');
    // A failed Stop denied callbacks but did not revoke native permissions.
    if (level === 'high') await assert.rejects(session.interrupt(), /interrupt refused/);
    await session.setAutonomy('off');
    assert.equal(interrupts, level === 'low' ? 0 : 1);
    assert.deepEqual(
      rows,
      level === 'low'
        ? []
        : ["Stopped the turn to apply off: Codex keeps a turn's permissions until it ends"],
    );
    if (level === 'low')
      notifications.get('turn/completed')?.({
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed' },
      });
    await running;
    for await (const event of session.stream('continue')) assert.equal(event.done, true);
    assert.equal(starts.at(-1)?.approvalPolicy, 'untrusted');
    assert.deepEqual(starts.at(-1)?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    await session.close();
  }
});

test('Codex keeps voice live and contains old-policy spoken turns arriving after a downgrade ack', async () => {
  const interrupted: unknown[] = [];
  let voiceStops = 0;
  const rows: string[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'thread/realtime/stop') voiceStops += 1;
  });
  const session = codexSession(client, 'app-1');
  session.onBackgroundEvent((event) => {
    if (event.transcript?.kind === 'status') rows.push(event.transcript.text ?? '');
  });
  try {
    await session.open();
    await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
    await session.setAutonomy('off');
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'callback-turn' } });
    assert.deepEqual(interrupted, []);
    assert.equal(session.voice.isLive(), true);
    notifications.get('turn/completed')?.({
      threadId: 'thread-1',
      turn: { id: 'callback-turn', status: 'completed' },
    });
    await session.setAutonomy('high');
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'spoken-1' } });
    await session.setAutonomy('off');
    assert.equal(session.autonomy, 'off');
    notifications.get('turn/completed')?.({
      threadId: 'thread-1',
      turn: { id: 'spoken-1', status: 'interrupted' },
    });
    // Its policy was captured before the update; the notification arrives after the ack.
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'late-spoken' } });
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'late-spoken' } });
    assert.deepEqual(interrupted, ['spoken-1', 'late-spoken']);
    assert.deepEqual(rows, [
      "Stopped the turn to apply off: Codex keeps a turn's permissions until it ends",
      "Stopped the turn to apply off: Codex keeps a turn's permissions until it ends",
    ]);
    assert.equal(session.voice.isLive(), true);
    assert.equal(voiceStops, 0);
  } finally {
    await session.close();
  }
});

test('Codex applies the voice ceiling to a Low typed turn and a later spoken turn', async (t) => {
  const interrupted: unknown[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'turn/start') {
      assert.equal(params.approvalPolicy, 'untrusted');
      notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'typed-turn' } });
      notifications.get('item/agentMessage/delta')?.({
        threadId: 'thread-1',
        itemId: 'typed-answer',
        delta: 'Working',
      });
      return { turn: { id: 'typed-turn' } };
    }
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
  const events = session.stream('typed work');
  t.after(() => events.return(undefined));
  assert.equal((await events.next()).value?.transcript?.text, 'Working');
  await session.setAutonomy('high');
  await session.setAutonomy('off');
  assert.deepEqual(interrupted, ['typed-turn'], 'the voice ceiling also contains typed turns');

  for (let notification = 0; notification < 2; notification += 1)
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'late-spoken' } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(interrupted, ['typed-turn', 'late-spoken']);
  assert.equal(session.voice.isLive(), true);
  assert.equal(session.isClosed, false);
  notifications.get('turn/completed')?.({
    threadId: 'thread-1',
    turn: { id: 'late-spoken', status: 'interrupted' },
  });
  notifications.get('turn/completed')?.({
    threadId: 'thread-1',
    turn: { id: 'typed-turn', status: 'completed' },
  });
  let typedCompleted = false;
  for await (const event of events) if (event.done) typedCompleted = true;
  assert.equal(typedCompleted, true, 'typed completion must still settle its stream');
  assert.deepEqual(interrupted, ['typed-turn', 'late-spoken']);
});

test('Codex contains a delayed High voice handoff adopted by a Low typed start', async (t) => {
  const interrupted: unknown[] = [];
  let releaseStart = () => {};
  const startReply = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let markStarting = () => {};
  const starting = new Promise<void>((resolve) => {
    markStarting = resolve;
  });
  const { client, notifications } = fakeClient(async (method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'turn/start') {
      assert.equal(params.approvalPolicy, 'untrusted');
      assert.deepEqual(params.sandboxPolicy, {
        type: 'workspaceWrite',
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      });
      // The handoff bound High before the downgrade; turn/start steers into it.
      notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'late-spoken' } });
      markStarting();
      await startReply;
      return { turn: { id: 'late-spoken' } };
    }
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  await session.setAutonomy('high');
  await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
  await session.setAutonomy('low');
  const events = session.stream('typed work');
  const first = events.next();
  t.after(async () => {
    releaseStart();
    await session.close();
    await Promise.allSettled([first]);
    await events.return(undefined);
  });
  await starting;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(interrupted, ['late-spoken'], 'contain before the typed start reply arrives');
  releaseStart();
  assert.match((await first).value?.transcript?.text ?? '', /Stopped the turn to apply low/);
  assert.deepEqual(interrupted, ['late-spoken']);
  assert.equal(session.autonomy, 'low');
  assert.equal(session.voice.isLive(), true);
  assert.equal(session.isClosed, false);
});

test('Codex recovery keeps voice live and interrupts only callback-bypassing turns', async (t) => {
  for (const recovery of ['refused downgrade', 'obsolete grant'] as const) {
    await t.test(recovery, async (t) => {
      const writes: Record<string, unknown>[] = [];
      const interrupted: unknown[] = [];
      const voiceEvents: string[] = [];
      let releaseWrite = () => {};
      const heldWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      let markWriting = () => {};
      const writing = new Promise<void>((resolve) => {
        markWriting = resolve;
      });
      let recovering = false;
      const { client, notifications } = fakeClient(async (method, params) => {
        if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
        if (method === 'turn/interrupt') interrupted.push(params.turnId);
        if (method === 'thread/settings/update' && recovering) {
          writes.push(params);
          if (writes.length === 1) {
            markWriting();
            await heldWrite;
            if (recovery === 'refused downgrade') throw new Error('revocation refused');
          }
        }
      });
      const session = codexSession(client, 'app-1');
      t.after(() => {
        releaseWrite();
        return session.close();
      });
      await session.open();
      await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
      session.voice.onEvent((event) => voiceEvents.push(event.kind));
      notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'spoken-1' } });
      recovering = true;
      const update = session.setAutonomy(recovery === 'refused downgrade' ? 'off' : 'high');
      await writing;
      const off = session.setAutonomy('off');
      releaseWrite();
      await Promise.all([update, off]);

      assert.equal(writes.length, 2, 'recovery must apply the latest choice');
      assert.equal(writes[0].approvalPolicy, recovery === 'obsolete grant' ? 'never' : 'untrusted');
      assert.deepEqual(writes.at(-1)?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
      assert.equal(session.autonomy, 'off');
      assert.equal(session.isClosed, false);
      assert.equal(session.voice.isLive(), true, 'recovery must preserve the conversation');
      assert.deepEqual(voiceEvents, [], 'recovery must not publish a voice close');
      assert.deepEqual(interrupted, recovery === 'obsolete grant' ? ['spoken-1'] : []);
    });
  }
});

test('Codex disarms a failed escalation before an ordinary turn', async () => {
  let refuseHigh = true;
  const policies: unknown[] = [];
  let turnPolicy: unknown;
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'thread/settings/update') {
      policies.push(params.approvalPolicy);
      if (refuseHigh && params.approvalPolicy === 'never') throw new Error('escalation refused');
    }
    if (method === 'turn/start') {
      turnPolicy = params.approvalPolicy;
      notifications.get('turn/completed')?.({
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed' },
      });
      return { turn: { id: 'turn-1' } };
    }
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  await assert.rejects(session.setAutonomy('high'), /escalation refused/);
  const writesAfterRefusal = policies.length;
  refuseHigh = false;
  for await (const event of session.stream('continue')) assert.equal(event.done, true);
  assert.equal(turnPolicy, 'untrusted');
  assert.equal(policies.length, writesAfterRefusal);
  assert.equal(session.autonomy, 'low');
  await session.close();
});

test('Codex contains a downgrade during turn start and closes if interruption fails', async () => {
  for (const interruptFails of [false, true]) {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const policies: unknown[] = [];
    let interrupts = 0;
    let closes = 0;
    const { client, notifications } = fakeClient(async (method, params) => {
      if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
      if (method === 'thread/settings/update') policies.push(params.approvalPolicy);
      if (method === 'turn/interrupt') {
        interrupts += 1;
        if (interruptFails) throw new Error('interrupt refused');
      }
      if (method === 'turn/start') {
        markStarted();
        await held;
        return { turn: { id: 'turn-1' } };
      }
    });
    client.close = async () => {
      closes += 1;
    };
    const session = codexSession(client, 'app-1');
    await session.open();
    await session.setAutonomy('high');
    policies.length = 0;
    const stream = session.stream('work');
    const first = stream.next();
    const firstSettled = interruptFails ? assert.rejects(first, /closed/) : first;
    await started;
    const off = session.setAutonomy('off');
    const settled = interruptFails ? assert.rejects(off, /closed/) : off;
    assert.equal(session.autonomy, 'off');
    assert.equal(policies.length, 0, 'revocation waits for the running turn to be contained');
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-1' } });
    await settled;
    assert.equal(interrupts, 1);
    assert.equal(closes, interruptFails ? 1 : 0);
    assert.deepEqual(policies, interruptFails ? [] : ['untrusted']);
    release();
    await firstSettled;
    if (!interruptFails)
      assert.match((await first).value?.transcript?.text ?? '', /Stopped the turn to apply off/);
    await stream.return(undefined);
    if (interruptFails) await assert.rejects(session.stream('blocked').next(), /closed/);
    await session.close();
  }
});

test('closing a Codex voice session proceeds when its stop misses the deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'warn', () => undefined);
  let releaseStop = () => {};
  const heldStop = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  let markStopping = () => {};
  const stopping = new Promise<void>((resolve) => {
    markStopping = resolve;
  });
  let closes = 0;
  const { client } = fakeClient((method) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'thread/realtime/stop') {
      markStopping();
      return heldStop;
    }
  });
  client.close = async () => {
    closes += 1;
  };
  const session = codexSession(client, 'app-1');
  const emitted: ServerEvent[] = [];
  const relay = new SessionVoice({
    liveSession: () => session,
    emit: (event) => emitted.push(event),
    appendTranscript: () => undefined,
    ensureRunning: async () => undefined,
    liveChanged: () => undefined,
  });
  try {
    await session.open();
    await relay.handle({
      type: 'voice.start',
      appSessionId: 'app-1',
      sdp: 'offer',
      attempt: 'voice-1',
    });
    const closing = (async () => {
      await relay.closeSession('app-1');
      await session.close();
    })();
    await stopping;
    assert.equal(closes, 0, 'runtime cleanup waits for the voice stop');
    t.mock.timers.tick(3_000);
    await closing;
    assert.equal(session.isClosed, true);
    assert.equal(closes, 1);
    assert.equal(session.voice.isLive(), false);
    assert.deepEqual(emitted, [{ type: 'voice.state', appSessionId: 'app-1', status: 'closed' }]);
    await session.closed;
  } finally {
    releaseStop();
    await session.close();
  }
});

test('Codex contains a handoff bound after a refused hang-up and a later escalation', async () => {
  const interrupted: unknown[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'thread/realtime/stop') throw new Error('stop refused');
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
  // Codex refused the stop, so it still holds the conversation.
  await session.voice.stop().catch(() => undefined);
  await session.setAutonomy('high');
  notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'handoff-high' } });
  await session.setAutonomy('off');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(interrupted, ['handoff-high']);
  await session.close();
});
