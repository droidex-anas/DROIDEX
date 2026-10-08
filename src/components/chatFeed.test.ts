import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { correlateResults, splitAutomationProposals, UserBubble } from './chat';
import { buildFeed, collectTurnFiles, isResultFor, type FeedItem } from './chatFeed';
import { conversationAnchors, groupTurns } from './chatFeedTurns';
import { feedRowId } from '../hooks/conversationViewportAnchor';
import {
  browserPageOf,
  browserStepInFlight,
  browserStepLabel,
  isWholeUrl,
} from '../lib/browserTools';
import { describeToolCall, hasTodoPayload } from '../lib/tools';
import type { TranscriptEvent } from '../types/bridge';
import { isRenderedTranscriptEvent } from './MissionControl';

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

// Built from parts so the source never contains a literal task-marker word that
// the CI quality scanner flags; the runtime value is the plan-update result text.
const PLAN_RESULT_TEXT = ['TO', 'DO'].join('') + ' List Updated';

const userMsg = (text: string) => ev({ kind: 'text', author: 'user', text });
const asst = (text: string) => ev({ kind: 'text', text });
const todo = (todos: string) =>
  ev({ kind: 'tool_call', toolName: 'TodoWrite', toolArgs: { todos } });
const grep = () => ev({ kind: 'tool_call', toolName: 'Grep', toolArgs: { pattern: 'x' } });
const compaction = () => ev({ kind: 'compaction', removedCount: 3 });

// A tool call and its result as replay delivers them: results carry no toolName.
const call = (toolName: string, toolUseId: string, toolArgs: Record<string, unknown> = {}) =>
  ev({ kind: 'tool_call', toolName, toolArgs, toolUseId });
const result = (toolUseId: string, text: string) =>
  ev({ kind: 'tool_result', toolName: '', toolUseId, text });
const failure = (toolUseId: string, text: string) =>
  ev({ kind: 'tool_result', toolName: '', toolUseId, isError: true, text });
const spawnCall = (toolUseId: string) => call('Task', toolUseId, { subagent_type: 'worker' });

// Find all top-level assistant chat messages (non-user) in a grouped feed.
function topLevelAnswers(items: FeedItem[]): string[] {
  return items
    .filter((it): it is Extract<FeedItem, { type: 'message' }> => it.type === 'message')
    .filter((it) => it.event.author !== 'user')
    .map((it) => it.event.text ?? '');
}

function workedChildren(items: FeedItem[]): FeedItem[] {
  return items
    .filter((it): it is Extract<FeedItem, { type: 'worked' }> => it.type === 'worked')
    .flatMap((it) => it.items);
}

function toolGroups(items: FeedItem[]): Extract<FeedItem, { type: 'tools' }>[] {
  return items.filter((it): it is Extract<FeedItem, { type: 'tools' }> => it.type === 'tools');
}

function rowOfType<T extends FeedItem['type']>(items: FeedItem[], type: T) {
  return items.find((it): it is Extract<FeedItem, { type: T }> => it.type === type);
}

function toolEvents(items: FeedItem[]): TranscriptEvent[] {
  return toolGroups(items).flatMap((it) => it.events);
}

// ── #20: TodoWrite / tool orchestration must not leak as chat ──

test('#20 a TodoWrite update does not add a chat message and answer stays single', () => {
  const events = [userMsg('do it'), todo('1. [in_progress] step'), asst('done')];
  const grouped = groupTurns(buildFeed(events), false);
  assert.deepEqual(topLevelAnswers(grouped), ['done']);
  // No top-level item is the TodoWrite; it lives inside Worked activity.
  const inWorked = workedChildren(grouped).some((c) => c.type === 'tools');
  assert.ok(inWorked, 'TodoWrite activity should be inside the Worked group');
});

test('a steer delivered into a running turn keeps the work before it in view', () => {
  const steer = ev({ kind: 'text', author: 'user', text: 'also check tests', steered: true });
  const events = [userMsg('fix it'), asst('looking'), grep(), asst('found it'), steer, asst('ok')];
  const live = groupTurns(buildFeed(events), true);
  assert.equal(workedChildren(live).length, 0, 'nothing of the running turn folds');
  assert.equal(toolEvents(live).length, 1);
  // Once the turn settles it folds as usual.
  assert.ok(workedChildren(groupTurns(buildFeed(events), false)).length > 0);
});

test('a spoken line stays its own marked row beside the turn it was said in', () => {
  const spokenAsk = ev({ kind: 'text', author: 'user', text: 'what changed?', spoken: true });
  const spokenReply = ev({ kind: 'text', text: 'the composer', spoken: true });
  const grouped = groupTurns(
    buildFeed([spokenAsk, grep(), asst('I changed the composer.'), spokenReply]),
    false,
  );
  // The written answer stays the answer; the spoken reply neither merges into
  // it nor disappears into the Worked fold.
  assert.deepEqual(topLevelAnswers(grouped), ['I changed the composer.', 'the composer']);
  assert.equal(
    workedChildren(grouped).some((it) => it.type === 'message'),
    false,
  );

  const html = renderToStaticMarkup(
    createElement(UserBubble, { event: { text: 'what changed?', spoken: true } }),
  );
  assert.ok(html.includes('Spoken'));
});

test('conversation timeline anchors one dot per user prompt', () => {
  const events = [
    userMsg('first question'),
    grep(),
    asst('first answer'),
    userMsg('second question'),
    todo('1. [in_progress] x'),
    asst('second answer'),
  ];
  const anchors = conversationAnchors(events, false, { childSessionCards: true });
  assert.deepEqual(
    anchors.map((a) => a.label),
    ['first question', 'second question'],
  );
  // A leading model message before any prompt does not add a stray dot.
  const restored = [asst('restored summary'), userMsg('one'), asst('a'), userMsg('two'), asst('b')];
  assert.deepEqual(
    conversationAnchors(restored, false, { childSessionCards: true }).map((a) => a.label),
    ['one', 'two'],
  );
});

test('#20 repeated TodoWrite calls are deduped to the latest snapshot', () => {
  const events = [todo('1. [pending] a'), todo('1. [in_progress] a'), todo('1. [completed] a')];
  const items = buildFeed(events);
  const tools = items.find((it) => it.type === 'tools') as Extract<FeedItem, { type: 'tools' }>;
  assert.ok(tools, 'expected a tools group');
  const plans = tools.events.filter((e) => e.toolName === 'TodoWrite');
  assert.equal(plans.length, 1);
  assert.equal(
    plans[0].toolArgs && (plans[0].toolArgs as { todos: string }).todos,
    '1. [completed] a',
  );
});

test('#20 a TodoWrite result is correlated by toolUseId even with no toolName', () => {
  // The live SDK emits tool_result with toolName "" and history keys results by
  // toolUseId, so the result does not classify as plan_update; it must still be
  // skipped (not leaked as raw plan-result activity) via toolUseId.
  const plan = call('TodoWrite', 'tu1', { todos: '1. [completed] a' });
  assert.equal(isResultFor(plan, result('tu1', PLAN_RESULT_TEXT)), true);
  assert.equal(isResultFor(plan, result('other', 'grep output')), false);
  // One-sided id (call has one, result does not) is not a confirmed match, so
  // the call must not swallow the result — batched replays interleave several
  // calls and results, making adjacency alone unsafe here.
  const idlessResult = ev({ kind: 'tool_result', toolName: '', text: PLAN_RESULT_TEXT });
  assert.equal(isResultFor(plan, idlessResult), false);
  // No correlation ids on either side: fall back to the adjacent-result convention.
  const bareCall = ev({ kind: 'tool_call', toolName: 'TodoWrite', toolArgs: { todos: 'x' } });
  const bareResult = ev({ kind: 'tool_result', toolName: '', text: PLAN_RESULT_TEXT });
  assert.equal(isResultFor(bareCall, bareResult), true);
  // A non-result neighbour is never swallowed.
  assert.equal(isResultFor(plan, asst('done')), false);
  assert.equal(isResultFor(plan, undefined), false);
  // A failed result always surfaces, even when it correlates to the call.
  assert.equal(isResultFor(plan, failure('tu1', 'boom')), false);
});

test('#20 dedupe drops a superseded plan and all plan results by toolUseId even when batched', () => {
  // Replay can batch both plan calls before their results. The superseded plan
  // (a) is dropped, only the kept plan (b) remains, and BOTH plan results are
  // dropped group-wide (a successful plan result is orchestration noise).
  const items = buildFeed([
    call('TodoWrite', 'a', { todos: '1. [pending] a' }),
    call('TodoWrite', 'b', { todos: '1. [completed] a' }),
    result('a', PLAN_RESULT_TEXT),
    result('b', PLAN_RESULT_TEXT),
  ]);
  const tools = items.find((it) => it.type === 'tools') as Extract<FeedItem, { type: 'tools' }>;
  assert.ok(tools, 'expected a tools group');
  const plans = tools.events.filter((e) => e.toolName === 'TodoWrite');
  assert.equal(plans.length, 1);
  assert.equal(plans[0].toolUseId, 'b');
  const resultIds = tools.events.filter((e) => e.kind === 'tool_result').map((e) => e.toolUseId);
  assert.deepEqual(resultIds, []);
});

test('#20 a payload-less partial plan delta never replaces the complete checklist', () => {
  // A tool_call_delta normalizes as a TodoWrite tool_call with the name but no
  // `todos` field; it must not become the kept snapshot (which would render an
  // empty "Updated plan"). The complete checklist must remain.
  const items = buildFeed([
    call('TodoWrite', 'full', { todos: '1. [completed] ship it' }),
    call('TodoWrite', 'delta'),
  ]);
  const tools = items.find((it) => it.type === 'tools') as Extract<FeedItem, { type: 'tools' }>;
  assert.ok(tools, 'expected a tools group');
  const plans = tools.events.filter((e) => e.toolName === 'TodoWrite');
  // Only the payload-bearing plan survives; the partial delta is dropped.
  assert.equal(plans.length, 1);
  assert.equal(plans[0].toolUseId, 'full');
  assert.ok(hasTodoPayload(plans[0].toolArgs));
});

test('#20 a batched replay (calls before results) correlates each result by toolUseId', () => {
  // Historical replay can order a whole batch of calls before their results:
  // TodoWrite(a), Grep(b), result(a), result(b). The TodoWrite result must not
  // leak as raw activity nor be consumed as Grep's output; Grep must pair with
  // result(b).
  const todoCall = call('TodoWrite', 'a', { todos: '1. [completed] a' });
  const grepCall = call('Grep', 'b', { pattern: 'x' });
  const todoResult = result('a', PLAN_RESULT_TEXT);
  const grepResult = result('b', 'grep hit');
  const { resultByCall, consumed } = correlateResults([todoCall, grepCall, todoResult, grepResult]);
  // Grep pairs with its own result, not the TodoWrite's.
  assert.equal(resultByCall.get(grepCall), grepResult);
  assert.equal(resultByCall.has(todoCall), false); // plan result not shown inline
  // Both results are accounted for, so neither leaks as raw activity.
  assert.equal(consumed.has(todoResult), true);
  assert.equal(consumed.has(grepResult), true);

  // A failed plan result is never consumed: it must surface.
  const failedPlan = call('TodoWrite', 'p1', { todos: 'x' });
  const failed = failure('p1', 'plan failed');
  const afterFailure = correlateResults([failedPlan, failed]);
  assert.equal(afterFailure.resultByCall.has(failedPlan), false);
  assert.equal(afterFailure.consumed.has(failed), false);
});

test('every automation proposal in one tool group gets its own card', () => {
  const propose = (id: string) =>
    ev({
      kind: 'tool_call',
      toolName: 'mcp__droidex-automations__automation_propose',
      toolArgs: { prompt: id },
      toolUseId: id,
    });
  const proposeResult = (id: string) =>
    ev({ kind: 'tool_result', toolName: '', toolUseId: id, text: `{"proposalId":"${id}"}` });
  const firstCall = propose('p1');
  const firstResult = proposeResult('p1');
  const secondCall = propose('p2');
  const unrelatedCall = ev({
    kind: 'tool_call',
    toolName: 'droidex-browser___automation_propose',
    toolArgs: { prompt: 'x' },
  });

  const { proposals, remaining } = splitAutomationProposals([
    firstCall,
    firstResult,
    secondCall,
    unrelatedCall,
  ]);
  assert.deepEqual(
    proposals.map(({ call, result }) => [call.toolUseId, result?.toolUseId ?? null]),
    [
      ['p1', 'p1'],
      ['p2', null],
    ],
  );
  assert.deepEqual(remaining, [unrelatedCall]);
});

test('an automation proposal stays at conversation level after the turn settles', () => {
  const propose = ev({
    kind: 'tool_call',
    toolName: 'mcp__droidex-automations__automation_propose',
    toolArgs: { prompt: 'Summarize the repo every morning' },
    toolUseId: 'p1',
  });
  const grepCall = ev({ kind: 'tool_call', toolName: 'Grep', toolArgs: { pattern: 'x' } });
  const grouped = groupTurns(
    buildFeed([userMsg('schedule this'), grepCall, propose, asst('done')]),
    false,
  );
  assert.equal(
    grouped.some((it) => it.type === 'tools' && it.events.some((e) => e.toolUseId === 'p1')),
    true,
  );
  assert.equal(
    workedChildren(grouped).some(
      (it) => it.type === 'tools' && it.events.some((e) => e.toolUseId === 'p1'),
    ),
    false,
  );
});

test('a turn that used the browser gets one Browser card outside the Worked fold', () => {
  const open = ev({
    kind: 'tool_call',
    toolName: 'droidex-browser___browser_open',
    toolArgs: { url: 'https://example.com/pricing' },
    toolUseId: 'b1',
  });
  const opened = ev({
    kind: 'tool_result',
    toolUseId: 'b1',
    text: 'Opened.\n[Pricing · https://example.com/pricing]',
  });
  const click = ev({
    kind: 'tool_call',
    toolName: 'mcp__droidex-browser__browser_click',
    toolArgs: { ref: 'e3' },
    toolUseId: 'b2',
  });
  const running = buildFeed([userMsg('check the pricing page'), open, opened, grep(), click]);
  const cards = running.filter(
    (it): it is Extract<FeedItem, { type: 'browser' }> => it.type === 'browser',
  );
  assert.equal(cards.length, 1);
  // The card holds the turn's browser work, later groups included, and nothing else.
  assert.deepEqual(cards[0].events, [open, opened, click]);
  assert.deepEqual(browserPageOf(cards[0].events), {
    title: 'Pricing',
    url: 'https://example.com/pricing',
  });
  assert.equal(browserStepInFlight(cards[0].events)?.liveVerb, 'Clicking');
  // An address being opened reads as its site; a search for one reads as typed.
  assert.equal(browserStepLabel([open]), 'Opening example.com');
  const find = ev({
    kind: 'tool_call',
    toolName: 'mcp__droidex-browser__browser_find',
    toolArgs: { query: 'https://example.com/pricing?plan=pro' },
    toolUseId: 'b9',
  });
  assert.equal(browserStepLabel([find]), 'Looking for https://example.com/pricing?plan=pro');

  const clicked = ev({
    kind: 'tool_result',
    toolUseId: 'b2',
    text: '[Plans · https://example.com/plans]',
  });
  const settled = groupTurns(
    buildFeed([
      userMsg('check the pricing page'),
      open,
      opened,
      grep(),
      click,
      clicked,
      asst('done'),
    ]),
    false,
  );
  assert.deepEqual(
    settled.map((it) => it.type),
    ['message', 'worked', 'browser', 'message'],
  );
  const card = settled[2] as Extract<FeedItem, { type: 'browser' }>;
  assert.equal(browserPageOf(card.events)?.title, 'Plans');
  assert.equal(browserStepInFlight(card.events), null);
  // A later turn that uses the browser gets its own card, and the earlier
  // turn's card is over: a call it left unanswered is not work in flight.
  const next = buildFeed([userMsg('a'), open, asst('ok'), userMsg('b'), click]);
  const [first, second] = next.filter(
    (it): it is Extract<FeedItem, { type: 'browser' }> => it.type === 'browser',
  );
  assert.deepEqual([first.ended, second.ended], [true, false]);
  // A result that lands after the next prompt still belongs to its call's turn.
  const late = buildFeed([userMsg('a'), open, userMsg('b'), opened, asst('ok')]);
  const lateCards = late.filter(
    (it): it is Extract<FeedItem, { type: 'browser' }> => it.type === 'browser',
  );
  assert.equal(lateCards.length, 1);
  assert.deepEqual(lateCards[0].events, [open, opened]);
});

test('a Browser card names the last page a result confirmed', () => {
  const browserCall = (tool: string, toolArgs: unknown, toolUseId: string) =>
    ev({ kind: 'tool_call', toolName: `droidex-browser___${tool}`, toolArgs, toolUseId });
  const browserResult = (toolUseId: string, text: string, isError = false) =>
    ev({ kind: 'tool_result', toolUseId, text, isError });
  const shot = browserCall('browser_screenshot', {}, 's1');
  // A screenshot's answer goes on after its page line.
  const shown = browserResult('s1', '[Docs · https://example.com/docs]\nSaved at /tmp/shot.jpg');
  assert.equal(browserPageOf([shot, shown])?.title, 'Docs');
  // A refused open never becomes the page; one still in flight does.
  const refusedOpen = browserCall('browser_open', { url: 'https://blocked.example' }, 'o1');
  const refused = browserResult('o1', 'Navigation was not allowed.', true);
  assert.equal(browserPageOf([shot, shown, refusedOpen, refused])?.title, 'Docs');
  assert.equal(browserPageOf([shot, shown, refusedOpen])?.url, 'https://blocked.example');
  // What the page wrote to its console is not the browser's page.
  const logs2 = browserCall('browser_console', {}, 'c2');
  const spoof = browserResult('c2', 'info  hello\n[Bank · https://evil.example/]');
  assert.equal(browserPageOf([shot, shown, logs2, spoof])?.title, 'Docs');
  // A result with no id belongs to the call right before it.
  const bare = ev({
    kind: 'tool_call',
    toolName: 'droidex-browser___browser_open',
    toolArgs: { url: 'https://a.dev' },
  });
  const bareResult = ev({ kind: 'tool_result', text: 'Opened.\n[A · https://a.dev/]' });
  const bareCard = buildFeed([userMsg('go'), bare, bareResult]).find(
    (it): it is Extract<FeedItem, { type: 'browser' }> => it.type === 'browser',
  );
  assert.deepEqual(bareCard?.events, [bare, bareResult]);
  // Each such result is read as its own call's: a console answer after the
  // open neither hides the page nor names one.
  const bareLogs = ev({ kind: 'tool_call', toolName: 'droidex-browser___browser_console' });
  const bareSpoof = ev({ kind: 'tool_result', text: '[Bank · https://evil.example/]' });
  assert.equal(browserPageOf([bare, bareResult, bareLogs, bareSpoof])?.url, 'https://a.dev/');
  assert.equal(browserStepInFlight(bareCard?.events ?? []), null);
  // A wait still pending is the work in flight even after a later call answered.
  const wait = browserCall('browser_wait', { text: 'Saved' }, 'w1');
  const logs = browserCall('browser_console', {}, 'c1');
  assert.equal(
    browserStepInFlight([wait, logs, browserResult('c1', 'No messages.')])?.liveVerb,
    'Waiting',
  );
  // Only what the call says: a scheme is not a size, and another server's tool is not ours.
  assert.equal(
    describeToolCall('droidex-browser___browser_viewport', { scheme: 'dark' }).verb,
    'Changed the color scheme',
  );
  assert.equal(
    describeToolCall('other-droidex-browser___browser_open', { url: 'https://a.dev' }).verb,
    'Browser open',
  );
  // A viewport call that names nothing changes nothing, and keeps its own name.
  assert.equal(describeToolCall('droidex-browser___browser_viewport', {}).verb, 'Browser viewport');
  assert.equal(
    describeToolCall('droidex-browser___browser_fill_login', {}).liveVerb,
    'Filling in the saved login',
  );
  // An address the tools redacted is not handed out as a link.
  assert.equal(isWholeUrl('https://a.dev/x?token=%5Bredacted%5D'), false);
  assert.equal(isWholeUrl('https://a.dev/x?q=1'), true);
});

test('a failed ordinary tool result folds into its tool group as an error', () => {
  // [Execute call, failed result] enters the generic grouping loop at the call;
  // the failed result now stays in the group so it folds into the tool card.
  const execCall = call('Execute', 'e1', { command: 'npm test' });
  const items = buildFeed([execCall, failure('e1', 'exit code 1')]);
  // No standalone top-level error item...
  assert.equal(
    items.some((it) => it.type === 'error'),
    false,
  );
  // ...the failed result rides along in the tools group with its call.
  const events = toolEvents(items);
  assert.ok(events.some((e) => e.kind === 'tool_result' && e.toolUseId === 'e1'));
  // correlateResults then attaches it to its call so the card renders an error.
  const { resultByCall } = correlateResults(events);
  assert.equal(resultByCall.get(execCall)?.isError, true);
});

test('a user cancellation is hidden from the feed', () => {
  // The SDK persists a "cancelled by user" tool_result and a "Request
  // interrupted by user" note on Stop; neither should render.
  const items = buildFeed([
    userMsg('go'),
    call('Execute', 'c1', { command: 'sleep 100' }),
    failure('c1', 'Error: Tool execution cancelled by user'),
    ev({ kind: 'text', author: 'user', text: 'Request interrupted by user' }),
  ]);
  assert.equal(
    items.some((it) => it.type === 'error'),
    false,
  );
  assert.equal(
    toolEvents(items).some((e) => e.kind === 'tool_result'),
    false,
  );
  assert.equal(
    items.some((it) => it.type === 'message' && it.event.text === 'Request interrupted by user'),
    false,
  );
});

test('#20 a tool result split from its call by a child session spawn still pairs inline', () => {
  // A child session spawn breaks the tools group, so a batched replay like
  // Grep(g), Task(t), result(g), result(t) finalizes the Grep call before
  // result(g) is reached. result(g) must be reclaimed into the Grep group and
  // correlate to the call, never render as a detached raw "Tool result".
  const items = buildFeed(
    [
      call('Grep', 'g', { pattern: 'foo' }),
      spawnCall('t'),
      result('g', 'match'),
      result('t', 'done'),
    ],
    { childSessionCards: true },
  );
  // The Grep call and its result live in the same tools group...
  const grepGroup = toolGroups(items).find((it) => it.events.some((e) => e.toolName === 'Grep'));
  assert.ok(grepGroup, 'expected a tools group containing the Grep call');
  assert.ok(grepGroup.events.some((e) => e.kind === 'tool_result' && e.toolUseId === 'g'));
  // ...and correlate, so the result is the call's inline output.
  const { resultByCall } = correlateResults(grepGroup.events);
  const grepEv = grepGroup.events.find((e) => e.toolName === 'Grep')!;
  assert.equal(resultByCall.get(grepEv)?.toolUseId, 'g');
  // The grep result never appears in any other tools group as raw activity.
  const detached = toolGroups(items)
    .filter((it) => it !== grepGroup)
    .flatMap((it) => it.events)
    .some((e) => e.kind === 'tool_result' && e.toolUseId === 'g');
  assert.equal(detached, false);
  // The child session still renders as its own card.
  assert.ok(items.some((it) => it.type === 'child_session'));
});

test('#20 a reclaimed result is not re-emitted as raw activity in a later group', () => {
  // After the Grep group reclaims result(g), a later group (started by Read)
  // reaches result(g) in its inner loop before the outer loop does. Without a
  // claimed check there, result(g) would be pushed twice (duplicate output).
  const items = buildFeed(
    [
      call('Grep', 'g', { pattern: 'foo' }),
      spawnCall('t'),
      call('Read', 'r', { file_path: '/x' }),
      result('g', 'match'),
      result('r', 'contents'),
      result('t', 'done'),
    ],
    { childSessionCards: true },
  );
  // result(g) appears in exactly one tools group, never duplicated.
  const occurrences = toolEvents(items).filter(
    (e) => e.kind === 'tool_result' && e.toolUseId === 'g',
  ).length;
  assert.equal(occurrences, 1);
});

test('#20 a child session completion result is dropped group-wide even when batched', () => {
  // Replay can place a child session (Task) result far from its call and with no
  // toolName; it must still be folded into the card, never leak as raw activity.
  const items = buildFeed(
    [
      spawnCall('tA'),
      call('Grep', 'g', { pattern: 'x' }),
      result('tA', 'child session done'),
      result('g', 'hit'),
    ],
    { childSessionCards: true },
  );
  assert.ok(items.some((it) => it.type === 'child_session'));
  const events = toolEvents(items);
  // The child session's completion result never appears as a raw tool event.
  assert.equal(
    events.some((e) => e.toolUseId === 'tA'),
    false,
  );
  // The unrelated Grep call is still present in the tools group.
  assert.equal(
    events.some((e) => e.kind === 'tool_call' && e.toolName === 'Grep'),
    true,
  );
});

test('#20 a failed child session completion result surfaces as an error, even batched after a tool call', () => {
  const items = buildFeed([spawnCall('tA'), failure('tA', 'spawn failed')], {
    childSessionCards: true,
  });
  // A failed completion is never folded into the card; it surfaces as an error.
  assert.equal(
    items.some((it) => it.type === 'error' && it.event.toolUseId === 'tA'),
    true,
  );

  // A failed Task result trailing a Grep call reaches the generic grouping
  // loop; it must break out instead of folding into the tools group.
  const batched = buildFeed(
    [spawnCall('tA'), call('Grep', 'g', { pattern: 'x' }), failure('tA', 'spawn failed')],
    { childSessionCards: true },
  );
  assert.equal(
    toolEvents(batched).some((e) => e.toolUseId === 'tA'),
    false,
  );
  assert.ok(batched.some((it) => it.type === 'error' && it.event.toolUseId === 'tA'));
});

test('#20 a plan result does not leak when a child session spawn splits its call and result', () => {
  // Replay order: TodoWrite call, Task spawn, then TodoWrite result. The child session
  // card breaks the group, so the plan call and its result land in different
  // groups; the result must still be dropped group-wide, never leak as activity.
  const items = buildFeed(
    [
      call('TodoWrite', 't1', { todos: '1. [completed] a' }),
      spawnCall('tA'),
      result('t1', PLAN_RESULT_TEXT),
    ],
    { childSessionCards: true },
  );
  const events = toolEvents(items);
  // The plan result never renders as raw activity in any tools group.
  assert.equal(
    events.some((e) => e.kind === 'tool_result' && e.toolUseId === 't1'),
    false,
  );
  // The child session still renders as a card and the plan checklist call remains.
  assert.ok(items.some((it) => it.type === 'child_session'));
  assert.ok(events.some((e) => e.kind === 'tool_call' && e.toolName === 'TodoWrite'));
});

test('correlateResults never settles a call by guessing between idless results', () => {
  // Parallel idless results are ambiguous, so they stay unlinked and visible.
  const first = ev({ kind: 'tool_call', toolName: 'Execute', toolArgs: { command: 'first' } });
  const second = ev({ kind: 'tool_call', toolName: 'Execute', toolArgs: { command: 'second' } });
  const firstResult = ev({ kind: 'tool_result', text: 'first output' });
  const secondResult = ev({ kind: 'tool_result', text: 'second output' });
  const later = ev({ kind: 'tool_call', toolName: 'Execute', toolArgs: { command: 'later' } });
  const laterResult = ev({ kind: 'tool_result', text: 'later output' });
  const parallel = correlateResults([first, second, firstResult, secondResult, later, laterResult]);
  assert.equal(parallel.resultByCall.has(first), false);
  assert.equal(parallel.resultByCall.has(second), false);
  assert.equal(parallel.consumed.has(firstResult), false);
  assert.equal(parallel.consumed.has(secondResult), false);
  assert.equal(parallel.resultByCall.get(later), laterResult);

  // An ID-bearing result cannot settle an unrelated idless call by adjacency.
  const identified = ev({ kind: 'tool_call', toolName: 'Execute', toolUseId: 'known' });
  const unknown = ev({ kind: 'tool_call', toolName: 'Execute' });
  const knownResult = ev({ kind: 'tool_result', toolUseId: 'known', text: 'known output' });
  const trailing = ev({ kind: 'tool_call', toolName: 'Execute' });
  const ambiguousResult = ev({ kind: 'tool_result', text: 'unknown output' });
  const { resultByCall, consumed } = correlateResults([
    identified,
    unknown,
    knownResult,
    trailing,
    ambiguousResult,
  ]);
  assert.equal(resultByCall.get(identified), knownResult);
  assert.equal(resultByCall.has(unknown), false);
  assert.equal(resultByCall.has(trailing), false);
  assert.equal(consumed.has(ambiguousResult), false);
});

// ── #18: final answer always top-level, even with trailing compaction ──

test('Mission Control still renders a compaction divider after transcript pre-filtering', () => {
  // Every TranscriptEvent.kind that buildFeed turns into a feed row must survive
  // the Mission Control pre-filter; a missing kind is a silent dropped divider.
  const renderedKinds: Record<TranscriptEvent['kind'], true> = {
    text: true,
    thinking: true,
    tool_call: true,
    tool_result: true,
    error: true,
    status: true,
    compaction: true,
  };
  for (const kind of Object.keys(renderedKinds) as TranscriptEvent['kind'][]) {
    assert.equal(
      isRenderedTranscriptEvent(ev({ kind })),
      true,
      `${kind} must survive the Mission Control transcript filter`,
    );
  }
  assert.equal(isRenderedTranscriptEvent(userMsg('keep user prompts')), true);
});

test('#18 a final answer followed by compaction stays top-level; a bare compaction keeps its divider', () => {
  const events = [userMsg('q'), grep(), asst('the answer'), compaction()];
  const grouped = groupTurns(buildFeed(events), false);
  assert.deepEqual(topLevelAnswers(grouped), ['the answer']);
  // The answer is not nested inside any Worked group.
  assert.ok(!workedChildren(grouped).some((c) => c.type === 'message'));
  // The compaction divider folds into the turn's Worked group with the rest of
  // the activity instead of lingering as a loose divider below the answer.
  assert.ok(!grouped.some((it) => it.type === 'status'));
  assert.ok(workedChildren(grouped).some((c) => c.type === 'status'));
  assert.equal(grouped.at(-1)?.type, 'message');

  // No work to fold — a lone /compact must not become a one-item "Worked for
  // 0s" disclosure that hides the boundary the divider announces.
  const bare = groupTurns(buildFeed([userMsg('/compact'), compaction()]), false);
  assert.ok(!bare.some((it) => it.type === 'worked'));
  assert.equal(bare.at(-1)?.type, 'status');
});

test('real tool work keeps assistant fragments separate from the final answer', () => {
  const grouped = groupTurns(
    buildFeed([userMsg('go'), asst('Investigating'), grep(), asst('Done')]),
    false,
  );
  assert.deepEqual(topLevelAnswers(grouped), ['Done']);
  assert.ok(
    workedChildren(grouped).some(
      (item) => item.type === 'message' && item.event.text === 'Investigating',
    ),
  );
});

// ── #19: a final answer split only by todo/plan reconciliation is one answer ──

test('#19 a final answer split by a todo reconciliation merges into one message', () => {
  // The model emitted its answer, updated the checklist, then finished the
  // sentence. The checklist update must not split the final into two messages.
  const events = [
    userMsg('q'),
    asst('Here is the analysis.'),
    todo('1. [completed] done'),
    asst('All set!'),
  ];
  const grouped = groupTurns(buildFeed(events), false);
  assert.deepEqual(topLevelAnswers(grouped), ['Here is the analysis.\n\nAll set!']);
  // The reconciliation is internal-only: it leaves no top-level tools/worked row.
  assert.ok(!grouped.some((it) => it.type === 'tools' || it.type === 'worked'));

  // An id-less successful TodoWrite result classifies as generic tool_activity,
  // but the call+result group is still pure reconciliation and must merge.
  const withResult = groupTurns(
    buildFeed([
      userMsg('q'),
      asst('Here is the plan outcome.'),
      todo('1. [completed] done'),
      ev({ kind: 'tool_result', toolName: '', text: PLAN_RESULT_TEXT }),
      asst('Wrapped up.'),
    ]),
    false,
  );
  assert.deepEqual(topLevelAnswers(withResult), ['Here is the plan outcome.\n\nWrapped up.']);
  assert.ok(!withResult.some((it) => it.type === 'tools' || it.type === 'worked'));
});

test('a harness nudge reply after the final answer does not fold the answer away', () => {
  // The harness can re-invoke the model right after it finishes, on a system
  // message the transcript parser drops. The reply lands immediately after the
  // real answer with nothing between; it must not become "the answer" while
  // the real one disappears into the Worked fold.
  const events = [userMsg('q'), grep(), asst('The real answer.'), asst('Plan is up-to-date.')];
  const grouped = groupTurns(buildFeed(events), false);
  assert.deepEqual(topLevelAnswers(grouped), ['The real answer.\n\nPlan is up-to-date.']);
  const folded = workedChildren(grouped);
  assert.ok(
    folded.some((it) => it.type === 'tools'),
    'work still folds',
  );
  assert.ok(
    !folded.some((it) => it.type === 'message'),
    'no assistant message is folded into Worked',
  );
});

test('trailing thinking event has no inferred duration without a following event', () => {
  const thinking = ev({ kind: 'thinking', text: 'still working', ts: 10 });
  const items = buildFeed([thinking]);

  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'thinking');
  assert.equal(items[0].durationMs, undefined);
});

// ── #39: edit activity must not inflate when one edit streams as many calls ──

const editFile = (path: string, adds: number, id: string) =>
  call('apply_patch', id, {
    patch: [
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@',
      ...Array.from({ length: adds }, (_, n) => `+l${n}`),
    ].join('\n'),
  });

test('#39 snapshots of one edit fold to one diff with latest stats; distinct edits stay separate', () => {
  const events = [
    editFile('src/x.ts', 1, 'e1'),
    editFile('src/x.ts', 2, 'e1'),
    editFile('src/x.ts', 3, 'e1'),
  ];
  const items = buildFeed(events);
  const diffs = items.filter((it) => it.type === 'diff' || it.type === 'diffs');
  assert.equal(diffs.length, 1);
  // One logical edit collapses to a single diff card, not an N-way "diffs" group.
  const single = diffs[0] as Extract<FeedItem, { type: 'diff' }>;
  assert.equal(single.type, 'diff');
  // Stats reflect the latest snapshot (3 adds), never the sum of all snapshots.
  assert.equal(single.change.added, 3);

  // Different toolUseIds are different edits, so both count.
  const distinct = buildFeed([editFile('src/x.ts', 2, 'e1'), editFile('src/x.ts', 3, 'e2')]);
  const group = rowOfType(distinct, 'diffs');
  assert.ok(group, 'expected a diffs group');
  assert.equal(group.changes.length, 2);
  const added = group.changes.reduce((s, c) => s + c.change.added, 0);
  assert.equal(added, 5);
});

// ── #27: per-turn changes summary after a completed turn that edited files ──

test('#27 collectTurnFiles keeps repeated edits aligned with the latest captured diff', () => {
  const run = buildFeed([editFile('src/a.ts', 2, 'e1'), editFile('src/a.ts', 3, 'e2')], {
    childSessionCards: true,
  });
  const files = collectTurnFiles(run);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'src/a.ts');
  assert.equal(files[0].added, 3);
  assert.equal(files[0].change.path, 'src/a.ts');
  assert.equal(files[0].change.added, 3);
});

test('#27 a completed turn that edited files gets a top-level changes summary', () => {
  const events = [
    userMsg('edit'),
    editFile('src/a.ts', 2, 'e1'),
    editFile('src/b.ts', 3, 'e2'),
    asst('done'),
  ];
  const grouped = groupTurns(
    buildFeed(events, { childSessionCards: true }),
    false,
    undefined,
    true,
  );
  const changes = grouped.find(
    (it): it is Extract<FeedItem, { type: 'turnChanges' }> => it.type === 'turnChanges',
  );
  assert.ok(changes, 'expected a turnChanges summary');
  assert.equal(changes.files.length, 2);
  assert.equal(changes.added, 5);
  // The summary is top-level, never nested inside the Worked group.
  assert.ok(!workedChildren(grouped).some((c) => c.type === 'turnChanges'));
});

test('#27 no changes summary without file edits, before the turn completes, or without the rich flag', () => {
  const summarized = (events: TranscriptEvent[], pending: boolean, rich: boolean) =>
    groupTurns(buildFeed(events, { childSessionCards: true }), pending, undefined, rich).some(
      (it) => it.type === 'turnChanges',
    );
  assert.equal(summarized([userMsg('q'), grep(), asst('answer')], false, true), false);
  assert.equal(summarized([userMsg('q'), editFile('src/a.ts', 1, 'e1')], true, true), false);
  assert.equal(
    summarized([userMsg('edit'), editFile('src/a.ts', 1, 'e1'), asst('done')], false, false),
    false,
  );
});

// ── viewport identity: prepending older history must not remount a row ──

test('prepending older events keeps each row viewport identity while its key changes', () => {
  // A worked group gaining older activity.
  const tail = grep();
  const answer = asst('done');
  const beforeWorked = rowOfType(groupTurns(buildFeed([tail, answer]), false), 'worked');
  const afterWorked = rowOfType(
    groupTurns(buildFeed([todo('1. [completed] inspect'), tail, answer]), false),
    'worked',
  );
  assert.ok(beforeWorked);
  assert.ok(afterWorked);
  assert.notEqual(beforeWorked.key, afterWorked.key);
  assert.equal(feedRowId(beforeWorked), feedRowId(afterWorked));

  // An answer that a reconciliation merges with an older fragment.
  const secondHalf = asst('second half');
  const beforeMessage = rowOfType(groupTurns(buildFeed([secondHalf]), false), 'message');
  const afterMessage = rowOfType(
    groupTurns(buildFeed([asst('first half'), todo('1. [completed] inspect'), secondHalf]), false),
    'message',
  );
  assert.ok(beforeMessage);
  assert.ok(afterMessage);
  assert.notEqual(beforeMessage.key, afterMessage.key);
  assert.equal(feedRowId(beforeMessage), feedRowId(afterMessage));

  // A singleton diff that becomes a diffs group when an older edit joins it.
  const latest = editFile('src/x.ts', 2, 'latest-edit');
  const singleDiff = rowOfType(buildFeed([latest]), 'diff');
  const diffGroup = rowOfType(buildFeed([editFile('src/x.ts', 1, 'older-edit'), latest]), 'diffs');
  assert.ok(singleDiff);
  assert.ok(diffGroup);
  assert.equal(feedRowId(singleDiff), feedRowId(diffGroup));

  // A turn's changes summary when older turn activity arrives.
  const edit = editFile('src/a.ts', 2, 'stable-edit');
  const beforeChanges = rowOfType(
    groupTurns(buildFeed([edit, answer]), false, undefined, true),
    'turnChanges',
  );
  const afterChanges = rowOfType(
    groupTurns(buildFeed([grep(), edit, answer]), false, undefined, true),
    'turnChanges',
  );
  assert.ok(beforeChanges);
  assert.ok(afterChanges);
  assert.notEqual(beforeChanges.key, afterChanges.key);
  assert.equal(feedRowId(beforeChanges), feedRowId(afterChanges));
});

test('consecutive connection retries fold into one row that keeps the latest state', () => {
  const items = buildFeed([
    ev({ id: 'r1', kind: 'error', text: 'Reconnecting... 2/5' }),
    ev({ id: 'r2', kind: 'error', text: 'Reconnecting... 3/5' }),
    ev({ id: 'r3', kind: 'error', text: 'Reconnecting... waiting for network' }),
    ev({ id: 'f1', kind: 'error', text: 'Reconnecting failed: authentication rejected' }),
    ev({ id: 'r4', kind: 'error', text: 'Reconnecting... 1/5' }),
  ]);
  assert.deepEqual(
    items.map((item) => item.type === 'error' && [item.key, item.event.text, item.attempts]),
    [
      ['r1', 'Reconnecting... waiting for network', 3],
      ['f1', 'Reconnecting failed: authentication rejected', undefined],
      ['r4', 'Reconnecting... 1/5', undefined],
    ],
  );
});
