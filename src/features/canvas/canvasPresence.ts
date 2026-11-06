// Who is at work on which frame of a board, read from the board's chat: the
// frames its running canvas creates and writes name, and the frames still
// waiting for their first source while the agent that made them is live. An
// agent is the chat itself or one of its child sessions, and each one present
// gets a name and a colour of its own.

import { chunkedSequenceChunks } from '../../lib/chunkedSequence';
import { PRESENCE_COLORS, type PresenceColor } from '../../lib/themeTokens';
import type { TranscriptEvent } from '../../types/bridge';
import type { CanvasFrame } from './protocol';

export interface PresenceAgent {
  /** The chat's id for its own agent, or `<chat>/<child session>` for a child's. */
  key: string;
  name: string;
  color: PresenceColor;
}

export interface FrameWorker {
  agent: PresenceAgent;
  /** A running call names the frame, rather than it waiting, empty, on the agent that made it. */
  named: boolean;
}

/** The agent at work on each frame, by design id. */
export type CanvasPresence = ReadonlyMap<string, FrameWorker>;

export const NO_PRESENCE: CanvasPresence = new Map();

const AGENT_NAMES = [
  'Kairo',
  'Lyra',
  'Juno',
  'Orin',
  'Vega',
  'Nova',
  'Sable',
  'Iris',
  'Atlas',
  'Rhea',
  'Soren',
  'Wren',
] as const;
const COLORS = Object.keys(PRESENCE_COLORS.light) as PresenceColor[];
const PRIMARY = 'primary';
// How many events before the chat's latest prompt are still read for a child at
// work: a child can outlive the turn that started it, and a bound keeps a long
// history from costing every store update.
const CHILD_LOOKBACK = 2000;

export interface PresenceSources {
  appSessionId: string;
  /** The chat's loaded transcript, its child sessions' events included. */
  events: readonly TranscriptEvent[];
  /** The chat's own turn is running. */
  primaryLive: boolean;
  /** The child sessions at work. */
  liveChildren: ReadonlySet<string>;
}

/**
 * Reads the chat's current turn, from its latest prompt on, and a child still
 * at work from before it too. A canvas create or write without its result yet
 * is running; a frame it names is being worked on while its agent is live. A
 * frame with no source yet belongs to the agent whose create made it this turn,
 * or while a create runs, to that create's agent; otherwise it is no one's.
 */
export function canvasPresence(
  sources: PresenceSources,
  frames: readonly Pick<CanvasFrame, 'designId' | 'revisionId'>[],
): CanvasPresence {
  const { primaryLive, liveChildren } = sources;
  if (!primaryLive && liveChildren.size === 0) return NO_PRESENCE;
  const isLive = (source: string) => (source === PRIMARY ? primaryLive : liveChildren.has(source));
  const work = turnWork(currentTurn(sources.events, liveChildren));
  const workers = frameWorkers(work, frames, isLive);
  if (workers.size === 0) return NO_PRESENCE;

  const present = new Set([...workers.values()].map((worker) => worker.source));
  const agents = assignAgents(
    sources.appSessionId,
    new Set([...work.arrivals, PRIMARY].filter((source) => present.has(source))),
  );
  const presence = new Map<string, FrameWorker>();
  for (const [designId, { source, named }] of workers) {
    const agent = agents.get(source);
    if (agent) presence.set(designId, { agent, named });
  }
  return presence;
}

/** What the turn's canvas calls say, by agent: `PRIMARY` or a child session id. */
interface TurnWork {
  /** Each create or write still running, in the order they started, with the frames it names. */
  running: RunningCall[];
  /** The agent whose create this turn made each frame. */
  createdBy: ReadonlyMap<string, string>;
  /** Agents in the order they first touched the canvas, so one keeps its look when another joins. */
  arrivals: ReadonlySet<string>;
}

interface RunningCall {
  source: string;
  action: 'create' | 'write';
  designIds: string[];
}

function turnWork(turn: readonly TranscriptEvent[]): TurnWork {
  const running = new Map<string, RunningCall>();
  const settled = new Set<string>();
  const createdBy = new Map<string, string>();
  const arrivals = new Set<string>();
  for (const event of turn) {
    const activity = event.canvasActivity;
    if (activity?.action !== 'create' && activity?.action !== 'write') continue;
    const source = event.role === 'primary' ? PRIMARY : event.sourceSessionId;
    const call = `${source}\0${activity.toolUseId}`;
    arrivals.add(source);
    if (event.kind === 'tool_call' && activity.state === 'running') {
      // A call event can land after its result, and must not open it again.
      if (!settled.has(call))
        running.set(call, { source, action: activity.action, designIds: activity.designIds });
      continue;
    }
    settled.add(call);
    running.delete(call);
    if (activity.action === 'create' && activity.state === 'completed')
      for (const designId of activity.designIds) createdBy.set(designId, source);
  }
  return { running: [...running.values()], createdBy, arrivals };
}

/**
 * The chat's events from its latest prompt on, or all of them while that
 * prompt is not loaded, with the live children's events from up to
 * `CHILD_LOOKBACK` events before it. Read from the transcript's chunks, which
 * are plain arrays: the sequence's own indexed reads are slow, and this runs on
 * every store update while an agent is live, so it costs the turn and never the
 * history before it.
 */
function currentTurn(
  events: readonly TranscriptEvent[],
  liveChildren: ReadonlySet<string>,
): TranscriptEvent[] {
  const chunks = chunkedSequenceChunks(events);
  const turn: TranscriptEvent[] = [];
  // How many more events to read before the prompt, once it is found.
  let lookback: number | undefined;
  for (let chunkIndex = chunks.length - 1; chunkIndex >= 0; chunkIndex -= 1) {
    const chunk = chunks[chunkIndex];
    for (let index = chunk.length - 1; index >= 0; index -= 1) {
      const event = chunk[index];
      if (lookback === undefined) {
        if (startsTurn(event)) lookback = liveChildren.size > 0 ? CHILD_LOOKBACK : 0;
        else turn.push(event);
        continue;
      }
      if (lookback === 0) return turn.reverse();
      lookback -= 1;
      if (event.role !== 'primary' && liveChildren.has(event.sourceSessionId)) turn.push(event);
    }
  }
  return turn.reverse();
}

/** The agent at work on each frame on the board, by design id. */
function frameWorkers(
  work: TurnWork,
  frames: readonly Pick<CanvasFrame, 'designId' | 'revisionId'>[],
  isLive: (source: string) => boolean,
): Map<string, { source: string; named: boolean }> {
  const onBoard = new Set(frames.map((frame) => frame.designId));
  const workers = new Map<string, { source: string; named: boolean }>();
  for (const { source, designIds } of work.running) {
    if (!isLive(source)) continue;
    for (const designId of designIds)
      if (onBoard.has(designId)) workers.set(designId, { source, named: true });
  }
  // A create names its frames only in its result, which comes after they reach the board.
  const creating = work.running.findLast(
    (call) => call.action === 'create' && isLive(call.source),
  )?.source;
  for (const frame of frames) {
    if (frame.revisionId !== null || workers.has(frame.designId)) continue;
    const source = work.createdBy.get(frame.designId) ?? creating;
    if (source !== undefined && isLive(source))
      workers.set(frame.designId, { source, named: false });
  }
  return workers;
}

/** The chat's own prompt, unless it was a steer, which joins the turn it steers. */
function startsTurn(event: TranscriptEvent): boolean {
  return event.author === 'user' && event.role === 'primary' && !event.steered;
}

/**
 * Each agent's name and colour, from a hash of its stable identity. An agent
 * whose pick another present agent already holds takes the next free one, in
 * order of arrival, so two agents on one board never look alike while there
 * are enough colours.
 */
function assignAgents(
  appSessionId: string,
  sources: ReadonlySet<string>,
): Map<string, PresenceAgent> {
  const names = new Set<string>();
  const colors = new Set<PresenceColor>();
  const agents = new Map<string, PresenceAgent>();
  for (const source of sources) {
    const key = source === PRIMARY ? appSessionId : `${appSessionId}/${source}`;
    const hash = fnv1a(key);
    const name = pick(AGENT_NAMES, hash, names);
    const color = pick(COLORS, Math.floor(hash / AGENT_NAMES.length), colors);
    names.add(name);
    colors.add(color);
    agents.set(source, { key, name, color });
  }
  return agents;
}

function pick<T>(options: readonly T[], hash: number, taken: ReadonlySet<T>): T {
  for (let step = 0; step < options.length; step += 1) {
    const option = options[(hash + step) % options.length];
    if (!taken.has(option)) return option;
  }
  return options[hash % options.length];
}

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Whether two presences show the same agents on the same frames. */
export function samePresence(left: CanvasPresence, right: CanvasPresence): boolean {
  if (left === right) return true;
  if (left.size !== right.size) return false;
  for (const [designId, { agent, named }] of left) {
    const other = right.get(designId);
    if (
      other?.named !== named ||
      other.agent.key !== agent.key ||
      other.agent.name !== agent.name ||
      other.agent.color !== agent.color
    )
      return false;
  }
  return true;
}
