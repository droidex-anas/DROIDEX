import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageFeed } from '../MessageFeed';
import { buildFeed } from '../chatFeed';
import { groupTurns, trailingSubagentPoll } from '../chatFeedTurns';
import { AgentMonitorCard } from './AgentMonitorCard';
import { AGENT_VISIBLE_ROW_LIMIT, foldedAgentRows } from './AgentRowList';
import { isPendingChildPlaceholder, resolveWaveSessions } from '../../lib/childSessions';
import { childSessionInfo } from '../../lib/tools';
import type { ChildSessionSummary, ChildStatus, TranscriptEvent } from '../../types/bridge';

let seq = 0;
function ev(extra: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    id: `e${seq++}`,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: seq,
    kind: 'text',
    ...extra,
  } as TranscriptEvent;
}

const userMsg = (text: string) => ev({ kind: 'text', author: 'user', text });
const assistantMsg = (text: string) => ev({ kind: 'text', author: 'assistant', text });
// The provider marks a poll that is about an agent it is tracking; the same
// tool name against a background command carries no mark.
const agentPoll = ev({
  kind: 'tool_call',
  toolName: 'TaskOutput',
  toolUseId: 'p1',
  toolArgs: { task_id: 'abc' },
  pollsChildSessionId: 'abc',
});
const commandPoll = ev({
  kind: 'tool_call',
  toolName: 'TaskOutput',
  toolUseId: 'p2',
  toolArgs: { task_id: 'bash_1' },
});

const spawn = (toolUseId: string, label: string) =>
  ev({
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId,
    toolArgs: { subagent_type: label, description: `${label} work` },
  });

function childSession(
  childSessionId: string,
  toolUseId: string,
  status: ChildStatus,
): ChildSessionSummary {
  return {
    parentAppSessionId: 'm',
    childSessionId,
    role: 'worker',
    status,
    label: childSessionId,
    modelId: 'droid-core',
    spawnLink: { kind: 'tool-use', id: toolUseId },
    transcriptAvailable: true,
    startedAt: 1_000,
    streamFidelity: 'state',
  };
}

const monitorData = {
  sessions: [childSession('explorer', 't1', 'running'), childSession('worker', 't2', 'completed')],
  models: [],
};

// Adjacent text expressions render with comment separators; strip them so text
// assertions match what a user reads.
const textOf = (html: string) => html.replace(/<!--.*?-->/g, '');

const cardText = (props: Parameters<typeof AgentMonitorCard>[0]) =>
  textOf(renderToStaticMarkup(createElement(AgentMonitorCard, props)));

type FeedExtras = Partial<Parameters<typeof MessageFeed>[0]>;
const feedHtml = (
  events: TranscriptEvent[],
  agentMonitor: { sessions: ChildSessionSummary[]; models: [] },
  extras: FeedExtras = {},
) =>
  renderToStaticMarkup(
    createElement(MessageFeed, {
      events,
      pending: true,
      onOpenChildSession: () => {},
      agentMonitor,
      ...extras,
    }),
  );
const noSessions = { sessions: [], models: [] as [] };

const waveToolUseIds = (items: ReturnType<typeof buildFeed>) =>
  items.flatMap((item) =>
    item.type === 'child_sessions' ? [item.events.map((e) => e.toolUseId)] : [],
  );

test('the collapsed card counts agents by their own status, with a completion summary', () => {
  // A background Task call returning means the launch was accepted, not that the
  // agent finished; only the child's state-only status may settle a row.
  const outranked = cardText({
    sessions: [childSession('a', 't1', 'running')],
    models: [],
    activity: () => ({ status: 'completed' }),
  });
  assert.ok(outranked.includes('1 Running'));
  assert.ok(!outranked.includes('1 Done'));

  const failed = cardText({
    sessions: [childSession('a', 't1', 'failed'), childSession('b', 't2', 'completed')],
    models: [],
  });
  assert.ok(failed.includes('1 Failed'));
  assert.ok(failed.includes('1 Done'));
  // Both are terminal, so the wave reads as fully accounted for.
  assert.ok(failed.includes('100%'));
  assert.ok(failed.includes('1 of 2 agents failed'));

  const html = renderToStaticMarkup(createElement(AgentMonitorCard, monitorData));
  const collapsed = textOf(html);
  assert.ok(collapsed.includes('Agents'));
  assert.ok(collapsed.includes('1 Running'));
  assert.ok(collapsed.includes('1 Done'));
  // Rows stay unmounted while collapsed; only the lifecycle line names agents.
  assert.equal(html.includes('data-testid="agent-row"'), false);

  const mixed = cardText({
    sessions: [
      childSession('a', 't1', 'running'),
      childSession('b', 't2', 'running'),
      childSession('c', 't3', 'paused'),
      childSession('d', 't4', 'completed'),
    ],
    models: [],
  });
  assert.ok(mixed.includes('2 Running'));
  assert.ok(mixed.includes('1 Awaiting approval'));
  assert.ok(mixed.includes('1 Done'));
  assert.ok(mixed.includes('1 of 4 agents finished'));
  assert.ok(mixed.includes('25%'));
});

test('each consecutive spawn run becomes its own wave feed item', () => {
  const options = { childSessionCards: true, groupChildSessions: true };
  const single = buildFeed(
    [userMsg('go'), spawn('t1', 'explorer'), spawn('t2', 'worker')],
    options,
  );
  assert.deepEqual(
    single.map((item) => item.type),
    ['message', 'child_sessions'],
  );
  assert.deepEqual(waveToolUseIds(single), [['t1', 't2']]);

  // A run, not the session, is the unit: a message between spawns starts a new wave.
  const items = buildFeed(
    [
      userMsg('one'),
      spawn('t1', 'explorer'),
      assistantMsg('first wave done'),
      spawn('t2', 'worker'),
    ],
    options,
  );
  const waves = items.filter((item) => item.type === 'child_sessions');
  assert.deepEqual(waveToolUseIds(items), [['t1'], ['t2']]);
  // Keys are distinct so each card mounts as its own component instance.
  assert.notEqual(waves[0].key, waves[1].key);
});

test('a completed turn folds the wave card into its Worked group', () => {
  const items = groupTurns(
    buildFeed([userMsg('go'), spawn('t1', 'explorer'), assistantMsg('done')], {
      childSessionCards: true,
      groupChildSessions: true,
    }),
    false,
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['message', 'worked', 'message'],
  );
  const worked = items[1];
  assert.equal(worked.type, 'worked');
  if (worked.type === 'worked') {
    assert.deepEqual(
      worked.items.map((item) => item.type),
      ['child_sessions'],
    );
  }
  // Nothing wave-shaped is left floating at the top level.
  assert.ok(!items.some((item) => item.type === 'child_sessions'));
});

test('two in-flight waves render two docks, each scoped to its own agents', () => {
  const events = [
    userMsg('go'),
    spawn('t1', 'explorer'),
    assistantMsg('first wave running'),
    spawn('t2', 'worker'),
  ];
  const text = textOf(feedHtml(events, monitorData));
  assert.equal(text.match(/Agents/g)?.length, 2);
  // Wave 1 holds only the running explorer; wave 2 only the completed worker.
  // A live wave opens, so its count pills have already become row pills.
  assert.ok(text.includes('Running'));
  assert.ok(text.includes('1 Done'));
  // The header summarizes completion; the pills carry the status breakdown.
  assert.ok(!text.includes('spawned'));
  assert.ok(text.includes('All 1 agent finished'));
  assert.ok(text.includes('0 of 1 agent finished'));
  assert.ok(!text.includes('Spawned'));
});

test('an unresolved live spawn reports unknown status and never infers lifecycle', () => {
  // A background Task acknowledges its launch immediately, so the spawn call
  // already carries an endTs while the subagent is only starting up.
  const launched = {
    ...spawn('t1', 'explorer'),
    ts: Date.now() - 60_000,
    endTs: Date.now() - 59_000,
  };
  const wave = resolveWaveSessions([launched], []);
  assert.equal(wave[0].status, 'pending');
  const text = cardText({ sessions: wave, models: [], live: true });
  assert.ok(text.includes('Awaiting status'));
  assert.ok(text.includes('Awaiting status for 1 agent'));
  // With no activity yet, the row says what the agent was asked to do.
  assert.ok(text.includes('explorer work'));
  assert.ok(!text.includes('1m</'));
  assert.ok(!text.includes('Done'));

  // Ending the parent turn still says nothing about the child's lifecycle.
  assert.equal(resolveWaveSessions([launched], [])[0].status, 'pending');

  // A queued child is known to be waiting its turn, so it says Queued instead.
  const queued = cardText({
    sessions: [{ ...childSession('queued-agent', 't1', 'pending'), queued: true }],
    models: [],
    live: true,
  });
  assert.ok(queued.includes('Queued'));
  assert.ok(!queued.includes('Awaiting status'));
});

test('the dock renders from spawn events before sessions register, and stays unknown', () => {
  // No resolved sessions yet: a placeholder stands in so the card never flashes
  // per-spawn lines while the store catches up.
  const text = textOf(feedHtml([userMsg('go'), spawn('t1', 'explorer')], noSessions));
  assert.ok(text.includes('Agents'));
  assert.ok(text.includes('Awaiting status'));
  assert.ok(!text.includes('Spawned'));

  // The parent keeps talking (plan updates, narration) while its subagents work,
  // so "is this wave live" cannot be "is this the last feed item".
  const followed = textOf(
    feedHtml(
      [userMsg('go'), spawn('t1', 'explorer'), assistantMsg('spawned the explorer')],
      noSessions,
    ),
  );
  assert.ok(followed.includes('Awaiting status'));
  assert.ok(!followed.includes('Never started'));
});

test('polling and stopping subagents never renders rows beside the card', () => {
  const poll = (toolUseId: string, toolName: string) =>
    ev({
      kind: 'tool_call',
      toolName,
      toolUseId,
      toolArgs: { task_id: 'abc' },
      pollsChildSessionId: 'abc',
    });
  const pollResult = (toolUseId: string) =>
    ev({
      kind: 'tool_result',
      toolUseId,
      text: 'Task ID: abc\nStatus: running\n\nreading the sidecar',
    });
  const events = [
    userMsg('go'),
    spawn('t1', 'explorer'),
    poll('p1', 'TaskOutput'),
    pollResult('p1'),
    poll('p2', 'TaskStop'),
    pollResult('p2'),
  ];
  const text = textOf(feedHtml(events, noSessions));
  assert.ok(text.includes('Agents'));
  // The card speaks for the polls; neither the calls nor their echoed bodies
  // may appear as tool rows.
  assert.ok(!text.includes('TaskOutput'));
  assert.ok(!text.includes('TaskStop'));
  assert.ok(!text.includes('reading the sidecar'));
});

test('a trailing agent poll reads as checking subagents, not a stuck or stopped parent', () => {
  // The parent finished a search and is now polling its subagents. The poll is
  // suppressed, so the search group is the feed's last item: it must read as
  // settled while the cue reports what the parent is actually doing.
  const afterStep = feedHtml(
    [
      userMsg('go'),
      spawn('t1', 'explorer'),
      ev({ kind: 'tool_call', toolName: 'Grep', toolUseId: 'g1', toolArgs: { pattern: 'foo' } }),
      ev({ kind: 'tool_result', toolUseId: 'g1', text: 'src/a.ts:1: foo' }),
      agentPoll,
    ],
    monitorData,
  );
  assert.ok(textOf(afterStep).includes('Checking subagents'));
  assert.ok(afterStep.includes('Search'));
  // A tool group shimmers its summary only while the step is still running.
  assert.doesNotMatch(afterStep, /shimmer-text[^"]*">Search/);

  // An assistant message self-indicates with a caret, so a settled one at the
  // tail would leave the whole feed looking stopped while the parent polls.
  const afterMessage = feedHtml(
    [
      userMsg('go'),
      spawn('t1', 'explorer'),
      assistantMsg('spawned the explorer'),
      agentPoll,
      ev({
        kind: 'tool_result',
        toolUseId: 'p1',
        text: 'Task ID: abc\nStatus: running\n\nworking',
      }),
    ],
    monitorData,
  );
  assert.ok(textOf(afterMessage).includes('Checking subagents'));
});

test('a running wave card is the only live cue until it settles', () => {
  // The dock's own session status suppresses the global Working cue, even
  // without an activity callback.
  const docked = textOf(
    feedHtml([userMsg('go'), spawn('t1', 'explorer')], {
      sessions: [childSession('explorer', 't1', 'running')],
      models: [],
    }),
  );
  assert.ok(docked.includes('Agents'));
  assert.equal(docked.includes('Working'), false);

  // The card at the tail already reports the wave with its own status pills and
  // timers, so announcing the check as well would say the same thing twice.
  const events = [userMsg('go'), spawn('t1', 'explorer'), agentPoll];
  const running = textOf(
    feedHtml(
      events,
      { sessions: [childSession('explorer', 't1', 'running')], models: [] },
      { childSessionActivity: () => ({ status: 'running' }) },
    ),
  );
  assert.ok(running.includes('Agents'));
  assert.ok(!running.includes('Checking subagents'));

  // Once the wave settles, the card stops animating and the cue is the only
  // thing left to say the parent is still working.
  const settled = textOf(
    feedHtml(
      events,
      { sessions: [childSession('explorer', 't1', 'completed')], models: [] },
      { childSessionActivity: () => ({ status: 'completed' }) },
    ),
  );
  assert.ok(settled.includes('Checking subagents'));
});

test('only a suppressed poll at the tail redirects the working cue', () => {
  const pollResult = ev({ kind: 'tool_result', toolUseId: 'p1', text: 'Status: running' });
  const read = ev({ kind: 'tool_call', toolName: 'Read', toolUseId: 'r1', toolArgs: {} });

  const spawned = [userMsg('go'), spawn('t1', 'explorer')];
  // The poll call is returned so the cue can time the check from it.
  assert.equal(trailingSubagentPoll([...spawned, agentPoll], true), agentPoll);
  // Replayed results carry no toolName, so the tail resolves through its call.
  assert.equal(trailingSubagentPoll([...spawned, agentPoll, pollResult], true), agentPoll);
  assert.equal(trailingSubagentPoll([...spawned, agentPoll, read], true), undefined);
  assert.equal(trailingSubagentPoll([userMsg('go'), assistantMsg('done')], true), undefined);
  // Views that keep the poll rows render them, so their tail is honest already.
  assert.equal(trailingSubagentPoll([...spawned, agentPoll], false), undefined);
  // The same tool reading a background command names no agent, so the cue says
  // nothing about agents even in a chat that has spawned one.
  assert.equal(trailingSubagentPoll([...spawned, commandPoll], true), undefined);
});

test('an agent poll splits neither a wave nor a tool group, and only cards hide it', () => {
  const options = { childSessionCards: true, groupChildSessions: true };
  // The poll is bookkeeping the card already speaks for, so it must not split
  // the turn's agents into two cards; the card stays where the spawning began.
  const spawnBatches = buildFeed(
    [
      userMsg('go'),
      spawn('t1', 'explorer'),
      agentPoll,
      ev({ kind: 'tool_result', toolUseId: 'p1', text: 'Task ID: abc\nStatus: completed' }),
      spawn('t2', 'worker'),
    ],
    options,
  );
  assert.deepEqual(waveToolUseIds(spawnBatches), [['t1', 't2']]);

  const toolCall = (toolUseId: string, toolName: string) =>
    ev({ kind: 'tool_call', toolName, toolUseId, toolArgs: { file_path: `/tmp/${toolUseId}.ts` } });
  const feed = buildFeed(
    [spawn('t1', 'explorer'), toolCall('a', 'Read'), agentPoll, toolCall('b', 'Grep')],
    options,
  );
  const groups = feed.filter((item) => item.type === 'tools');
  assert.equal(groups.length, 1);
  if (groups[0].type === 'tools') assert.equal(groups[0].events.length, 2);

  // The same call against a background command keeps its row: the card speaks
  // for agents, and this one is not about an agent.
  const plain = buildFeed(
    [spawn('t1', 'explorer'), toolCall('a', 'Read'), commandPoll, toolCall('b', 'Grep')],
    options,
  );
  const plainGroups = plain.filter((item) => item.type === 'tools');
  if (plainGroups[0].type === 'tools') assert.equal(plainGroups[0].events.length, 3);

  // Mission Control and child-session panes render no wave card, so nothing
  // there would account for a suppressed poll.
  const perSpawn = buildFeed([userMsg('go'), spawn('t1', 'explorer'), agentPoll], {
    childSessionCards: true,
    groupChildSessions: false,
  });
  const tools = perSpawn.filter((item) => item.type === 'tools');
  assert.equal(tools.length, 1);
  assert.deepEqual(tools[0].type === 'tools' && tools[0].events.map((e) => e.toolName), [
    'TaskOutput',
  ]);
});

test('streaming deltas merge into one wave event instead of duplicating the spawn', () => {
  // A spawn's subagent_type and description can arrive in separate deltas
  // sharing one toolUseId (replayed transcripts are not pre-coalesced).
  const first = ev({
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId: 't1',
    toolArgs: { subagent_type: 'explorer' },
  });
  const delta = ev({
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId: 't1',
    toolArgs: { description: 'survey the code' },
  });
  const items = buildFeed([userMsg('go'), first, delta], {
    childSessionCards: true,
    groupChildSessions: true,
  });
  const waves = items.filter((item) => item.type === 'child_sessions');
  assert.equal(waves.length, 1);
  const wave = waves[0];
  if (wave.type !== 'child_sessions') assert.fail('expected a wave item');
  assert.equal(wave.events.length, 1);
  assert.equal(childSessionInfo(wave.events[0].toolArgs).label, 'explorer');
  assert.equal(childSessionInfo(wave.events[0].toolArgs).description, 'survey the code');
});

test('resolveWaveSessions swaps a placeholder for the registered session on the same link', () => {
  const spawnEvent = spawn('t1', 'explorer');
  const pendingWave = resolveWaveSessions([spawnEvent], []);
  assert.equal(pendingWave.length, 1);
  assert.equal(pendingWave[0].status, 'pending');
  assert.ok(isPendingChildPlaceholder(pendingWave[0]));
  // The placeholder carries the task description so the row has something to say.
  assert.equal(pendingWave[0].prompt, 'explorer work');

  const registered = childSession('explorer', 't1', 'running');
  const resolvedWave = resolveWaveSessions([spawnEvent], [registered]);
  // Same single row, same tool-use link: the dock row keeps its key and timer.
  assert.equal(resolvedWave.length, 1);
  assert.equal(resolvedWave[0].childSessionId, registered.childSessionId);
  assert.deepEqual(resolvedWave[0].spawnLink, pendingWave[0].spawnLink);

  // The store stamps startedAt at admission, which lags the spawn; the wave's
  // spawn event timestamp is the honest start for the row timer.
  const timedSpawn = { ...spawnEvent, ts: 5_000 };
  const late = { ...registered, startedAt: 12_000 };
  assert.equal(resolveWaveSessions([timedSpawn], [late])[0].startedAt, 5_000);
  const early = { ...registered, startedAt: 4_000 };
  assert.equal(resolveWaveSessions([timedSpawn], [early])[0].startedAt, 4_000);
});

// Paging older history can reveal a wave with dozens of spawns; the expanded
// card folds everything past the first rows behind "Show N more subagents"
// instead of dumping (and stagger-animating) the full list at once.
test('an expanded wave folds rows past the visible limit, preserving spawn order', () => {
  const rows = Array.from({ length: AGENT_VISIBLE_ROW_LIMIT + 4 }, (_, i) => `agent-${String(i)}`);
  const folded = foldedAgentRows(rows, false);
  assert.equal(folded.length, AGENT_VISIBLE_ROW_LIMIT);
  // A head slice, so visible rows keep their indices into the full row list
  // (names and duration lookups stay aligned).
  assert.deepEqual(folded, rows.slice(0, AGENT_VISIBLE_ROW_LIMIT));
  // "Show N more" reveals the rest in the same order.
  assert.deepEqual(foldedAgentRows(rows, true), rows);
});

test('a workflow labels its phases and folds its lifecycle; a plain wave stays flat', () => {
  const workflow = cardText({
    sessions: [
      { ...childSession('explorer', 't1', 'running'), group: 'Repair work', phase: 'Read' },
      { ...childSession('worker', 't2', 'completed'), group: 'Repair work', phase: 'Fix' },
    ],
    models: [],
    live: true,
  });
  // The workflow names the card, and its own phases are the groups.
  assert.ok(workflow.includes('Repair work'));
  assert.ok(workflow.includes('Read'));
  assert.ok(workflow.includes('Fix'));

  // A plain wave has nothing to label, so the card is the flat list of rows the
  // turn spawned — never regrouped into active and finished under its own heads.
  const plain = renderToStaticMarkup(
    createElement(AgentMonitorCard, { ...monitorData, live: true }),
  );
  assert.equal(plain.includes('agent-section-label'), false);

  // The transcript states a finished wave's lifecycle in one folded sentence.
  const finished = cardText({
    sessions: [
      { ...childSession('explorer', 't1', 'completed'), group: 'Repair work' },
      { ...childSession('worker', 't2', 'completed'), group: 'Repair work' },
    ],
    models: [],
  });
  assert.ok(finished.includes('explorer and worker started working'));
  assert.ok(finished.includes('Repair work finished'));
});
