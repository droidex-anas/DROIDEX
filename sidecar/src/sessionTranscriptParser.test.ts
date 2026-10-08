import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionLineEvents } from './sessionTranscriptParser.js';
import type { SessionRole, TranscriptEvent } from './protocol.js';
import { parseStoredNotice, storedNoticeLine } from './sessionNotices.js';
import { formatBranchPrompt } from './branchPrompt.js';
import { formatSideChatPrompt } from './sideChatPrompt.js';

function messageLine(opts: {
  role: string;
  content: unknown[];
  visibility?: string;
  timestamp?: string;
}): string {
  return JSON.stringify({
    type: 'message',
    id: 'm1',
    timestamp: opts.timestamp ?? new Date(1000).toISOString(),
    message: {
      role: opts.role,
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
      content: opts.content,
    },
  });
}

/** Parses one stored message line as the primary session's replay does. */
function replay(
  opts: Parameters<typeof messageLine>[0],
  provider = 'provider',
  role: SessionRole = 'primary',
): TranscriptEvent[] {
  return parseSessionLineEvents('app', provider, role, JSON.parse(messageLine(opts)));
}

function userText(text: string, visibility?: string) {
  return { role: 'user', visibility, content: [{ type: 'text', text }] };
}

const truncated = (chars: number) => `\n\n[truncated ${String(chars)} chars]`;

test('a tool_result without content, or beside a null block, is preserved, not dropped', () => {
  // Regression: an undefined block.content made trimText throw, and the
  // surrounding try/catch dropped the whole line with its sibling events.
  const empty = replay({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] });
  const result = empty.find((e) => e.kind === 'tool_result');
  assert.ok(result, 'tool_result must survive even with no content body');
  assert.equal(result.text, '');
  assert.equal(result.toolUseId, 't1');

  // A degenerate array element (the literal null) must not crash the parse.
  const beside = replay({
    role: 'user',
    content: [null, { type: 'tool_result', tool_use_id: 't2', content: 'done' }],
  });
  assert.equal(beside.find((e) => e.kind === 'tool_result')?.text, 'done');
});

function assistantText(text: string): TranscriptEvent[] {
  return replay({ role: 'assistant', content: [{ type: 'text', text }] });
}

test('only an assistant App answer replays past the shared cap, whole and fenced under either line ending', () => {
  // Regression: every replayed text block shared the 12k cap, so a real
  // /visualize answer came back without its closing fence and rendered a
  // half-written script after a restart. The fence probe once also required a
  // bare newline, so the CRLF copy was cut mid-script.
  const body = `<main data-droidex-app-root>${'<p>chart</p>'.repeat(2_500)}</main>`;
  const lf = `Here is the lab.\n\n\`\`\`app\n${body}\n\`\`\`\n\nSuggested exercise: set a = 6.`;
  assert.ok(lf.length > 12_000);

  for (const answer of [lf, lf.replaceAll('\n', '\r\n')]) {
    const events = assistantText(answer);
    assert.equal(events.length, 1);
    assert.equal(events[0].text, answer);
  }

  const prose = assistantText('x'.repeat(13_000));
  assert.equal(prose[0].text, `${'x'.repeat(12_000)}${truncated(1000)}`);

  const fence = '```app\n';
  const app = assistantText(`${fence}${'y'.repeat(257_000 - fence.length)}`);
  assert.equal(app[0].text?.length, 256_000 + truncated(1000).length);
  assert.match(app[0].text ?? '', /\[truncated 1000 chars\]$/);

  // An `app` fence in machine output, thinking or a user bubble is never a
  // runnable App, so those blocks stay bounded by the shared cap.
  const oversized = `${fence}${'z'.repeat(13_000)}`;
  const capped = 12_000 + truncated(1007).length;
  const [tool] = replay({
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 't3', content: oversized }],
  });
  const [thinking] = replay({
    role: 'assistant',
    content: [{ type: 'thinking', thinking: oversized }],
  });
  const [user] = replay(userText(oversized));
  assert.equal(tool?.text?.length, capped);
  assert.equal(thinking?.kind, 'thinking');
  assert.equal(thinking?.text?.length, capped);
  assert.equal(user?.author, 'user');
  assert.equal(user?.text?.length, capped);
});

test('child sessions replay their prompts as the child, and never a skill activation', () => {
  const events = replay(userText('continue the child task'), 'child-provider', 'worker');
  assert.deepEqual(
    events.map(({ sourceSessionId, role, author, text }) => ({
      sourceSessionId,
      role,
      author,
      text,
    })),
    [
      {
        sourceSessionId: 'child-provider',
        role: 'worker',
        author: 'user',
        text: 'continue the child task',
      },
    ],
  );

  const activation = userText('Skill "review" activated: child task', 'user_only');
  for (const role of ['worker', 'validator'] as const)
    assert.deepEqual(replay(activation, 'child-provider', role), []);
});

test('a prompt wrapped in DROIDEX guidance or side-chat answers replays as only what the user typed', () => {
  const question = 'Why does the chart dip on Wednesday?';
  const conversation = `**User:** earlier question\n\n**Assistant:** ${'long answer '.repeat(10_000)}`;
  const cases: [string, string][] = [
    [
      'DROIDEX App request:\n/visualize compare renderer timings\n\nPrivate generation guidance:\nReturn one fenced app block using --app-background.',
      '/visualize compare renderer timings',
    ],
    [formatSideChatPrompt(question), question],
    // Also when the side chat was branched across harnesses.
    [
      formatBranchPrompt(formatSideChatPrompt(question), '**User:** /visualize coffee sales'),
      question,
    ],
    // However long the copied conversation.
    [formatBranchPrompt('Try it with Postgres', conversation), 'Try it with Postgres'],
  ];
  for (const [prompt, typed] of cases) {
    const events = replay(userText(prompt));
    assert.equal(events.length, 1);
    assert.equal(events[0].text, typed);
  }

  // The block as the renderer's promptWithSideChatReplies writes it.
  const withReplies = [
    'Use this',
    '',
    '<side_chat_replies>',
    'The user attached these answers from a side chat about this conversation.',
    '<reply>',
    'Sort by date first.',
    '</reply>',
    '<reply>',
    'Then by name.',
    '</reply>',
    '</side_chat_replies>',
  ].join('\n');
  const [event] = replay(userText(withReplies));
  assert.equal(event?.text, 'Use this');
  assert.deepEqual(event?.sideChatReplies, ['Sort by date first.', 'Then by name.']);
});

test('a stored model-switch or usage-limit notice replays exactly as it was written', () => {
  for (const notice of [
    { kind: 'status', modelSwitch: { from: 'old-model', to: 'new-model' } },
    { kind: 'error', isError: true, errorKind: 'usage_limit', resetsAt: 3000 },
  ] as const) {
    const original: TranscriptEvent = {
      id: 'notice',
      appSessionId: 'app',
      sourceSessionId: 'app',
      role: 'primary',
      ts: 2000,
      text: 'Notice',
      ...notice,
    };
    assert.deepEqual(
      parseSessionLineEvents(
        'app',
        'provider',
        'primary',
        JSON.parse(JSON.stringify(storedNoticeLine(original))),
      ),
      [original],
    );
  }
});

test('a stored tool result keeps the pictures it was saved with', () => {
  // The app's own transcript files hold the saved paths beside the text.
  const result = replay({
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 't9', content: 'Saved.', images: ['/p/tool-a.jpg'] },
    ],
  }).find((event) => event.kind === 'tool_result');
  assert.equal(result?.text, 'Saved.');
  assert.deepEqual(result?.images, ['/p/tool-a.jpg']);
});

test('stored idle-runtime release notices are hidden on both transcript and Droid notice replay', () => {
  const line = {
    type: 'status',
    id: 'release',
    timestamp: new Date(1).toISOString(),
    text: 'Session runtime released after 30 minutes idle to free memory. Sending a message restores it.',
  };
  assert.deepEqual(parseSessionLineEvents('app', 'provider', 'primary', line), []);
  assert.equal(parseStoredNotice('app', 'provider', 'primary', line), undefined);
  assert.equal(
    parseStoredNotice('app', 'provider', 'primary', { ...line, text: 'Current status' })?.text,
    'Current status',
  );
});
