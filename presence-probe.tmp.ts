// Throwaway: the presence selector's cost per store update, at 4 and 16 agents.
import { performance } from 'node:perf_hooks';
import { initialState, reducer, type AppState } from './src/hooks/useStore';
import { childSessionIsLive } from './src/lib/childSessions';
import { sessionIsLive } from './src/lib/sessions';
import type { TranscriptEvent } from './src/types/bridge';
import { canvasPresence, samePresence } from './src/features/canvas/canvasPresence';

const CHAT = 'chat';
const NO_EVENTS: TranscriptEvent[] = [];

// The same body as useCanvasPresence's selector.
function selector(appSessionId: string, frames: { designId: string; revisionId: string | null }[]) {
  return (state: AppState) => {
    const session = Object.hasOwn(state.sessions, appSessionId) ? state.sessions[appSessionId] : undefined;
    const children = state.childSessions[appSessionId] ?? {};
    const runtime = state.childRuntime[appSessionId] ?? {};
    const liveChildren = new Set(
      Object.keys(children).filter((id) => childSessionIsLive(children[id], runtime[id])),
    );
    return canvasPresence(
      {
        appSessionId,
        events: state.transcripts[appSessionId] ?? NO_EVENTS,
        primaryLive: session ? sessionIsLive(session) : false,
        liveChildren,
      },
      frames as never,
    );
  };
}

let seq = 0;
function ev(fields: Partial<TranscriptEvent>): TranscriptEvent {
  seq += 1;
  return { id: `e${seq}`, appSessionId: CHAT, sourceSessionId: 'p', role: 'primary', ts: seq, kind: 'text', ...fields };
}
const from = (child: string | null) => (child ? { sourceSessionId: child, role: 'worker' as const } : {});

function run(agents: number, history = 0) {
  const children = Array.from({ length: agents - 1 }, (_, i) => `w${i + 1}`);
  let state: AppState = {
    ...initialState,
    sessions: { [CHAT]: { appSessionId: CHAT, phase: 'executing', streaming: true } as never, other: { appSessionId: 'other', phase: 'executing', streaming: true } as never },
    childSessions: { [CHAT]: Object.fromEntries(children.map((id) => [id, { childSessionId: id, status: 'running' }])) } as never,
    childRuntime: { [CHAT]: Object.fromEntries(children.map((id) => [id, { available: true, runtimeGeneration: 1 }])) } as never,
  };
  const append = (event: TranscriptEvent) => {
    state = reducer(state, { type: 'SESSION_TRANSCRIPT', event });
  };
  for (let earlier = 0; earlier < history; earlier += 1) {
    if (earlier % 30 === 0) append(ev({ author: 'user', sourceSessionId: 'user', text: 'Earlier' }));
    else append(ev({ kind: earlier % 2 ? 'tool_call' : 'tool_result', toolName: 'Read', toolUseId: `h${Math.floor(earlier / 2)}` }));
  }
  append(ev({ author: 'user', sourceSessionId: 'user', text: 'Design it' }));
  const frames: { designId: string; revisionId: string | null }[] = [];
  const sources = [null, ...children];
  for (const [index, child] of sources.entries()) {
    const designId = `d${index}`;
    frames.push({ designId, revisionId: index % 2 ? 'rev_1' : null });
    // Each agent talks, runs a few tools, makes its frame and starts writing it.
    for (let tool = 0; tool < 10; tool += 1) {
      const id = `${index}-t${tool}`;
      append(ev({ ...from(child), kind: 'tool_call', toolName: 'Read', toolUseId: id }));
      append(ev({ ...from(child), kind: 'tool_result', toolUseId: id, text: 'ok' }));
      for (let d = 0; d < 20; d += 1)
        append(ev({ ...from(child), text: 'word ', textUpdate: { messageId: `${index}-m${tool}`, kind: 'delta' } }));
    }
    append(ev({ ...from(child), kind: 'tool_call', toolUseId: `${index}-c`, canvasActivity: { toolUseId: `${index}-c`, action: 'create', designIds: [], state: 'running', message: '' } }));
    append(ev({ ...from(child), kind: 'tool_result', toolUseId: `${index}-c`, canvasActivity: { toolUseId: `${index}-c`, action: 'create', designIds: [designId], state: 'completed', message: '' } }));
    if (index % 2) append(ev({ ...from(child), kind: 'tool_call', toolUseId: `${index}-w`, canvasActivity: { toolUseId: `${index}-w`, action: 'write', designIds: [designId], state: 'running', message: '' } }));
  }
  const select = selector(CHAT, frames);
  let previous = select(state);
  const own: number[] = [];
  const unrelated: number[] = [];
  let changes = 0;
  for (let token = 0; token < 1000; token += 1) {
    const mine = token % 2 === 0;
    const child = sources[token % sources.length];
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: mine
        ? ev({ ...from(child), text: `tok${token} `, textUpdate: { messageId: `stream-${child ?? 'p'}`, kind: 'delta' } })
        : ev({ appSessionId: 'other', text: `tok${token} `, textUpdate: { messageId: 'o', kind: 'delta' } }),
    });
    const start = performance.now();
    const next = select(state);
    const same = samePresence(previous, next);
    const ms = performance.now() - start;
    (mine ? own : unrelated).push(ms * 1000);
    if (!same) changes += 1;
    else previous = previous;
    if (!same) previous = next;
  }
  const stats = (list: number[]) => {
    const sorted = [...list].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
    return `median ${q(0.5)} µs, p95 ${q(0.95)} µs, max ${sorted.at(-1)!.toFixed(1)} µs`;
  };
  {
    const events = state.transcripts[CHAT];
    const live = new Set(children);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i += 1) canvasPresence({ appSessionId: CHAT, events, primaryLive: true, liveChildren: live }, frames as never);
    const t1 = performance.now();
    let n = 0;
    for (let i = 0; i < 1000; i += 1) for (const e of events) if (e.canvasActivity?.action === 'write') n += 1;
    const t2 = performance.now();
    console.log(`  canvasPresence alone: ${((t1 - t0)).toFixed(1)} µs/call; bare event walk: ${((t2 - t1)).toFixed(1)} µs/call (${n})`);
  }
  console.log(`${agents} agents, ${history} earlier events: ${state.transcripts[CHAT].length} turn events, presence on ${previous.size} frames, ${changes} changes over 1000 tokens`);
  console.log(`  board's chat token:   ${stats(own)}`);
  console.log(`  other chat's token:   ${stats(unrelated)}`);
}

run(4); run(16); run(16, 1500);
console.log('---');
run(4); run(16); run(16, 1500);
