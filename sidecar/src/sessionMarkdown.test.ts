import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptToMarkdown } from './sessionMarkdown.js';
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
