import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptToMarkdown } from './sessionMarkdown.js';
import { parseFullSessionTranscript } from './sessionTranscript.js';
import { SessionEventFlow } from './SessionEventFlow.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import { CodexEventMapper } from './providers/codex/codexEvents.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';
import type { TranscriptEvent } from './protocol.js';

function ev(overrides: Partial<TranscriptEvent> & Pick<TranscriptEvent, 'kind'>): TranscriptEvent {
  return {
    id: 'e1',
    appSessionId: 'app',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 1_000,
    ...overrides,
  };
}

const META = {
  title: 'Fix the sidebar',
  providerSessionId: 'droid-abc',
  cwd: '/repo',
  exportedAt: new Date('2026-08-09T12:00:00.000Z'),
};

test('header carries the title, resume hint, directory, and export date, and nothing else when empty', () => {
  const md = transcriptToMarkdown([], META);
  assert.match(md, /^# Fix the sidebar/);
  assert.match(md, /`droid-abc` — resume with `droid -r droid-abc`/);
  assert.match(md, /- \*\*Directory:\*\* `\/repo`/);
  assert.match(md, /- \*\*Exported:\*\* 2026-08-09T12:00:00\.000Z/);
  assert.equal(
    md
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('##')).length,
    0,
  );
  // A session without a cwd has no directory line.
  assert.doesNotMatch(transcriptToMarkdown([], { ...META, cwd: undefined }), /Directory/);
});

test('a meta note renders as a caveat right under the header', () => {
  // The export limit note must sit between the header and the conversation so
  // a truncated export cannot be mistaken for the complete chat.
  const md = transcriptToMarkdown([ev({ kind: 'text', text: 'tail turn' })], {
    ...META,
    note: 'Only the most recent events are included.',
  });
  const headerEnd = md.indexOf('- **Exported:**');
  const note = md.indexOf('> **Note:** Only the most recent events are included.');
  const turn = md.indexOf('## Droid\n\ntail turn');
  assert.ok(headerEnd > -1 && note > headerEnd && turn > note);
});

test('a transcript renders in order: labeled turns, folded thinking, fenced tools, quoted errors, dividers', () => {
  const md = transcriptToMarkdown(
    [
      ev({ kind: 'text', author: 'user', text: 'hello there' }),
      ev({ kind: 'thinking', text: 'hmm' }),
      ev({ kind: 'status', text: 'Working…' }),
      ev({ kind: 'text', text: 'hi!' }),
      ev({ kind: 'tool_call', toolName: 'Execute', toolArgs: { command: 'ls' } }),
      ev({ kind: 'tool_result', toolName: 'Execute', text: 'file.ts' }),
      ev({ kind: 'tool_result', text: 'boom', isError: true }),
      ev({ kind: 'error', text: 'bad thing' }),
      ev({ kind: 'compaction', removedCount: 42 }),
    ],
    META,
  );
  const user = md.indexOf('## User\n\nhello there');
  const droid = md.indexOf('## Droid\n\nhi!');
  assert.ok(user > -1 && droid > user);
  assert.match(md, /<details>\n<summary>Thinking<\/summary>\n\nhmm\n\n<\/details>/);
  // Status chrome is dropped.
  assert.doesNotMatch(md, /Working…/);
  assert.match(md, /\*\*Tool: Execute\*\*\n\n```\n\{\n {2}"command": "ls"\n\}\n```/);
  assert.match(md, /\*\*Tool result: Execute\*\*\n\n```\nfile\.ts\n```/);
  assert.match(md, /\*\*Tool error\*\*\n\n```\nboom\n```/);
  assert.match(md, /> \*\*Error:\*\* bad thing/);
  assert.match(md, /---\n\n\*42 earlier messages were summarized by compaction\.\*/);

  // A payload containing code fences gets a longer outer fence.
  const fenced = transcriptToMarkdown(
    [ev({ kind: 'tool_result', text: 'before\n```ts\ncode\n```\nafter' })],
    META,
  );
  assert.match(fenced, /````\nbefore\n```ts\ncode\n```\nafter\n````/);
});

test('oversized tool output and thinking are truncated with a marker', () => {
  const md = transcriptToMarkdown(
    [
      ev({ kind: 'tool_result', text: 'x'.repeat(3_000) }),
      ev({ kind: 'thinking', text: 'y'.repeat(5_000) }),
    ],
    META,
  );
  assert.match(md, /\[truncated 1000 chars\]/);
  assert.ok(!md.includes('x'.repeat(2_500)));
  assert.ok(!md.includes('y'.repeat(4_500)));
});

test('native Canvas replay exports safe activity while preserving ordinary tools and user text', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'canvas-markdown-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const appSessionId = 'droid-canvas-export';
  const canary = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
  const line = (id: string, role: 'user' | 'assistant', content: unknown[]) =>
    JSON.stringify({
      type: 'message',
      id,
      timestamp: new Date(1_000).toISOString(),
      message: { role, content },
    });
  const lines = [
    line('prompt', 'user', [{ type: 'text', text: `Please show ${canary}` }]),
    line('reply', 'assistant', [{ type: 'text', text: 'Updated the card design.' }]),
  ];
  for (const [id, content, isError, interrupted] of [
    [
      'completed',
      JSON.stringify({ designId: 'design-1', revisionId: 'rev-1', source: canary }),
      false,
      false,
    ],
    ['failed', `Tool error: ${canary}`, true, false],
    ['stopped', canary, false, true],
  ] as const) {
    const call = {
      type: 'tool_use' as const,
      id,
      name: 'droidex-canvas___canvas_write',
      input: { designId: 'design-1', files: { 'src/a.tsx': canary } },
    };
    lines.push(
      line(`call-${id}`, 'assistant', [call]),
      line(`result-${id}`, 'user', [
        { type: 'tool_result', tool_use_id: id, content, is_error: isError, interrupted },
      ]),
    );
  }
  lines.push(
    line('ordinary-call', 'assistant', [
      {
        type: 'tool_use',
        id: 'ordinary',
        name: 'mcp__other__canvas_write',
        input: { query: 'ordinary' },
      },
    ]),
    line('ordinary-result', 'user', [
      { type: 'tool_result', tool_use_id: 'ordinary', content: canary },
    ]),
  );
  const path = join(directory, `${appSessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  const replayed = parseFullSessionTranscript(appSessionId, appSessionId, path, 'primary');
  const md = transcriptToMarkdown(replayed, META);
  assert.match(md, /\*\*Canvas:\*\* Updated design · rev-1/);
  assert.match(md, /\*\*Canvas:\*\* Could not update design/);
  assert.match(md, /\*\*Canvas:\*\* Canvas tool stopped\./);
  assert.match(md, /\*\*Tool: mcp__other__canvas_write\*\*/);
  assert.ok(md.includes(`\`\`\`\n${canary}\n\`\`\``));
  assert.ok(md.includes(`## User\n\nPlease show ${canary}`));
  assert.match(md, /## Droid\n\nUpdated the card design\./);
  assert.equal(
    md.split(canary).length - 1,
    2,
    'only ordinary tool output and user prose retain the canary',
  );
});

test('Codex Canvas completion, failure and interruption export as safe activity after replay', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-canvas-markdown-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = directory;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const summary = sessionSummary({ appSessionId: 'codex-canvas-export', provider: 'codex' });
  const file = new ProviderTranscriptFile(summary.appSessionId, () => summary);
  const flow = new SessionEventFlow({
    appendTranscript: (event) => {
      void file.append(event);
    },
    flushTranscript: () => undefined,
    applySideEffects: () => undefined,
    resolveChildScope: () => undefined,
    recordUsage: () => undefined,
  });
  const mapper = new CodexEventMapper(summary.appSessionId);
  const canary = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
  await file.appendPrompt(`Update the card design. Please show ${canary}`);
  for (const status of ['completed', 'failed', 'interrupted']) {
    const item = {
      type: 'dynamicToolCall',
      id: status,
      namespace: 'droidex_canvas',
      tool: 'canvas_write',
      arguments: { designId: 'design-1', files: { 'src/a.tsx': canary } },
      contentItems: [{ type: 'inputText', text: canary }],
      success: status === 'completed',
    };
    for (const event of [
      ...mapper.map('item/started', { item: { ...item, status: 'inProgress' } }),
      ...mapper.map('item/completed', { item: { ...item, status } }),
    ])
      flow.apply(summary.appSessionId, summary.appSessionId, 'primary', event);
  }
  await file.flush();
  const replayed = parseFullSessionTranscript(
    summary.appSessionId,
    summary.appSessionId,
    file.path,
    'primary',
  );
  assert.deepEqual(
    replayed
      .filter((event) => event.kind === 'tool_result')
      .map((event) => [event.canvasActivity?.state, event.interrupted]),
    [
      ['completed', undefined],
      ['failed', undefined],
      ['failed', true],
    ],
  );
  const md = transcriptToMarkdown(replayed, META);
  assert.equal(md.split(canary).length - 1, 1, 'only user prose retains the canary');
  assert.match(md, /\*\*Canvas:\*\* Updated design/);
  assert.match(md, /\*\*Canvas:\*\* Could not update design/);
  assert.match(md, /\*\*Canvas:\*\* Canvas tool stopped\./);
  assert.ok(md.includes(`## User\n\nUpdate the card design. Please show ${canary}`));
});
