import assert from 'node:assert/strict';
import test from 'node:test';
import { DroidTurn } from './DroidTurn.js';
import { parseSessionLineEvents } from './sessionTranscriptParser.js';

test('steering accepts paths inside reports and refuses only a leading slash command', async () => {
  const turn = new DroidTurn('provider');
  const pushed: string[] = [];
  const client = {
    addUserMessage: async ({ text, messageId }: { text: string; messageId?: string }) => {
      assert.ok(messageId);
      pushed.push(text);
      const [replayed] = parseSessionLineEvents('app', 'provider', 'primary', {
        type: 'message',
        id: messageId,
        message: { role: 'user', content: [{ type: 'text', text }] },
      });
      assert.equal(replayed.steered, true, 'Droid must retain the steer marker on replay');
      turn.observe({ type: 'create_message', message: { role: 'user', id: messageId } });
      turn.observeMainEvent({
        type: 'user',
        message: {
          id: messageId,
          role: 'user',
          createdAt: 0,
          updatedAt: 0,
          content: [{ type: 'text', text }],
        },
      });
      return {};
    },
  };
  for (const text of [
    'I ran `ls /` and checked /workspace.',
    'please /broken-skill',
    'please\n/command',
  ])
    assert.equal(await turn.steer(client, text, text), true);
  assert.equal(await turn.steer(client, '  /command', 'slash'), false);
  assert.equal(pushed.length, 3);
  turn.stop();
});

test('stop after a Droid steer echo leaves delivery unconfirmed', async () => {
  const turn = new DroidTurn('provider');
  const client = {
    addUserMessage: async ({ messageId }: { messageId?: string }) => {
      turn.observe({ type: 'create_message', message: { role: 'user', id: messageId } });
      return {};
    },
  };
  const delivered = turn.steer(client, 'follow up', 'follow-up');

  turn.stop();
  assert.equal(await delivered, 'unconfirmed');
});
