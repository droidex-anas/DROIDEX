import assert from 'node:assert/strict';
import test from 'node:test';
import { asChunkedSequence } from '../../lib/chunkedSequence';
import type { TranscriptEvent } from '../../types/bridge';
import {
  canvasPresence,
  NO_PRESENCE,
  samePresence,
  type CanvasPresence,
  type PresenceSources,
} from './canvasPresence';

let seq = 0;

function ev(extra: Partial<TranscriptEvent>): TranscriptEvent {
  seq += 1;
  return {
    id: `e${String(seq)}`,
    appSessionId: 'chat',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: seq,
    kind: 'text',
    ...extra,
  };
}

function prompt(steered?: true): TranscriptEvent {
  return ev({ sourceSessionId: 'user', author: 'user', text: 'Design it', steered });
}

type Action = 'create' | 'write';

/** A canvas call by the chat itself, or by the child named. */
function call(toolUseId: string, action: Action, designIds: string[], child?: string) {
  return ev({
    ...from(child),
    kind: 'tool_call',
    toolUseId,
    canvasActivity: { toolUseId, action, designIds, state: 'running', message: '' },
  });
}

function result(toolUseId: string, action: Action, designIds: string[], child?: string) {
  return ev({
    ...from(child),
    kind: 'tool_result',
    toolUseId,
    canvasActivity: { toolUseId, action, designIds, state: 'completed', message: '' },
  });
}

function from(child: string | undefined): Partial<TranscriptEvent> {
  return child ? { sourceSessionId: child, role: 'worker' } : {};
}

const designed = (designId: string) => ({ designId, revisionId: 'rev_1' });
const reserved = (designId: string) => ({ designId, revisionId: null });

function sources(
  events: TranscriptEvent[],
  live: { primary?: boolean; children?: string[] } = { primary: true },
): PresenceSources {
  return {
    appSessionId: 'chat',
    events,
    primaryLive: live.primary ?? false,
    liveChildren: new Set(live.children),
  };
}

test('a running create or write puts its agent on the frames it names until its result', () => {
  const frames = [designed('a'), designed('b')];
  const writing = [prompt(), call('t1', 'write', ['a']), call('t2', 'write', ['gone'])];
  const presence = canvasPresence(sources(writing), frames);

  assert.deepEqual([...presence.keys()], ['a']);
  assert.equal(presence.get('a')?.agent.key, 'chat');
  assert.equal(presence.get('a')?.named, true);
  assert.equal(canvasPresence(sources([...writing, result('t1', 'write', ['a'])]), frames).size, 0);
  // A settled chat has no one at work, whatever its transcript left open.
  assert.equal(canvasPresence(sources(writing, { primary: false }), frames), NO_PRESENCE);
});

test('a frame with no source yet belongs to the live agent whose create made it this turn', () => {
  const frames = [reserved('mine'), reserved('theirs'), reserved('left')];
  const events = [
    prompt(),
    call('t1', 'create', []),
    result('t1', 'create', ['mine']),
    call('t2', 'create', [], 'w1'),
    result('t2', 'create', ['theirs'], 'w1'),
  ];
  const keys = (presence: CanvasPresence) =>
    [...presence].map(([designId, worker]) => [designId, worker.agent.key]);

  const both = canvasPresence(sources(events, { primary: true, children: ['w1'] }), frames);
  // The frame an earlier turn left empty is no one's.
  assert.deepEqual(keys(both), [
    ['mine', 'chat'],
    ['theirs', 'chat/w1'],
  ]);
  assert.equal(both.get('mine')?.named, false);
  // The worker that made it is done, so its frame is not being written, even
  // while the chat's own turn runs on.
  const workerDone = canvasPresence(sources(events, { primary: true }), frames);
  assert.deepEqual(keys(workerDone), [['mine', 'chat']]);
  // A turn that never touches the canvas paints no frame.
  assert.equal(canvasPresence(sources([prompt()]), frames).size, 0);
  // A create names its frames only in its result, so until then the empty
  // frames no one made are its agent's.
  const creating = [prompt(), call('t3', 'create', [], 'w1')];
  const early = canvasPresence(sources(creating, { primary: true, children: ['w1'] }), frames);
  assert.deepEqual(keys(early), [
    ['mine', 'chat/w1'],
    ['theirs', 'chat/w1'],
    ['left', 'chat/w1'],
  ]);
});

test('only the current turn counts, and a steer does not start a new one', () => {
  const frames = [designed('a'), designed('b')];
  const interrupted = [prompt(), call('t1', 'write', ['a'])];

  assert.equal(canvasPresence(sources([...interrupted, prompt()]), frames).size, 0);
  const steered = canvasPresence(sources([...interrupted, prompt(true)]), frames);
  assert.deepEqual([...steered.keys()], ['a']);
});

test('a turn is read whole across the chunks the store keeps a transcript in', () => {
  const frames = [designed('a'), designed('b'), designed('c')];
  const talk = () => ev({ text: 'word' });
  const events = [
    call('t0', 'write', ['c']),
    prompt(),
    talk(),
    call('t1', 'write', ['a']),
    talk(),
    talk(),
    talk(),
    call('t2', 'write', ['b']),
    talk(),
  ];
  const presence = canvasPresence(sources(asChunkedSequence(events, 3)), frames);
  assert.deepEqual([...presence.keys()].sort(), ['a', 'b']);
});

test('each agent keeps one look, distinct from every other agent on the board', () => {
  const frames = [designed('a'), designed('b'), designed('c')];
  const alone = [prompt(), call('t1', 'write', ['a'], 'w1')];
  const joined = [...alone, call('t2', 'write', ['b'], 'w2'), call('t3', 'write', ['c'])];
  const live = { primary: true, children: ['w1', 'w2'] };

  const first = canvasPresence(sources(alone, live), frames).get('a');
  const all = canvasPresence(sources(joined, live), frames);
  // Joining agents never restyle the one already working.
  assert.deepEqual(all.get('a'), first);
  const agents = [...all.values()].map((worker) => worker.agent);
  assert.equal(new Set(agents.map((agent) => agent.name)).size, 3);
  assert.equal(new Set(agents.map((agent) => agent.color)).size, 3);
  assert.ok(samePresence(all, canvasPresence(sources(joined, live), frames)));
});
