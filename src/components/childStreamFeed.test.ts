import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChildSessionSummary, TranscriptEvent } from '../types/bridge';
import { sameFeedEvents, feedItemPropsEqual, type FeedItemViewProps } from './chat';
import type { FeedItem } from './chatFeed';
import { initialState, shallowEqual, type AppState } from '../hooks/useStore';
import { selectDockedAgents } from './composer/ComposerDock';

function event(id: string, overrides: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    id,
    appSessionId: 'session-a',
    sourceSessionId: 'primary',
    role: 'primary',
    kind: 'text',
    author: 'assistant',
    text: id,
    ts: 1,
    ...overrides,
  };
}

function user(id: string, ts: number): TranscriptEvent {
  return event(id, { sourceSessionId: 'user', author: 'user', text: id, ts });
}

function spawn(toolUseId: string, ts: number): TranscriptEvent {
  return event(`spawn-${toolUseId}`, {
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId,
    toolArgs: { subagent_type: toolUseId, description: `${toolUseId} work` },
    ts,
    author: undefined,
    text: undefined,
  });
}

function childItem(key: string, events: TranscriptEvent[]): FeedItem {
  return { type: 'child_sessions', key, events };
}

function messageItem(eventRef: TranscriptEvent): FeedItem {
  return { type: 'message', key: eventRef.id, event: eventRef };
}

function viewProps(item: FeedItem, overrides: Partial<FeedItemViewProps> = {}): FeedItemViewProps {
  return {
    item,
    live: false,
    sessionLive: true,
    ...overrides,
  };
}

test('feedItemPropsEqual isolates a child_sessions card from sibling feed rows', () => {
  const spawnEvent = spawn('t1', 3);
  const userEvent = user('user-1', 1);
  const wave = childItem('child-sessions-t1', [spawnEvent]);
  const dock = { sessions: [] as ChildSessionSummary[], models: [] };
  const previousWave = viewProps(wave, { agentMonitor: dock });
  const nextWave = viewProps(wave, { agentMonitor: dock });
  assert.equal(sameFeedEvents(wave, wave), true);
  assert.equal(feedItemPropsEqual(previousWave, nextWave), true);

  const nextDock = { sessions: [] as ChildSessionSummary[], models: [] };
  assert.equal(
    feedItemPropsEqual(previousWave, viewProps(wave, { agentMonitor: nextDock })),
    false,
  );

  const previousMessage = viewProps(messageItem(userEvent));
  const nextMessage = viewProps(messageItem(userEvent), { sessionLive: true });
  assert.equal(feedItemPropsEqual(previousMessage, nextMessage), true);

  assert.equal(
    feedItemPropsEqual(
      viewProps(messageItem(userEvent), { agentMonitor: dock }),
      viewProps(messageItem(userEvent), { agentMonitor: nextDock }),
    ),
    true,
  );
});

test('feedItemPropsEqual rerenders a worked fold when nested dock data changes', () => {
  const wave = childItem('child-sessions-t1', [spawn('t1', 3)]);
  const worked: FeedItem = {
    type: 'worked',
    key: 'worked-1',
    durationMs: 1_000,
    items: [wave],
  };
  const dock = { sessions: [] as ChildSessionSummary[], models: [] };
  const previous = viewProps(worked, { agentMonitor: dock });
  assert.equal(feedItemPropsEqual(previous, viewProps(worked, { agentMonitor: dock })), true);
  assert.equal(
    feedItemPropsEqual(previous, viewProps(worked, { agentMonitor: { sessions: [], models: [] } })),
    false,
  );
  assert.equal(
    feedItemPropsEqual(
      viewProps(worked, { agentMonitor: dock, sessionLive: false }),
      viewProps(worked, { agentMonitor: dock, sessionLive: true }),
    ),
    false,
  );
});

test('activity selectors refresh child rows without invalidating unrelated prose', () => {
  const before = () => ({ status: 'running' as const });
  const after = () => ({ status: 'completed' as const });
  const wave = childItem('wave', [spawn('child', 3)]);
  const worked: FeedItem = { type: 'worked', key: 'worked', durationMs: 10, items: [wave] };
  assert.equal(
    feedItemPropsEqual(
      viewProps(worked, { childSessionActivity: before }),
      viewProps(worked, { childSessionActivity: after }),
    ),
    false,
  );
  const prose = messageItem(user('prompt', 1));
  assert.equal(
    feedItemPropsEqual(
      viewProps(prose, { childSessionActivity: before }),
      viewProps(prose, { childSessionActivity: after }),
    ),
    true,
  );
});

test('the docked agent line reads no transcript, so a streamed token cannot re-render it', () => {
  // The composer sits on the per-token path. The docked line's source must stay
  // identical across a transcript append, or every token would rebuild its rows.
  const child: ChildSessionSummary = {
    parentAppSessionId: 'session-a',
    childSessionId: 'child-a',
    role: 'worker',
    status: 'running',
    modelId: 'droid-core',
    transcriptAvailable: true,
    startedAt: 1,
    streamFidelity: 'token',
  };
  const base: AppState = {
    ...initialState,
    activeAppSessionId: 'session-a',
    sessions: { 'session-a': { appSessionId: 'session-a' } as AppState['sessions'][string] },
    childSessions: { 'session-a': { 'child-a': child } },
    transcripts: { 'session-a': [event('a')] },
  };
  const streamed: AppState = { ...base, transcripts: { 'session-a': [event('a'), event('b')] } };
  assert.equal(shallowEqual(selectDockedAgents(base), selectDockedAgents(streamed)), true);

  // A child that actually changed does reach it.
  const settled: AppState = {
    ...base,
    childSessions: { 'session-a': { 'child-a': { ...child, status: 'completed' } } },
  };
  assert.equal(shallowEqual(selectDockedAgents(base), selectDockedAgents(settled)), false);
});
