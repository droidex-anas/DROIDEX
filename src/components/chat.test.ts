import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  childSessionLineIsRunning,
  feedItemPropsEqual,
  fetchSizeBadge,
  sameFeedEvents,
  UserBubble,
  WebFetchBody,
  FeedItemView,
  type FeedItemViewProps,
} from './chat';
import { MessageFeed } from './MessageFeed';
import { DiffCard } from './DiffView';
import { buildFeed, type FeedItem } from './chatFeed';
import { groupTurns } from './chatFeedTurns';
import { EarlierHistoryControl, isConversationOpeningSettling } from './ChatView';
import {
  createDiffDisclosure,
  mountNextRevealedDiffCards,
  nextDiffCardCount,
  reopenDiffDisclosure,
  revealNextDiffCards,
} from '../lib/diff';
import { parseTruncatedTail } from '../lib/tools';
import type { ChildSessionSummary, TranscriptEvent } from '../types/bridge';

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
const todo = (todos: string) =>
  ev({ kind: 'tool_call', toolName: 'TodoWrite', toolArgs: { todos } });
const grep = () => ev({ kind: 'tool_call', toolName: 'Grep', toolArgs: { pattern: 'x' } });

// Find all top-level assistant chat messages (non-user) in a grouped feed.
function topLevelAnswers(items: FeedItem[]): string[] {
  return items
    .filter((it): it is Extract<FeedItem, { type: 'message' }> => it.type === 'message')
    .filter((it) => it.event.author !== 'user')
    .map((it) => it.event.text ?? '');
}

test('parent liveness cannot make paused historical child activity look running', () => {
  assert.equal(childSessionLineIsRunning({ status: 'paused' }), false);
  assert.equal(childSessionLineIsRunning({ status: 'completed' }), false);
  assert.equal(childSessionLineIsRunning({ status: 'running' }), true);
});

test('a sent prompt shows Visualize and skill chips instead of slash text', () => {
  const html = renderToStaticMarkup(
    createElement(UserBubble, {
      event: { text: '/visualize /review PR #100', skills: ['review'] },
    }),
  );
  assert.equal(html.includes('/visualize') || html.includes('/review'), false);
  assert.ok(html.includes('Visualize'));
  assert.ok(html.indexOf('review') < html.indexOf('PR #100'));
});

test('a pending steer with design marks and side-chat replies offers Send now without text', () => {
  const html = renderToStaticMarkup(
    createElement(UserBubble, {
      event: {
        text: '',
        browserRefs: [{ id: 'heading', kind: 'element', label: 'Heading' }],
        sideChatReplies: ['Use the same spacing as the title.'],
      },
      onSendNow: () => {},
    }),
  );
  assert.match(html, /@Heading/);
  assert.match(html, /1 message/);
  assert.match(html, /aria-label="Send now"/);
});

test('a pinned spec alone never produces an empty Worked disclosure', () => {
  const spec = '# Plan\n\nImplement the feature';
  const events = [userMsg('plan'), asst(spec)];
  const grouped = groupTurns(buildFeed(events), false, spec);
  assert.equal(grouped.length, 1);
  const html = renderToStaticMarkup(
    createElement(MessageFeed, {
      events,
      pending: false,
      specContent: spec,
    }),
  );
  assert.doesNotMatch(html, /Worked/);
});

test('Read output is visible in detailed density and expandable in balanced density', () => {
  const call = ev({
    kind: 'tool_call',
    toolName: 'Read',
    toolUseId: 'read-1',
    toolArgs: { file_path: 'src/app.ts' },
  });
  const result = ev({
    kind: 'tool_result',
    toolName: 'Read',
    toolUseId: 'read-1',
    text: 'export const inspected = true;',
  });
  const item: FeedItem = { type: 'tools', key: 'read', events: [call, result] };
  const detailed = renderToStaticMarkup(
    createElement(FeedItemView, { item, live: false, density: 'detailed' }),
  );
  const balanced = renderToStaticMarkup(
    createElement(FeedItemView, { item, live: false, density: 'balanced' }),
  );
  assert.match(detailed, /export const inspected = true;/);
  assert.match(balanced, /aria-expanded="false"/);
  assert.match(balanced, /inert=""/);
});

// ── #14: spec mode must not capture normal chat responses ──

test('#14 a spec only suppresses the assistant message that is exactly the spec text', () => {
  const spec = '# Specification\n\nThe one and only spec body';
  const normal = renderToStaticMarkup(
    createElement(MessageFeed, {
      events: [userMsg('hi'), asst('a perfectly normal answer')],
      pending: false,
      specContent: spec,
    }),
  );
  // The normal answer is NOT swallowed by the spec surface just because spec
  // content is present (the old blanket spec-draft suppression bug).
  assert.ok(normal.includes('a perfectly normal answer'));

  const html = renderToStaticMarkup(
    createElement(MessageFeed, {
      events: [userMsg('hi'), asst(spec)],
      pending: false,
      specContent: spec,
    }),
  );
  // The pinned spec card is present (its title renders)...
  assert.ok(html.includes('Specification'));
  // ...and the identical assistant message is suppressed from the chat stream,
  // so the spec body is not duplicated as a normal chat row (the card body is
  // collapsed by default, hence absent here).
  const occurrences = html.split('The one and only spec body').length - 1;
  assert.equal(occurrences, 0);
});

test('#19/#14 a spec fragment split by reconciliation is not merged into prose', () => {
  // prose -> TodoWrite reconciliation -> exact spec text. The #19 merge must NOT
  // fold the spec fragment into the prose, or the merged row would no longer
  // match the spec exactly and FeedItemView would render the spec body twice.
  const spec = '# Specification\n\nThe sole spec body line';
  const events = [
    userMsg('draft the spec'),
    asst('Here is the plan.'),
    todo('1. [completed] x'),
    asst(spec),
  ];
  const grouped = groupTurns(buildFeed(events), false, spec);
  // The spec fragment is never concatenated onto the prose (an exact-match
  // fragment is suppressible; a merged row would render the spec body twice).
  assert.deepEqual(topLevelAnswers(grouped), ['Here is the plan.']);
  const html = renderToStaticMarkup(
    createElement(MessageFeed, { events, pending: false, specContent: spec }),
  );
  assert.ok(html.includes('Here is the plan.'));
  assert.equal(html.split('The sole spec body line').length - 1, 0);
});

test('an incomplete live App owns its building state without exposing Play or a trailing caret', () => {
  const incompleteApp = [
    'Preparing the visualization.',
    '',
    '```app',
    '<main><script>const points = [',
  ].join('\n');
  const html = renderToStaticMarkup(
    createElement(MessageFeed, { events: [asst(incompleteApp)], pending: true }),
  );

  assert.match(html, /Building interactive app/);
  assert.match(html, /role="status"/);
  assert.doesNotMatch(html, /aria-label="Play app"/);
  assert.doesNotMatch(html, /caret-blink/);
  assert.doesNotMatch(html, />Starting interactive app</);
});

// The caret is the only cue while prose streams (drawn by CSS on the typing
// message); Working takes over once the stream idles, never alongside it.
test('ordinary live prose shows the streaming caret and no Working cue', () => {
  const html = renderToStaticMarkup(
    createElement(MessageFeed, { events: [asst('Still writing')], pending: true }),
  );

  assert.match(html, /md-typing/);
  assert.doesNotMatch(html, /Working/);
});

test('a running child-session tail without toolUseId still suppresses the Working cue', () => {
  const spawnEvent = ev({
    kind: 'tool_call',
    toolName: 'Task',
    toolArgs: { subagent_type: 'explorer', description: 'look around' },
  });
  const html = renderToStaticMarkup(
    createElement(MessageFeed, {
      events: [userMsg('go'), spawnEvent],
      pending: true,
      childSessionActivity: (target) =>
        target.toolUseId === spawnEvent.id ? { status: 'running' } : undefined,
    }),
  );
  assert.match(html, /Running/);
  assert.doesNotMatch(html, /Working/);
});

test('live thinking stays collapsed until the user opens it', () => {
  const events = [
    userMsg('inspect this'),
    ev({ kind: 'thinking', text: 'private live reasoning detail' }),
  ];
  const html = renderToStaticMarkup(createElement(MessageFeed, { events, pending: true }));

  assert.ok(html.includes('Thinking'));
  assert.equal(html.includes('private live reasoning detail'), false);
});

test('diff disclosure grows and remounts in bounded commits, preserving reveal progress', () => {
  assert.equal(nextDiffCardCount(50, 500), 100);
  assert.equal(nextDiffCardCount(100, 125), 125);
  assert.equal(nextDiffCardCount(125, 125), 125);

  let disclosure = createDiffDisclosure(500);
  for (let count = 50; count < 200; count += 50) {
    disclosure = revealNextDiffCards(disclosure, 500);
    disclosure = mountNextRevealedDiffCards(disclosure, 500);
  }
  assert.deepEqual(disclosure, { revealedCount: 200, mountedCount: 200 });

  disclosure = reopenDiffDisclosure(disclosure, 500);
  assert.deepEqual(disclosure, { revealedCount: 200, mountedCount: 50 });

  for (let count = 50; count < 200; count += 50) {
    disclosure = mountNextRevealedDiffCards(disclosure, 500);
    assert.equal(disclosure.mountedCount, count + 50);
    assert.equal(disclosure.revealedCount, 200);
  }
});

test('opening an old chat keeps the skeleton up until timeline priming settles', () => {
  const settling = {
    isConversationLive: false,
    isViewingChildSession: false,
    isTimelinePriming: true,
    hasOlderHistory: true,
    isLoadingOlder: false,
  };
  assert.equal(isConversationOpeningSettling(settling), true);
  // The last priming page is still in flight after the cursor was consumed.
  assert.equal(
    isConversationOpeningSettling({ ...settling, hasOlderHistory: false, isLoadingOlder: true }),
    true,
  );
  // Enough anchors: the rail is ready, the feed takes over.
  assert.equal(isConversationOpeningSettling({ ...settling, isTimelinePriming: false }), false);
  // History exhausted with nothing in flight: a short thread never re-covers.
  assert.equal(isConversationOpeningSettling({ ...settling, hasOlderHistory: false }), false);
  // Streaming output outranks a quiet open.
  assert.equal(isConversationOpeningSettling({ ...settling, isConversationLive: true }), false);
  assert.equal(isConversationOpeningSettling({ ...settling, isViewingChildSession: true }), false);
});

test('history paging uses a persistent live region whose text changes in place', () => {
  const idle = renderToStaticMarkup(
    createElement(EarlierHistoryControl, { hasMore: true, loading: false }),
  );
  const loading = renderToStaticMarkup(
    createElement(EarlierHistoryControl, { hasMore: true, loading: true }),
  );
  const exhausted = renderToStaticMarkup(
    createElement(EarlierHistoryControl, { hasMore: false, loading: false }),
  );

  for (const markup of [idle, loading, exhausted]) {
    assert.match(markup, /aria-atomic="true"/);
    assert.match(markup, /aria-live="polite"/);
    assert.doesNotMatch(markup, /<button/);
  }
  // While more history exists the row holds its height so an arriving page
  // never nudges the reading position; only the in-flight state speaks.
  assert.doesNotMatch(idle, /Loading earlier messages/);
  assert.match(loading, /Loading earlier messages…/);
  assert.doesNotMatch(exhausted, /Loading earlier messages/);
});

test('MessageFeed strips the truncation sentinel and shows no truncation note', () => {
  const { body, truncatedChars } = parseTruncatedTail('Answer text.\n\n[truncated 1252663 chars]');
  assert.equal(body, 'Answer text.');
  assert.equal(truncatedChars, 1252663);

  const events = [userMsg('hi'), asst('Big answer body.\n\n[truncated 2048 chars]')];
  const html = renderToStaticMarkup(createElement(MessageFeed, { events, pending: false }));
  assert.ok(html.includes('Big answer body.'));
  assert.equal(html.includes('[truncated'), false);
  assert.equal(html.includes('characters truncated'), false);
});

test('a settled prior answer stays copyable while a later turn is streaming', () => {
  const events = [
    userMsg('first'),
    asst('Settled prior answer'),
    userMsg('second'),
    asst('Still writing'),
  ];
  const copyNear = (html: string, snippet: string): boolean => {
    const index = html.indexOf(snippet);
    if (index < 0) return false;
    return html
      .slice(Math.max(0, index - 500), index + snippet.length + 500)
      .includes('aria-label="Copy response"');
  };
  const pending = renderToStaticMarkup(createElement(MessageFeed, { events, pending: true }));
  const idle = renderToStaticMarkup(createElement(MessageFeed, { events, pending: false }));
  assert.equal(copyNear(pending, 'Settled prior answer'), true);
  assert.equal(copyNear(pending, 'Still writing'), false);
  assert.equal(copyNear(idle, 'Settled prior answer'), true);
  assert.equal(copyNear(idle, 'Still writing'), true);
});

test('an idle chat offers Fork on its latest answer and on earlier answers with a fork point', () => {
  const events = [
    userMsg('first'),
    asst('Unrecorded answer'),
    userMsg('second'),
    { ...asst('Earlier answer'), forkPointId: 'turn-2' },
    userMsg('third'),
    asst('Latest answer'),
  ];
  const onFork = () => {};
  const forkButtons = (html: string): number => html.split('aria-label="Fork chat"').length - 1;
  const idle = renderToStaticMarkup(createElement(MessageFeed, { events, pending: false, onFork }));
  const pending = renderToStaticMarkup(
    createElement(MessageFeed, { events, pending: true, onFork }),
  );
  assert.equal(forkButtons(idle), 2);
  const firstFork = idle.indexOf('aria-label="Fork chat"');
  assert.ok(firstFork > idle.indexOf('Earlier answer') && firstFork < idle.indexOf('third'));
  assert.ok(idle.lastIndexOf('aria-label="Fork chat"') > idle.indexOf('Latest answer'));
  assert.equal(forkButtons(pending), 0);
});

test('a forked chat marks where its inherited history ends', () => {
  const inherited = [
    { ...userMsg('copied question'), ts: 1 },
    { ...asst('copied answer'), ts: 2 },
  ];
  const forkedFrom = { forkedAt: 10, onOpenSource: () => {} };
  const render = (events: TranscriptEvent[]): string =>
    renderToStaticMarkup(createElement(MessageFeed, { events, pending: false, forkedFrom }));
  const justForked = render(inherited);
  assert.ok(justForked.indexOf('Forked from chat') > justForked.indexOf('copied answer'));
  const continued = render([...inherited, { ...userMsg('new question'), ts: 11 }]);
  const divider = continued.indexOf('Forked from chat');
  assert.ok(divider > continued.indexOf('copied answer'));
  assert.ok(divider < continued.indexOf('new question'));
});

test('inline diff cards display paths relative to the session folder', () => {
  const change = {
    path: '/Users/dev/repo/packages/web/src/app.ts',
    verb: 'edit' as const,
    ops: [],
    added: 1,
    removed: 0,
  };
  const html = renderToStaticMarkup(
    createElement(FeedItemView, {
      item: { type: 'diff', key: 'd1', event: ev({}), change },
      live: false,
      cwd: '/Users/dev/repo',
    }),
  );
  assert.equal(html.includes('packages/web/src/app.ts'), true);
  assert.equal(html.includes('…/'), false);
});

test('both inline diff toggles expose expansion when no review handler exists', () => {
  const change = {
    path: 'src/app.ts',
    verb: 'edit' as const,
    added: 1,
    removed: 0,
    ops: [{ type: 'add' as const, text: 'added' }],
  };
  const inline = renderToStaticMarkup(createElement(DiffCard, { change }));
  assert.equal((inline.match(/aria-expanded=/g) ?? []).length, 2);
  assert.equal((inline.match(/aria-expanded="false"/g) ?? []).length, 2);
  const review = renderToStaticMarkup(createElement(DiffCard, { change, onOpen: () => {} }));
  assert.equal((review.match(/aria-expanded=/g) ?? []).length, 1);
  assert.equal((review.match(/aria-expanded="false"/g) ?? []).length, 1);
});

test('fetch size badge counts the truncated-away characters', () => {
  // The sentinel's number is the omitted character count, so a kept 10-char
  // body with 4096 omitted chars must badge the full fetched size, not "10+".
  assert.equal(fetchSizeBadge(10, 4096), '4.1k+');
  assert.equal(fetchSizeBadge(10, null), '10');
  assert.equal(fetchSizeBadge(0, null), null);
});

test('a short fetched page body renders its URLs as links outside the source row', () => {
  // Bodies within the snippet threshold render only as the snippet (no
  // separate body block), so the snippet must linkify — otherwise URLs in a
  // short fetched page are plain text and not clickable. But the source row
  // is itself an anchor, so the linkified snippet must render outside it:
  // nested anchors are invalid HTML and a click would open both links.
  const body = 'See https://example.com/docs for the full guide.';
  const html = renderToStaticMarkup(
    createElement(WebFetchBody, {
      error: false,
      hasBody: true,
      body,
      url: 'https://example.com',
      title: 'Example',
      snippet: body,
    }),
  );
  const rowClose = html.indexOf('</a>');
  const snippetLink = html.indexOf('href="https://example.com/docs"');
  assert.ok(rowClose !== -1);
  assert.ok(snippetLink > rowClose);
});

test('an untrusted fetched page never loads remote images or renders an svg fence as markup', () => {
  const fetched = (body: string, snippet: string) =>
    renderToStaticMarkup(
      createElement(WebFetchBody, {
        error: false,
        hasBody: true,
        body,
        url: 'https://example.com/private-topic',
        title: 'Page',
        snippet,
      }),
    );
  // The source row draws a local icon, never a remote favicon request.
  assert.doesNotMatch(fetched('A useful page body', 'Useful page'), /<img|google\.com/);

  // Regression: ```svg blocks must render as plain code, never through
  // SvgCodeBlock's unsanitized dangerouslySetInnerHTML.
  const svg = fetched(
    `${'Intro text. '.repeat(30)}\n\n\`\`\`svg\n<svg onload="alert(1)"><rect width="10" height="10"/></svg>\n\`\`\`\n`,
    'Intro text.',
  );
  assert.equal(svg.includes('<svg onload'), false);
  // The fence survives only as escaped text inside a plain code card.
  assert.ok(svg.includes('&lt;svg'));

  const images = fetched(
    `${'Intro text. '.repeat(30)}\n\n![tracking](https://tracker.example/pixel.png)\n![local](/tmp/private.png)`,
    'Intro text.',
  );
  assert.equal(images.includes('<img'), false);
  assert.equal(images.includes('rel="preload"'), false);
});

test('sameFeedEvents skips stable items and flags the streaming tail', () => {
  const prior = userMsg('hi');
  const tail = asst('Answer so far');
  const feed1 = buildFeed([prior, tail]);
  // Mirror the store's immutable tail growth: prior events keep their ref, only
  // the last event becomes a new object with appended text.
  const grown = { ...tail, text: 'Answer so far and then some more' };
  const feed2 = buildFeed([prior, grown]);
  assert.equal(sameFeedEvents(feed1[0], feed2[0]), true); // unchanged prior item
  assert.equal(sameFeedEvents(feed1[1], feed2[1]), false); // growing tail item

  // Thinking duration is drawn on the row, so a change must invalidate it.
  const event = ev({ kind: 'thinking', text: 'considering' });
  const before: FeedItem = { type: 'thinking', key: event.id, event, durationMs: 100 };
  assert.equal(sameFeedEvents(before, { ...before, durationMs: 200 }), false);
  assert.equal(sameFeedEvents(before, { ...before }), true);
});

test('sameFeedEvents compares grouped rows by their nested events, not object identity', () => {
  // Tool runs compare by underlying event refs.
  const a = grep();
  const b = grep();
  const g1 = buildFeed([a, b]).find((it) => it.type === 'tools');
  const g2 = buildFeed([a, b]).find((it) => it.type === 'tools');
  assert.ok(g1 && g2);
  assert.equal(sameFeedEvents(g1!, g2!), true);
  // A different second tool event breaks the run's identity.
  const g3 = buildFeed([a, grep()]).find((it) => it.type === 'tools');
  assert.ok(g3);
  assert.equal(sameFeedEvents(g1!, g3!), false);

  // Worked groups compare by nested items; they carry no event of their own.
  const worked = (tool: TranscriptEvent) =>
    groupTurns(buildFeed([userMsg('go'), tool, asst('done')]), false).find(
      (it) => it.type === 'worked',
    );
  const first = worked(a);
  const second = worked(a);
  const other = worked(grep());
  assert.ok(first && second && other);
  assert.equal(sameFeedEvents(first, second), true);
  assert.equal(sameFeedEvents(first, other), false);

  // A turn's changes summary compares by captured file values.
  const changes = (added: number): FeedItem => ({
    type: 'turnChanges',
    key: 'changes:1',
    tailEventId: 't1',
    files: [
      {
        path: 'a.ts',
        added,
        removed: 0,
        verb: 'edit',
        change: { path: 'a.ts', verb: 'edit', ops: [], added, removed: 0 },
      },
    ],
    added,
    removed: 0,
  });
  assert.equal(sameFeedEvents(changes(1), changes(1)), true);
  assert.equal(sameFeedEvents(changes(1), changes(2)), false);
});

test('settled compaction history does not show a live shimmer', () => {
  const event = ev({ kind: 'status', text: 'Compacting…' });
  const html = renderToStaticMarkup(
    createElement(MessageFeed, {
      events: [event],
      items: [{ type: 'status', key: event.id, event }],
      pending: false,
    }),
  );
  assert.equal(html.includes('shimmer-text'), false);
});

test('feedItemPropsEqual re-renders agent rows, and folds holding them, only when agent data changes', () => {
  const props = (
    item: FeedItem,
    overrides: Partial<FeedItemViewProps> = {},
  ): FeedItemViewProps => ({
    item,
    live: false,
    sessionLive: true,
    ...overrides,
  });
  const spawn = ev({
    kind: 'tool_call',
    toolName: 'Task',
    toolUseId: 't1',
    toolArgs: { subagent_type: 'explorer' },
  });
  const wave: FeedItem = { type: 'child_sessions', key: 'wave', events: [spawn] };
  const worked: FeedItem = { type: 'worked', key: 'worked', durationMs: 10, items: [wave] };
  const prose: FeedItem = { type: 'message', key: 'prompt', event: userMsg('prompt') };
  const dock = { sessions: [] as ChildSessionSummary[], models: [] };
  const nextDock = { sessions: [] as ChildSessionSummary[], models: [] };
  const running = () => ({ status: 'running' as const });
  const completed = () => ({ status: 'completed' as const });

  for (const item of [wave, worked]) {
    assert.equal(
      feedItemPropsEqual(props(item, { agentMonitor: dock }), props(item, { agentMonitor: dock })),
      true,
    );
    assert.equal(
      feedItemPropsEqual(
        props(item, { agentMonitor: dock }),
        props(item, { agentMonitor: nextDock }),
      ),
      false,
    );
    assert.equal(
      feedItemPropsEqual(
        props(item, { childSessionActivity: running }),
        props(item, { childSessionActivity: completed }),
      ),
      false,
    );
  }
  assert.equal(
    feedItemPropsEqual(props(worked, { sessionLive: false }), props(worked, { sessionLive: true })),
    false,
  );
  // Prose ignores agent data entirely.
  assert.equal(
    feedItemPropsEqual(
      props(prose, { agentMonitor: dock }),
      props(prose, { agentMonitor: nextDock }),
    ),
    true,
  );
  assert.equal(
    feedItemPropsEqual(
      props(prose, { childSessionActivity: running }),
      props(prose, { childSessionActivity: completed }),
    ),
    true,
  );
});

test('live commands show an activity cue at every density until their result lands', () => {
  const call = ev({
    kind: 'tool_call',
    toolName: 'Execute',
    toolUseId: 'exec-live',
    toolArgs: { command: 'npm test' },
  });
  const result = ev({ kind: 'tool_result', toolUseId: 'exec-live', text: 'passed' });
  for (const density of ['compact', 'balanced', 'detailed'] as const) {
    const render = (events: TranscriptEvent[], live: boolean) =>
      renderToStaticMarkup(
        createElement(FeedItemView, {
          item: { type: 'tools', key: 'exec', events },
          live,
          density,
        }),
      );
    assert.match(render([call], true), density === 'compact' ? /shimmer-text/ : /Running/, density);
    assert.equal(render([call, result], false).includes('Running'), false, density);
  }
});
