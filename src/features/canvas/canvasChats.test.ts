import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasClient } from './client';
import { canvasIntentForDraft } from './canvasChatIntent';
import { bridge as sessionBridge } from '../../lib/bridge';
import { createSession } from '../../lib/commands';
import type { ClientCommand } from '../../types/bridge';
import {
  acknowledgeAttachment,
  attachCanvasToChat,
  chooseCanvasForChat,
  owedAttachment,
  recentAttachedChat,
  searchCanvases,
} from './canvasChats';
import { fakeCanvasBridge, flush } from '../../test/canvasTransport';
import type { CanvasSummary } from './protocol';

type Bridge = ReturnType<typeof fakeCanvasBridge>;

function summary(canvasId: string, fields: Partial<CanvasSummary> = {}): CanvasSummary {
  return {
    canvasId,
    name: canvasId,
    updatedAt: 0,
    designCount: 0,
    attachedAppSessionIds: [],
    ...fields,
  };
}

function lastCreate(bridge: Bridge) {
  const command = bridge.last('canvas.createCanvas');
  assert.ok(command.type === 'canvas.createCanvas');
  return command;
}

function lastAttach(bridge: Bridge) {
  const command = bridge.last('canvas.attach');
  assert.ok(command.type === 'canvas.attach');
  return command;
}

function answer(
  bridge: Bridge,
  requestId: string,
  canvasId: string,
  attachedCanvasId: string | null = canvasId,
): void {
  const command = bridge.sent.find((sent) => sent.requestId === requestId);
  assert.ok(command);

  bridge.deliver({
    type: 'canvas.result',
    requestId,
    ok: true,
    reply:
      command.type === 'canvas.createCanvas'
        ? { kind: 'canvasCreated', canvasId, attachedCanvasId }
        : { kind: 'attachment', canvasId },
  });
}

function refuse(bridge: Bridge, requestId: string, message: string): void {
  bridge.deliver({
    type: 'canvas.result',
    requestId,
    ok: false,
    error: { code: 'storage_failed', message },
  });
}

test('explicit pane creation mints a canvas for its chat, and another chat mints another', async () => {
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);

  const first = attachCanvasToChat(client, 'session-a', { canvasId: null, name: 'Pricing card' });
  await flush();
  const created = lastCreate(bridge);
  assert.equal(created.appSessionId, 'session-a');
  // The explicit name reaches the sidecar create request.
  assert.equal(created.name, 'Pricing card');
  answer(bridge, created.requestId, 'canvas-a');
  assert.equal(await first, 'canvas-a');
  acknowledgeAttachment('session-a');

  // Explicit creation in another chat owns a distinct canvas.
  const second = attachCanvasToChat(client, 'session-b', { canvasId: null });
  await flush();
  const again = lastCreate(bridge);
  assert.notEqual(again.mutationId, created.mutationId);
  assert.equal(again.name, undefined);
  answer(bridge, again.requestId, 'canvas-b');
  assert.equal(await second, 'canvas-b');
  acknowledgeAttachment('session-b');
  assert.equal(bridge.count('canvas.createCanvas'), 2);
});

test('a create that failed retries under its own mutation id, so it cannot mint twice', async () => {
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);

  const lost = attachCanvasToChat(client, 'session-a', { canvasId: null });
  await flush();
  const created = lastCreate(bridge);
  refuse(bridge, created.requestId, 'Canvas could not be saved.');
  await assert.rejects(lost);

  // The chat still owes this create, and the failure is what the pane shows.
  assert.deepEqual(owedAttachment('session-a'), {
    canvasId: null,
    message: 'Canvas could not be saved.',
  });

  const retried = attachCanvasToChat(client, 'session-a', { canvasId: null });
  await flush();
  const replay = lastCreate(bridge);
  assert.equal(replay.mutationId, created.mutationId);
  answer(bridge, replay.requestId, 'canvas-a');
  assert.equal(await retried, 'canvas-a');
  acknowledgeAttachment('session-a');
  assert.equal(owedAttachment('session-a'), null);
});

test('a retried create settles the current attachment after its chat moves or detaches', async () => {
  for (const attachedCanvasId of ['canvas-current', null]) {
    const bridge = fakeCanvasBridge();
    const client = new CanvasClient(bridge.transport);
    const lost = attachCanvasToChat(client, 'session-a', { canvasId: null });
    const first = lastCreate(bridge);
    refuse(bridge, first.requestId, 'Canvas reply was lost.');
    await assert.rejects(lost);

    const retried = attachCanvasToChat(client, 'session-a', { canvasId: null });
    const replay = lastCreate(bridge);
    assert.equal(replay.mutationId, first.mutationId);
    answer(bridge, replay.requestId, 'canvas-created', attachedCanvasId);
    assert.equal(await retried, attachedCanvasId);
    assert.equal(
      await attachCanvasToChat(client, 'session-a', { canvasId: null }),
      attachedCanvasId,
    );
    assert.equal(owedAttachment('session-a'), null);
    assert.equal(bridge.count('canvas.createCanvas'), 2);
    assert.equal(bridge.count('canvas.attach'), 0);
    acknowledgeAttachment('session-a');
  }
});

test('callers that join an unfinished create share it instead of minting another', async () => {
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);

  // Concurrent pane actions and a remount ask for the same chat's
  // canvas while the first request is still in flight.
  const first = attachCanvasToChat(client, 'session-a', { canvasId: null });
  const replayed = attachCanvasToChat(client, 'session-a', { canvasId: null });
  await flush();
  assert.equal(bridge.count('canvas.createCanvas'), 1);
  const created = lastCreate(bridge);
  answer(bridge, created.requestId, 'canvas-a');
  assert.deepEqual(await Promise.all([first, replayed]), ['canvas-a', 'canvas-a']);

  // The result is retained until a caller acknowledges it, so a pane that
  // remounts after the reply settles from it rather than creating again.
  assert.equal(await attachCanvasToChat(client, 'session-a', { canvasId: null }), 'canvas-a');
  assert.equal(bridge.count('canvas.createCanvas'), 1);
  acknowledgeAttachment('session-a');
});

test('session creation forwards manually assembled canvas intent', () => {
  const sent: ClientCommand[] = [];
  const original = sessionBridge.send;
  sessionBridge.send = (command) => {
    sent.push(command);
  };
  try {
    for (const [clientRef, canvasId] of [
      ['design-a', null],
      ['design-b', null],
      ['saved', 'canvas-a'],
    ] as const) {
      createSession({
        clientRef,
        title: 'Pricing',
        goal: 'Pricing card.',
        sessionPurpose: 'chat',
        autonomy: 'low',
        canvas: canvasIntentForDraft({ canvasId }, 'Pricing card.', clientRef),
      });
    }
    assert.deepEqual(
      sent.map((command) => {
        assert.equal(command.type, 'session.create');
        if (command.type !== 'session.create') throw new Error('Expected session create');
        return command.canvas;
      }),
      [
        { canvasId: null, name: 'Pricing card', mutationId: 'design-a' },
        { canvasId: null, name: 'Pricing card', mutationId: 'design-b' },
        { canvasId: 'canvas-a', mutationId: 'saved' },
      ],
    );
    assert.equal(
      sent.some((command) => command.type === 'canvas.createCanvas'),
      false,
    );
    assert.equal(canvasIntentForDraft(null, 'ordinary chat', 'ordinary'), undefined);
  } finally {
    sessionBridge.send = original;
  }
});

test('attaching an existing chat uses the named canvas and mints nothing', async () => {
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);
  const attaching = attachCanvasToChat(client, 'session-b', { canvasId: 'canvas-a' });
  await flush();
  const attach = lastAttach(bridge);
  assert.deepEqual(
    { appSessionId: attach.appSessionId, canvasId: attach.canvasId },
    { appSessionId: 'session-b', canvasId: 'canvas-a' },
  );
  answer(bridge, attach.requestId, 'canvas-a');
  assert.equal(await attaching, 'canvas-a');
  acknowledgeAttachment('session-b');
  assert.equal(bridge.count('canvas.createCanvas'), 0);
});

test('a failed attach keeps its target, and only the user may retarget it', async () => {
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);

  const failing = attachCanvasToChat(client, 'session-b', { canvasId: 'canvas-a' });
  await flush();
  refuse(bridge, lastAttach(bridge).requestId, 'Canvas storage is unavailable.');
  await assert.rejects(failing);
  assert.deepEqual(owedAttachment('session-b'), {
    canvasId: 'canvas-a',
    message: 'Canvas storage is unavailable.',
  });

  // Try again replays that same attach; it never falls back to a new canvas.
  const retried = attachCanvasToChat(client, 'session-b', { canvasId: null });
  await flush();
  assert.equal(lastAttach(bridge).canvasId, 'canvas-a');
  refuse(bridge, lastAttach(bridge).requestId, 'Canvas storage is unavailable.');
  await assert.rejects(retried);
  assert.equal(bridge.count('canvas.createCanvas'), 0);

  // Choosing another canvas is the one thing that replaces it.
  const chosen = chooseCanvasForChat(client, 'session-b', 'canvas-c');
  await flush();
  assert.equal(lastAttach(bridge).canvasId, 'canvas-c');
  answer(bridge, lastAttach(bridge).requestId, 'canvas-c');
  assert.equal(await chosen, 'canvas-c');
  acknowledgeAttachment('session-b');
});

test('a provisional canvas name is the prompt, trimmed, or nothing', () => {
  const name = (prompt: string) =>
    canvasIntentForDraft({ canvasId: null }, prompt, 'name-test')?.name ?? null;
  assert.equal(name('A pricing card with three tiers.'), 'A pricing card with three tiers');
  assert.equal(name('  Settings page\nwith a theme toggle  '), 'Settings page');
  assert.equal(name('A pricing card\u001b[0m with tiers'), 'A pricing card [0m with tiers');
  assert.equal(name('   '), null);
  const long = name(`${'word '.repeat(40)}end`);
  assert.ok(long && long.length <= 120, 'a long prompt is cut to the sidecar name limit');
  assert.ok(!long.endsWith(' '), 'the cut lands on a word boundary');
});

test('the canvases list reads newest edit first and narrows by name', () => {
  const canvases = [
    summary('cv_old', { name: 'Pricing', updatedAt: 10 }),
    summary('cv_new', { name: 'Settings page', updatedAt: 30 }),
    summary('cv_mid', { name: 'Pricing cards', updatedAt: 20 }),
  ];
  assert.deepEqual(
    searchCanvases(canvases, '').map((entry) => entry.canvasId),
    ['cv_new', 'cv_mid', 'cv_old'],
  );
  assert.deepEqual(
    searchCanvases(canvases, '  PRICING ').map((entry) => entry.canvasId),
    ['cv_mid', 'cv_old'],
  );
  assert.deepEqual(searchCanvases(canvases, 'nothing'), []);
});

test('a canvas card opens through the most recent of its chats this window holds', () => {
  const shared = summary('cv_01', { attachedAppSessionIds: ['session-a', 'session-b'] });
  const loaded: Record<string, number> = { 'session-a': 5, 'session-b': 9 };
  assert.equal(
    recentAttachedChat(shared, (id) => loaded[id]),
    'session-b',
  );
  // Another window's chats are not reachable from here, so the card has to
  // start a fresh chat on the same canvas instead.
  assert.equal(
    recentAttachedChat(shared, () => undefined),
    null,
  );
  assert.equal(
    recentAttachedChat(summary('cv_02'), (id) => loaded[id]),
    null,
  );
});
