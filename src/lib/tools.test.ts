import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeToolCall,
  isWebSearchTool,
  isWebFetchTool,
  parseWebSearch,
  parseWebFetch,
  looksLikeHtml,
  webSourceName,
  toolArgString,
  toolArgStringArray,
  latestTodoSnapshot,
  activeTodoIndex,
  isChildSessionTool,
  toolMeta,
  CAT_LABEL,
  type TodoItem,
} from './tools';
import type { TranscriptEvent } from '../types/bridge';

function todoCall(id: string, toolArgs: unknown): TranscriptEvent {
  return {
    id,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 0,
    kind: 'tool_call',
    toolName: 'TodoWrite',
    toolArgs,
  } as TranscriptEvent;
}

const SAMPLE = `Web Search Results for: "electron auto update best practices 2026"

**Electron | Sentry for Electron**
   URL: https://docs.sentry.io/platforms/javascript/guides/electron/
   
   Learn how to manually set up Sentry in your Electron app and capture your first errors.

---

**GitHub - getsentry/sentry-electron: The official Sentry SDK for ...**
   URL: https://github.com/getsentry/sentry-electron
   
   The official Sentry SDK for Electron. Contribute to getsentry/sentry-electron development by creating an account on GitHub.
Found 2 results`;

test('isWebSearchTool covers engine names, MCP prefixes, and web queries', () => {
  assert.equal(isWebSearchTool('brave_web_search'), true);
  assert.equal(isWebSearchTool('brave-web-search'), true);
  assert.equal(isWebSearchTool('mcp__tavily__tavily-search'), true);
  assert.equal(isWebSearchTool('google'), true);
  assert.equal(isWebSearchTool('web_query'), true);
  assert.equal(isWebSearchTool('websearch'), true);
  assert.equal(isWebSearchTool('WebSearch'), true);
  assert.equal(isWebSearchTool(undefined), false);
  // A plain local search stays false — no web/engine signal.
  assert.equal(isWebSearchTool('Search'), false);
  assert.equal(isWebSearchTool('Grep'), false);
  assert.equal(isWebSearchTool('search_files'), false);
});

test('isWebFetchTool covers separators, MCP prefixes, and url verbs, not browser automation', () => {
  assert.equal(isWebFetchTool('fetch_url'), true);
  assert.equal(isWebFetchTool('open_url'), true);
  assert.equal(isWebFetchTool('getURL'), true);
  assert.equal(isWebFetchTool('visit_site'), true);
  assert.equal(isWebFetchTool('loadWebPage'), true);
  assert.equal(isWebFetchTool('web_page'), true);
  assert.equal(isWebFetchTool('http_request'), true);
  assert.equal(isWebFetchTool('mcp__fetch__fetch'), true);
  assert.equal(isWebFetchTool('server___FetchUrl'), true);
  assert.equal(isWebFetchTool('WebFetch'), true);
  // No fetch/url signal → stays a generic tool line.
  assert.equal(isWebFetchTool(undefined), false);
  assert.equal(isWebFetchTool('WebSearch'), false);
  assert.equal(isWebFetchTool('web_search'), false);
  assert.equal(isWebFetchTool('Read'), false);
  assert.equal(isWebFetchTool('TodoWrite'), false);
  assert.equal(isWebFetchTool('mcp__figma__get_design'), false);
  // Browser-automation tools are never fetches.
  assert.equal(isWebFetchTool('droidex-browser___browser_open'), false);
  assert.equal(isWebFetchTool('browser_navigate'), false);
  assert.equal(isWebFetchTool('browser_click'), false);
});

test('looksLikeHtml detects raw HTML but not markdown prose', () => {
  assert.equal(looksLikeHtml('<!DOCTYPE html>\n<html><body>hi</body></html>'), true);
  assert.equal(
    looksLikeHtml(
      '<div class="a"><p>one</p><p>two</p><span>three</span><br/><hr/><b>x</b><i>y</i><u>z</u></div>',
    ),
    true,
  );
  assert.equal(
    looksLikeHtml('# Title\n\nSome **markdown** body with [a link](https://x.com).'),
    false,
  );
  assert.equal(looksLikeHtml('Plain text, no tags at all.'), false);
});

test('parseWebSearch extracts query, count and result blocks, and none from an empty search', () => {
  const { query, count, results } = parseWebSearch(SAMPLE);
  assert.equal(query, 'electron auto update best practices 2026');
  assert.equal(count, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Electron | Sentry for Electron');
  assert.equal(results[0].url, 'https://docs.sentry.io/platforms/javascript/guides/electron/');
  assert.match(results[0].snippet, /manually set up Sentry/);
  assert.equal(results[1].url, 'https://github.com/getsentry/sentry-electron');

  const empty = parseWebSearch('Web Search Results for: "nothing here"\n\nNo results found.');
  assert.equal(empty.results.length, 0);
  assert.equal(empty.count, undefined);
});

test('parseWebFetch prefers the arg URL and a markdown title', () => {
  const page = parseWebFetch(
    '# Electron auto-update\n\nShip updates safely with differential releases.\n\nMore detail here.',
    'https://www.electronjs.org/docs/latest/tutorial/updates',
  );
  assert.equal(page.url, 'https://www.electronjs.org/docs/latest/tutorial/updates');
  assert.equal(page.title, 'Electron auto-update');
  assert.match(page.body, /Ship updates safely/);
  assert.ok(!page.body.startsWith('#'));
  assert.ok(page.chars > 20);
  assert.equal(page.truncatedChars, null);
});

test('parseWebFetch reads Title/URL lines as metadata only in the preamble and strips the truncation sentinel', () => {
  const truncated = parseWebFetch(
    'Title: Sentry for Electron\nURL: https://docs.sentry.io/platforms/javascript/guides/electron/\n\nLearn how to set up Sentry.\n\n[truncated 4096 chars]',
  );
  assert.equal(truncated.title, 'Sentry for Electron');
  assert.equal(truncated.url, 'https://docs.sentry.io/platforms/javascript/guides/electron/');
  assert.equal(truncated.body, 'Learn how to set up Sentry.');
  assert.equal(truncated.truncatedChars, 4096);

  const page = parseWebFetch(
    [
      'Title: Sentry for Electron',
      'URL: https://docs.sentry.io/platforms/javascript/guides/electron/',
      '',
      'Learn how to set up Sentry.',
      '',
      'Title: Advanced configuration',
      'URL: https://docs.sentry.io/advanced/',
      '',
      'More detail here.',
    ].join('\n'),
  );
  assert.equal(page.title, 'Sentry for Electron');
  // Body lines that later begin with Title:/URL: are content, not metadata —
  // they must survive in the preview.
  assert.ok(page.body.includes('Title: Advanced configuration'));
  assert.ok(page.body.includes('URL: https://docs.sentry.io/advanced/'));
});

test('parseWebFetch strips a first-line fallback title so it does not repeat in the body', () => {
  const page = parseWebFetch(
    'Electron Auto-Update Guide\n\nShip updates safely with differential releases.\n\nMore detail here.',
  );
  assert.equal(page.title, 'Electron Auto-Update Guide');
  assert.equal(page.body, 'Ship updates safely with differential releases.\n\nMore detail here.');
  // A preamble URL line is still read as the source.
  const withUrl = parseWebFetch('My Guide\nURL: https://example.com/guide\n\nBody text.');
  assert.equal(withUrl.title, 'My Guide');
  assert.equal(withUrl.url, 'https://example.com/guide');
  assert.equal(withUrl.body, 'Body text.');
});

test('parseWebFetch leaves an empty body when the page is only its title chrome', () => {
  // The title (a fallback first line, an h1, or Title/URL metadata) and the
  // source row are card chrome; restoring them as the body would render the
  // same text twice in the card.
  // [page, title, url]
  const cases: Array<[string, string, string | undefined]> = [
    ['Just A Title', 'Just A Title', undefined],
    ['Just A Title\nURL: https://example.com', 'Just A Title', 'https://example.com'],
    ['# Just A Heading', 'Just A Heading', undefined],
    ['Title: Some Page\nURL: https://example.com', 'Some Page', 'https://example.com'],
  ];
  for (const [text, title, url] of cases) {
    const page = parseWebFetch(text);
    assert.equal(page.title, title, text);
    if (url) assert.equal(page.url, url, text);
    assert.equal(page.body, '', text);
  }
});

test('webSourceName derives a capitalized registrable label', () => {
  assert.equal(webSourceName('https://www.theregister.com/2026/01/01/x'), 'Theregister');
  assert.equal(webSourceName('https://docs.sentry.io/platforms'), 'Sentry');
  assert.equal(webSourceName('not a url'), 'not a url');
  assert.equal(webSourceName('https://bbc.co.uk/news'), 'Bbc');
  // ".dev" is a gTLD, so the "com" in front of it is an ordinary label.
  assert.equal(webSourceName('https://foo.com.dev/x'), 'Com');
});

test('toolArgString and toolArgStringArray read only string values', () => {
  assert.equal(toolArgString({ query: 'droidex' }, 'query'), 'droidex');
  assert.equal(toolArgString({ query: 1 }, 'query'), undefined);
  assert.equal(toolArgString({}, 'query'), undefined);
  assert.deepEqual(
    toolArgStringArray({ includeDomains: ['x.com', 1, 'y.com'] }, 'includeDomains'),
    ['x.com', 'y.com'],
  );
  assert.deepEqual(toolArgStringArray({}, 'includeDomains'), []);
});

test('latestTodoSnapshot returns the newest real TodoWrite list, honoring an emptied list and skipping partial calls', () => {
  const snapshot = latestTodoSnapshot([
    todoCall('a', { todos: '1. [pending] old' }),
    todoCall('b', { todos: '1. [completed] done\n2. [in_progress] now' }),
  ]);
  assert.equal(snapshot.foundPayload, true);
  assert.deepEqual(snapshot.todos, [
    { status: 'completed', text: 'done' },
    { status: 'in_progress', text: 'now' },
  ]);

  const emptied = latestTodoSnapshot([
    todoCall('a', { todos: '1. [pending] old' }),
    todoCall('b', { todos: '' }),
  ]);
  assert.deepEqual(emptied, { todos: [], foundPayload: true });

  const partial = latestTodoSnapshot([
    todoCall('a', { todos: '1. [pending] old' }),
    todoCall('b', {}),
  ]);
  assert.deepEqual(partial.todos, [{ status: 'pending', text: 'old' }]);

  assert.deepEqual(latestTodoSnapshot([]), { todos: [], foundPayload: false });
});

test('activeTodoIndex prefers the running step, then the next pending one', () => {
  const steps: TodoItem[] = [
    { status: 'completed', text: 'a' },
    { status: 'in_progress', text: 'b' },
    { status: 'pending', text: 'c' },
  ];
  assert.equal(activeTodoIndex(steps), 1);
  assert.equal(activeTodoIndex([steps[0], steps[2]]), 1);
  assert.equal(activeTodoIndex([steps[0]]), 0);
  assert.equal(activeTodoIndex([]), -1);
});

test('only a real spawn is labeled a child session', () => {
  // A spawn: the label the model chose travels through untouched.
  assert.equal(
    CAT_LABEL[toolMeta('Task', { subagent_type: 'my-custom-droid' }).cat],
    'Child session',
  );
  assert.ok(isChildSessionTool('Task', { subagent_type: 'my-custom-droid' }));

  // Inspecting or stopping an existing subagent is not a spawn, so it must not
  // read as "Child session <tool>" in the feed. DROIDEX has no card for these,
  // and the name alone says nothing about what they are polling, so they keep
  // their own name and the task they were given.
  for (const name of ['TaskOutput', 'TaskStop']) {
    assert.equal(toolMeta(name, { task_id: 'abc' }).cat, 'other');
    assert.equal(CAT_LABEL[toolMeta(name, { task_id: 'abc' }).cat], 'Tool');
    assert.ok(!isChildSessionTool(name, { task_id: 'abc' }));
  }
  const poll = describeToolCall('TaskOutput', { task_id: 'abc', block: true });
  assert.equal(poll.verb, 'Task output');
  assert.equal(poll.object, 'task id abc');
});

test('a tool with no card keeps its own name instead of borrowing a verb', () => {
  // "Searched" belongs to a codebase search; a tool that merely has "search" in
  // its name and a bare query is not one, so it says what it is.
  const search = describeToolCall('ToolSearch', { query: 'notebook jupyter', max_results: 5 });
  assert.equal(search.verb, 'Tool search');
  assert.equal(search.object, 'notebook jupyter');
  // A search that names its tools loads them, and says so by their own names.
  const loaded = describeToolCall('ToolSearch', { query: 'select:Read,Edit', max_results: 5 });
  assert.equal(loaded.verb, 'Loaded');
  assert.equal(loaded.object, 'Read, Edit');
  // A real codebase search still reads as one: it carries a pattern.
  assert.equal(describeToolCall('Grep', { pattern: 'foo', path: 'src' }).verb, 'Searched');
  assert.equal(describeToolCall('Glob', { pattern: '**/*.ts' }).verb, 'Searched');
  // Nothing recognisable at all: the name, plus one argument, is the whole row.
  const monitor = describeToolCall('Monitor', { description: 'errors in deploy.log' });
  assert.equal(monitor.verb, 'Monitor');
  assert.equal(monitor.object, 'errors in deploy.log');
});

test('describeToolCall categorises a namespaced tool by its bare name and keeps its server', () => {
  // The app's own browser tools say what the agent did on the page.
  const open = describeToolCall('droidex-browser___browser_open', { url: 'https://a.dev' });
  assert.equal(open.verb, 'Opened');
  assert.equal(open.object, 'https://a.dev');
  assert.equal(open.source, 'droidex browser');
  const click = describeToolCall('mcp__droidex-browser__browser_click', { ref: 'e3' });
  assert.equal(click.liveVerb, 'Clicking');
  assert.equal(click.object, '');
  const read = describeToolCall('mcp__filesystem__read_file', { path: 'a.ts' });
  assert.equal(read.verb, 'Read');
  assert.equal(read.source, 'filesystem');
  const issue = describeToolCall('mcp__github__create_issue', { title: 'x' });
  assert.equal(issue.verb, 'Created');
  assert.equal(issue.source, 'github');
});
