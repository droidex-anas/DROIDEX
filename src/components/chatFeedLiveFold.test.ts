import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageFeed } from './MessageFeed';
import { buildFeed, sameFeedEvents, type FeedItem } from './chatFeed';
import { buildGroupedFeed } from './chatFeedTurns';
import type { TranscriptEvent } from '@droidex/protocol';

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
const asst = (text: string) => ev({ kind: 'text', text });
const grep = () => ev({ kind: 'tool_call', toolName: 'Grep', toolArgs: { pattern: 'x' } });

type Fold = Extract<FeedItem, { type: 'worked' }>;
const folds = (items: FeedItem[]) => items.filter((it): it is Fold => it.type === 'worked');
const compactFeed = (events: TranscriptEvent[], pending: boolean) =>
  buildGroupedFeed(events, pending, { foldLiveTurn: true });

test('compact folds a running turn into one counting fold above its latest note', () => {
  const events = [userMsg('fix it'), grep(), asst('first note'), grep(), asst('second note')];
  const stepsSince = [grep(), ev({ kind: 'thinking', text: 'next' })];
  const live = compactFeed([...events, ...stepsSince], true);
  assert.deepEqual(
    live.map((it) => it.type),
    ['message', 'worked', 'message'],
  );
  assert.equal(live[2].type === 'message' && live[2].event.text, 'second note');
  const [fold] = folds(live);
  assert.equal(typeof fold.runningSince, 'number');
  assert.deepEqual(
    fold.items.map((it) => it.type),
    ['tools', 'message', 'tools', 'tools', 'thinking'],
  );
  // The fold keeps its row when the turn settles, so an opened fold stays open.
  const [settledFold] = folds(compactFeed([...events, ...stepsSince, asst('done')], false));
  assert.equal(settledFold.key, fold.key);
  assert.equal(settledFold.runningSince, undefined);
  assert.equal(sameFeedEvents(fold, settledFold), false);
});

test('compact stops counting the part of a running turn the user steered past', () => {
  const steer = ev({ kind: 'text', author: 'user', text: 'also check tests', steered: true });
  const events = [userMsg('fix it'), grep(), asst('found it'), steer, grep(), asst('ok')];
  assert.deepEqual(
    folds(compactFeed(events, true)).map((it) => it.runningSince !== undefined),
    [false, true],
  );
});

test('compact shows a running turn as one Working fold and no second cue', () => {
  const events = [userMsg('go'), asst('Looking into it.'), grep()];
  const render = (density: 'compact' | 'balanced', pending: boolean) =>
    renderToStaticMarkup(createElement(MessageFeed, { events, pending, density }));
  const compact = render('compact', true);
  assert.match(compact, /Working/);
  assert.doesNotMatch(compact, /Worked|Running/);
  assert.match(compact, /Looking into it\./);
  // Other densities keep the running turn expanded under the usual cue.
  assert.doesNotMatch(render('balanced', true), /Working|Worked/);
  assert.match(render('compact', false), /Worked/);
});

test('compact keeps a compaction in progress out of the running fold', () => {
  const compacting = ev({ kind: 'status', text: 'Compacting conversation…' });
  const events = [userMsg('go'), grep(), asst('Looking into it.'), grep(), compacting];
  assert.deepEqual(
    compactFeed(events, true).map((it) => it.type),
    ['message', 'worked', 'message', 'status'],
  );
  const html = renderToStaticMarkup(
    createElement(MessageFeed, { events, pending: true, density: 'compact' }),
  );
  assert.match(html, /Compacting…/);
});

test('compact lets the running fold speak for a subagent poll', () => {
  const events = [
    userMsg('go'),
    ev({ kind: 'tool_call', toolName: 'Task', toolUseId: 't1', toolArgs: { subagent_type: 'x' } }),
    grep(),
    ev({
      kind: 'tool_call',
      toolName: 'TaskOutput',
      toolUseId: 'p1',
      toolArgs: { task_id: 'abc' },
      pollsChildSessionId: 'abc',
    }),
  ];
  const render = (density: 'compact' | 'balanced') =>
    renderToStaticMarkup(
      createElement(MessageFeed, {
        events,
        pending: true,
        density,
        onOpenChildSession: () => {},
        agentMonitor: { sessions: [], models: [] },
      }),
    );
  assert.match(render('balanced'), /Checking subagents/);
  const compact = render('compact');
  assert.match(compact, /Working/);
  assert.doesNotMatch(compact, /Checking subagents/);
});

test('settled turn rows never shimmer while the session is live on a newer turn', () => {
  // A call whose turn was interrupted never receives its result: it stays
  // unpaired forever. Scoping sessionLive to the live turn keeps that history
  // still — before the scope, every such row shimmered for the session's life.
  const events = [
    userMsg('first'),
    grep(), // turn one's call, deliberately never answered
    userMsg('second'),
    grep(), // the live turn's in-flight call
  ];
  const html = renderToStaticMarkup(
    createElement(MessageFeed, {
      events,
      items: buildFeed(events),
      pending: true,
      density: 'balanced',
    }),
  );
  // Both rows render (non-vacuous), but only the live turn's may shimmer.
  assert.equal((html.match(/>(?:Searching|Searched)</g) ?? []).length, 2, 'both rows render');
  const shimmering = html.match(/shimmer-text[^>]*>Searching</g) ?? [];
  assert.equal(shimmering.length, 1, `exactly one row may shimmer, got: ${shimmering.join(' | ')}`);
});
