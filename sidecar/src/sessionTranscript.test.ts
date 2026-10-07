import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_SESSION_BYTES,
  SessionTranscriptReader,
  parseFullSessionTranscript,
  readSessionRawWindow,
  type TranscriptWindowCursor,
} from './sessionTranscript.js';
import type { TranscriptEvent } from './protocol.js';
import { SessionEventFlow } from './SessionEventFlow.js';
import { readCanvasToolBindings } from './canvas/canvasToolBindings.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import { ClaudeEventMapper } from './providers/claude/claudeEvents.js';
import { CodexEventMapper } from './providers/codex/codexEvents.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { NormalizedEvent } from './normalize.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';
import { transcriptToMarkdown } from './sessionMarkdown.js';

const dir = mkdtempSync(join(tmpdir(), 'droid-transcript-'));
let fileCount = 0;

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});

let clock = 0;
function sessionStart(id: string): string {
  return JSON.stringify({ type: 'session_start', id, cwd: dir, sessionTitle: 'S' });
}

function assistant(text: string): string {
  clock += 1000;
  return JSON.stringify({
    type: 'message',
    id: `${text}-id`,
    timestamp: new Date(clock).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

function userMessage(text: string, visibility?: 'llm_only' | 'user_only' | 'both'): string {
  clock += 1000;
  return JSON.stringify({
    type: 'message',
    id: `${text}-id`,
    timestamp: new Date(clock).toISOString(),
    message: {
      role: 'user',
      ...(visibility ? { visibility } : {}),
      content: [{ type: 'text', text }],
    },
  });
}

// One stored line that yields THREE events (thinking + text + tool_call), so
// page boundaries can split it.
function rich(id: string): string {
  clock += 1000;
  return JSON.stringify({
    type: 'message',
    id,
    timestamp: new Date(clock).toISOString(),
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: `${id}-think` },
        { type: 'text', text: `${id}-text` },
        { type: 'tool_use', name: 'Read', id: `${id}-tool`, input: {} },
      ],
    },
  });
}

function compactionState(removedCount: number): string {
  clock += 1000;
  return JSON.stringify({
    type: 'compaction_state',
    id: `comp-${removedCount}`,
    timestamp: new Date(clock).toISOString(),
    removedCount,
  });
}

function writeSession(lines: string[]): string {
  fileCount += 1;
  const path = join(dir, `s${fileCount}.jsonl`);
  writeFileSync(path, `${[sessionStart(`s${fileCount}`), ...lines].join('\n')}\n`);
  return path;
}

function reader(path: string): SessionTranscriptReader {
  return new SessionTranscriptReader('app', 'provider', path, 'primary');
}

// Collect every page newest -> oldest and rebuild the full forward transcript.
function collectAll(path: string, limit: number): TranscriptEvent[] {
  const r = reader(path);
  const pages: TranscriptEvent[][] = [];
  let from: TranscriptWindowCursor | undefined;
  let guard = 0;
  do {
    const window = r.windowBackward(limit, 0, from);
    pages.unshift(window.events);
    from = window.older;
    guard += 1;
    assert.ok(guard < 100, 'pagination did not terminate');
  } while (from);
  return pages.flat();
}

test('backward windows reassemble the exact transcript in seq order, with no gaps or duplicates', () => {
  const path = writeSession([assistant('a1'), rich('r'), assistant('a2'), assistant('a3')]);
  const all = collectAll(path, 4);
  assert.deepEqual(
    all.map((e) => `${e.kind}:${e.text ?? e.toolName ?? ''}`),
    ['text:a1', 'thinking:r-think', 'text:r-text', 'tool_call:Read', 'text:a2', 'text:a3'],
  );
  // seq is strictly increasing within and across pages.
  const paged = collectAll(
    writeSession([assistant('a1'), rich('r'), assistant('a2'), assistant('a3'), assistant('a4')]),
    2,
  );
  assert.ok(paged.every((e) => typeof e.seq === 'number'));
  for (let i = 1; i < paged.length; i++) {
    assert.ok(paged[i].seq! > paged[i - 1].seq!, `seq must increase at index ${i}`);
  }
});

test("a page boundary may split one line's events across pages", () => {
  const path = writeSession([assistant('a1'), rich('r'), assistant('a2')]);
  const r = reader(path);
  const page1 = r.windowBackward(2, 0);
  assert.deepEqual(
    page1.events.map((e) => e.text ?? e.toolName),
    ['Read', 'a2'],
  );
  assert.ok(page1.older, 'expected an older cursor mid-line');
  const page2 = r.windowBackward(2, 0, page1.older);
  assert.deepEqual(
    page2.events.map((e) => e.text),
    ['r-think', 'r-text'],
  );
  const page3 = r.windowBackward(2, 0, page2.older);
  assert.deepEqual(
    page3.events.map((e) => e.text),
    ['a1'],
  );
  assert.equal(page3.older, undefined);
});

test('corrupt lines are skipped without losing their neighbors', () => {
  const path = writeSession([assistant('a1'), '{not json', assistant('a2')]);
  const all = collectAll(path, 10);
  assert.deepEqual(
    all.map((e) => e.text),
    ['a1', 'a2'],
  );
});

test('Canvas results with reused tool IDs project by occurrence regardless of page traversal', () => {
  const appSessionId = 'canvas-reused-occurrence';
  const flow = new SessionEventFlow({
    appendTranscript: () => undefined,
    flushTranscript: () => undefined,
    applySideEffects: () => undefined,
    resolveChildScope: () => undefined,
    recordUsage: () => undefined,
  });
  const tool = 'droidex-canvas___canvas_write';
  const call = (name: string, designId = 'design-1') => ({
    type: 'tool_use' as const,
    id: 'same',
    name,
    input: { designId },
  });
  const result = (content: string) => ({ type: 'tool_result', tool_use_id: 'same', content });
  const line = (id: string, role: string, content: unknown[], visibility?: 'llm_only') =>
    JSON.stringify({
      type: 'message',
      id,
      timestamp: new Date(1000).toISOString(),
      message: { role, content, ...(visibility ? { visibility } : {}) },
    });
  flow.beginTurn(appSessionId, appSessionId);
  flow.applyStreamEvent(appSessionId, appSessionId, 'primary', {
    type: 'tool_call',
    toolUse: call(tool),
  });
  flow.applyStreamEvent(appSessionId, appSessionId, 'primary', {
    type: 'tool_result',
    toolName: tool,
    toolUseId: 'same',
    content: 'CANVAS_INTERNAL_GUIDANCE_7E4B',
    isError: false,
  });
  flow.beginTurn(appSessionId, appSessionId);
  flow.applyStreamEvent(appSessionId, appSessionId, 'primary', {
    type: 'tool_call',
    toolUse: call(tool, 'design-2'),
  });
  const bindings = readCanvasToolBindings(appSessionId);
  assert.equal(new Set(bindings.map((binding) => binding.occurrenceId)).size, 2);
  const path = writeSession([
    line('call-1', 'assistant', [call(tool)]),
    line('result-1', 'user', [result('CANVAS_INTERNAL_GUIDANCE_7E4B')]),
    userMessage('Next turn'),
    line('call-2', 'assistant', [call('Bash')]),
    line('result-2', 'user', [result('ordinary output')]),
    userMessage('Another Canvas turn'),
    line('call-3', 'assistant', [call(tool, 'design-2')]),
    line('result-3', 'user', [result('CANVAS_INTERNAL_GUIDANCE_7E4B')]),
  ]);
  const r = new SessionTranscriptReader(appSessionId, appSessionId, path, 'primary');
  const newest = r.windowBackward(4, 0);
  assert.equal(newest.events[0]?.text, 'ordinary output');
  assert.equal(newest.events[0]?.canvasActivity, undefined);
  const older = r.windowBackward(20, 0, newest.older);
  assert.equal(older.events.find((entry) => entry.kind === 'tool_result')?.text, 'Updated design');
  for (const events of [
    r.windowBackward(20, 0).events,
    new SessionTranscriptReader(appSessionId, appSessionId, path, 'primary').windowBackward(20, 0)
      .events,
    parseFullSessionTranscript(appSessionId, appSessionId, path, 'primary'),
  ]) {
    assert.deepEqual(
      events.filter((entry) => entry.kind === 'tool_result').map((entry) => entry.text),
      ['Updated design', 'ordinary output', 'Updated design'],
    );
    assert.deepEqual(
      events
        .filter((entry) => entry.kind === 'tool_result')
        .map((entry) => entry.canvasActivity?.designIds),
      [['design-1'], undefined, ['design-2']],
    );
  }
  for (const name of [tool, 'Bash']) {
    const output = name === tool ? 'CANVAS_INTERNAL_GUIDANCE_7E4B' : 'ordinary output';
    const oversized = writeSession([
      line('call-1', 'assistant', [call(tool)]),
      line('result-1', 'user', [result('CANVAS_INTERNAL_GUIDANCE_7E4B')]),
      line('call-2', 'assistant', [call(name, 'design-2')]),
      ...Array.from({ length: 6 }, (_, index) =>
        line(
          `filler-${index}`,
          'user',
          [{ type: 'text', text: 'x'.repeat(1_000_000) }],
          'llm_only',
        ),
      ),
      line('result-2', 'user', [result(output)]),
    ]);
    const eager = parseFullSessionTranscript(appSessionId, appSessionId, oversized, 'primary');
    assert.equal(eager[0]?.kind, 'status');
    assert.equal(eager.filter((entry) => entry.kind === 'tool_call').length, 0);
    for (const tail of [
      eager,
      new SessionTranscriptReader(appSessionId, appSessionId, oversized, 'primary').windowBackward(
        1,
        0,
      ).events,
    ]) {
      assert.equal(tail.at(-1)?.text, name === tool ? 'Updated design' : output);
      assert.deepEqual(
        tail.at(-1)?.canvasActivity?.designIds,
        name === tool ? ['design-2'] : undefined,
      );
    }
  }
});

for (const provider of ['claude', 'codex'] as const) {
  test(`${provider} Canvas reload retains named and revision summaries for reused call IDs`, async () => {
    const appSessionId = `canvas-summary-${provider}`;
    const summary = sessionSummary({ appSessionId, provider });
    const file = new ProviderTranscriptFile(appSessionId, () => summary);
    const live: TranscriptEvent[] = [];
    const flow = new SessionEventFlow({
      appendTranscript: (entry) => {
        live.push(entry);
        void file.append(entry);
      },
      flushTranscript: () => undefined,
      applySideEffects: () => undefined,
      resolveChildScope: () => undefined,
      recordUsage: () => undefined,
    });
    const claude = new ClaudeEventMapper(appSessionId);
    const codex = new CodexEventMapper(appSessionId);
    const outcomes = [
      { tool: 'canvas_create', body: { frames: [{ designId: 'design-1', name: 'Welcome' }] } },
      { tool: 'canvas_write', body: { designId: 'design-1', revisionId: 'rev-1' } },
      { tool: 'canvas_create', body: { frames: [{ designId: 'design-2', name: 'Dashboard' }] } },
      { tool: 'canvas_write', body: { designId: 'design-2', revisionId: 'rev-2' } },
    ];
    for (const [index, outcome] of outcomes.entries()) {
      flow.beginTurn(appSessionId, appSessionId);
      await file.append({
        id: `intro-${index}`,
        appSessionId,
        sourceSessionId: 'primary',
        role: 'primary',
        ts: 1000 + index,
        kind: 'text',
        text: 'Working on the design.',
      });
      const content = JSON.stringify(outcome.body);
      let events: NormalizedEvent[];
      if (provider === 'claude') {
        events = [
          ...claude.map({
            type: 'assistant',
            parent_tool_use_id: null,
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'same',
                  name: `mcp__droidex-canvas__${outcome.tool}`,
                  input: {},
                },
              ],
            },
          } as SDKMessage),
          ...claude.map({
            type: 'user',
            parent_tool_use_id: null,
            message: { content: [{ type: 'tool_result', tool_use_id: 'same', content }] },
          } as SDKMessage),
        ];
      } else {
        const item = {
          type: 'dynamicToolCall',
          id: 'same',
          namespace: 'droidex_canvas',
          tool: outcome.tool,
          arguments: {},
          contentItems: [{ type: 'inputText', text: content }],
          success: true,
        };
        events = [
          ...codex.map('item/started', { item: { ...item, status: 'inProgress' } }),
          ...codex.map('item/completed', { item: { ...item, status: 'completed' } }),
        ];
      }
      for (const entry of events) flow.apply(appSessionId, appSessionId, 'primary', entry);
    }
    await file.flush();
    const expected = [
      'Created Welcome',
      'Updated design · rev-1',
      'Created Dashboard',
      'Updated design · rev-2',
    ];
    assert.deepEqual(
      live.filter((entry) => entry.kind === 'tool_result').map((entry) => entry.text),
      expected,
    );
    const lazy = new SessionTranscriptReader(appSessionId, appSessionId, file.path, 'primary');
    const paged: TranscriptEvent[] = [];
    let cursor: TranscriptWindowCursor | undefined;
    do {
      const page = lazy.windowBackward(1, 0, cursor);
      paged.unshift(...page.events);
      cursor = page.older;
    } while (cursor);
    for (const reloaded of [
      parseFullSessionTranscript(appSessionId, appSessionId, file.path, 'primary'),
      paged,
    ]) {
      assert.deepEqual(
        reloaded.filter((entry) => entry.kind === 'tool_result').map((entry) => entry.text),
        expected,
      );
      assert.deepEqual(
        reloaded.filter((entry) => entry.kind === 'tool_call').map((entry) => entry.id),
        live.filter((entry) => entry.kind === 'tool_call').map((entry) => entry.id),
      );
      const markdown = transcriptToMarkdown(reloaded, {
        title: 'Canvas',
        providerSessionId: appSessionId,
      });
      for (const message of expected) assert.ok(markdown.includes(`**Canvas:** ${message}`));
    }
  });
}

test('eager and paged replay hide internal user messages and restore skill activations', () => {
  // Internal skill bodies arrive as ordinary user text, after leading whitespace.
  const notification =
    ' <system-notification>\n<skill filePath="builtin:review">private instructions</skill>\n</system-notification>';
  const path = writeSession([
    userMessage('ordinary user prompt'),
    userMessage('internal child-session handoff', 'llm_only'),
    userMessage('user-only prompt', 'user_only'),
    userMessage('shared prompt', 'both'),
    userMessage('Skill "review" activated: PR #100', 'user_only'),
    userMessage(notification),
    assistant('Review started'),
  ]);

  for (const events of [
    collectAll(path, 1),
    parseFullSessionTranscript('app', 'provider', path, 'primary'),
  ]) {
    assert.deepEqual(
      events.map(({ text, author, skills, sourceSessionId }) => [
        text,
        author,
        skills,
        sourceSessionId,
      ]),
      [
        ['ordinary user prompt', 'user', undefined, 'user'],
        ['user-only prompt', 'user', undefined, 'user'],
        ['shared prompt', 'user', undefined, 'user'],
        // A user-only skill activation restores the prompt and the harness
        // acknowledgement as separate rows.
        ['PR #100', 'user', ['review'], 'user'],
        ['Skill "review" activated: PR #100', undefined, undefined, 'primary'],
        ['Review started', undefined, undefined, 'primary'],
      ],
    );
  }
});

test('a leading compaction_state surfaces exactly one divider at the very top', () => {
  const path = writeSession([compactionState(9), assistant('after-1'), assistant('after-2')]);
  const r = reader(path);
  const page1 = r.windowBackward(2, 0);
  assert.deepEqual(
    page1.events.map((e) => e.text),
    ['after-1', 'after-2'],
  );
  assert.ok(page1.older, 'divider still unserved');
  const page2 = r.windowBackward(2, 0, page1.older);
  const dividers = page2.events.filter((e) => e.kind === 'compaction');
  assert.equal(dividers.length, 1);
  assert.equal(dividers[0].removedCount, 9);
  assert.equal(page2.older, undefined);
});

test('a leading compaction_state yields one divider without a timestamp or behind non-object lines', () => {
  // A ts=0 divider must still feed the head-dedupe set, and a valid `null` or
  // number literal between session_start and the divider is noise to skip,
  // not a value to dereference.
  const noTimestamp = JSON.stringify({ type: 'compaction_state', id: 'comp-0', removedCount: 7 });
  for (const [lines, removedCount] of [
    [[noTimestamp, assistant('after')], 7],
    [['null', '42', compactionState(9), assistant('after')], 9],
  ] as const) {
    const dividers = collectAll(writeSession([...lines]), 100).filter(
      (e) => e.kind === 'compaction',
    );
    assert.equal(dividers.length, 1);
    assert.equal(dividers[0].removedCount, removedCount);
  }
});

test('an oversized file pages back to its very first message without trimming', () => {
  // Regression: files above MAX_SESSION_BYTES used to be tail-windowed with a
  // "Loaded latest 5 MB" status, so older messages were unreachable. The
  // reader now indexes line offsets across the whole file: paging serves the
  // tail first and walks all the way to the leading record.
  const filler = 'x'.repeat(30_000);
  const lines: string[] = [compactionState(42)];
  for (let i = 0; i < 200; i++) lines.push(assistant(`${i}-${filler}`));
  const path = writeSession(lines);

  const r = reader(path);
  const first = r.windowBackward(3, 0);
  assert.equal(first.events.length, 3);
  assert.ok(first.events.every((e) => e.kind === 'text'));
  assert.ok(first.older, 'expected more history below the first window');

  const all = collectAll(path, 500);
  const texts = all.filter((e) => e.kind === 'text');
  assert.equal(texts.length, 200, 'every stored message must be reachable');
  assert.match(texts[0]?.text ?? '', /^0-x/);
  // The leading compaction_state parses in position as the oldest event, and
  // no trim status exists anywhere in the walk.
  assert.equal(all[0]?.kind, 'compaction');
  assert.equal(all[0]?.removedCount, 42);
  assert.equal(all.filter((e) => e.kind === 'compaction').length, 1);
  assert.equal(all.filter((e) => e.kind === 'status').length, 0);
});

test('parseFullSessionTranscript stays eager: trim status first, no head-read divider', () => {
  const filler = 'y'.repeat(30_000);
  const lines: string[] = [compactionState(7)];
  for (let i = 0; i < 200; i++) lines.push(assistant(`${i}-${filler}`));
  const path = writeSession(lines);

  const events = parseFullSessionTranscript('app', 'provider', path, 'primary');
  assert.equal(events[0]?.kind, 'status');
  // The leading compaction_state was tail-windowed away, and the eager parse
  // does not head-read it back (loadSessionPage behavior is unchanged).
  assert.equal(events.filter((e) => e.kind === 'compaction').length, 0);
  assert.ok(events.some((e) => e.kind === 'text'));
});

test('parseFullSessionTranscript replays a mid-file compaction marker in position', () => {
  const path = writeSession([assistant('before'), compactionState(3), assistant('after')]);
  const events = parseFullSessionTranscript('app', 'provider', path, 'primary');
  assert.deepEqual(
    events.map((e) => (e.kind === 'compaction' ? `divider:${e.removedCount}` : e.text)),
    ['before', 'divider:3', 'after'],
  );
});

test('a single message larger than MAX_SESSION_BYTES still parses in the reader', () => {
  // Regression: the old tail window dropped the partial first line, losing
  // the message entirely. The lazy reader preads the whole line.
  const huge = 'z'.repeat(MAX_SESSION_BYTES + 1000);
  const path = writeSession([assistant(huge), assistant('tail')]);
  const texts = collectAll(path, 100).filter((e) => e.kind === 'text');
  assert.equal(texts.length, 2);
  assert.match(texts[0]?.text ?? '', /^z+/);
  assert.equal(texts[1]?.text, 'tail');
});

test('readSessionRawWindow tail window drops the partial first line', () => {
  // The eager window (search / legacy history.page) stays byte-capped; the
  // partial first line inside the window must not survive as garbage.
  const huge = 'z'.repeat(MAX_SESSION_BYTES + 1000);
  const path = writeSession([assistant(huge), assistant('tail')]);
  const window = readSessionRawWindow(path, statSync(path).size);
  assert.equal(window.trimmed, true);
  assert.ok(window.text.startsWith('{'), 'window must begin on a whole line');
  assert.match(window.text, /"tail"/);
});
