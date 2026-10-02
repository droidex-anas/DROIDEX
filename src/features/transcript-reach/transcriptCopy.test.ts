import assert from 'node:assert/strict';
import test from 'node:test';

import type { FeedItem } from '../../components/chatFeed';
import type { TranscriptEvent } from '../../types/bridge';
import { copyTextForFeedItem, copyTextForFeedItemRange } from './transcriptCopy';

let seq = 0;
function ev(extra: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    id: extra.id ?? `e${String(++seq)}`,
    appSessionId: 'm',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: seq,
    kind: 'text',
    ...extra,
  };
}

test('copying a range of unmounted rows joins their copy text in order, either way round', () => {
  const items: FeedItem[] = [
    {
      type: 'message',
      key: 'm1',
      event: ev({ id: 'm1', text: 'turn 1 answer\n\n[truncated 40 chars]' }),
    },
    {
      type: 'tools',
      key: 'tools-1',
      events: [
        ev({
          id: 'call-1',
          kind: 'tool_call',
          toolName: 'Bash',
          toolArgs: { command: 'npm test' },
          toolUseId: 't1',
        }),
        ev({
          id: 'result-1',
          kind: 'tool_result',
          toolUseId: 't1',
          text: '\u001b[31mError: boom\u001b[0m',
        }),
      ],
    },
    { type: 'message', key: 'm2', event: ev({ id: 'm2', text: 'turn 2 stack trace' }) },
    { type: 'message', key: 'm3', event: ev({ id: 'm3', text: 'not in range' }) },
  ];

  const expected = 'turn 1 answer\n\nnpm test\n\nError: boom\n\nturn 2 stack trace';
  assert.equal(copyTextForFeedItemRange(items, 'm1', 'm2'), expected);
  assert.equal(copyTextForFeedItemRange(items, 'm2', 'm1'), expected);
  // A message drops the truncation sentinel; a command copies like the
  // terminal copy button: the command, then its output without ANSI codes.
  assert.equal(copyTextForFeedItem(items[0]!), 'turn 1 answer');
  assert.equal(copyTextForFeedItem(items[1]!), 'npm test\n\nError: boom');
});
