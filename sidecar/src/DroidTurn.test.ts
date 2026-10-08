import assert from 'node:assert/strict';
import test from 'node:test';
import { DroidTurn } from './DroidTurn.js';
import { parseSessionLineEvents } from './sessionTranscriptParser.js';

test('steering accepts paths inside reports and refuses only a leading slash command', async () => {
  const turn = new DroidTurn('provider');
  const pushed: string[] = [];
  const client = {
    addUserMessage: async ({ text, messageId }: { text: string; messageId?: string }) => {
      pushed.push(text);
      const [replayed] = parseSessionLineEvents('app', 'provider', 'primary', {
        type: 'message',
        id: messageId,
        message: { role: 'user', content: [{ type: 'text', text }] },
      });
      assert.equal(replayed.steered, true, 'Droid must retain the steer marker on replay');
      turn.observe({ type: 'create_message', message: { role: 'user', id: messageId } });
      return {};
    },
  };
  for (const text of [
    'I ran `ls /` and checked /workspace.',
    'please /broken-skill',
    'please\n/command',
  ])
    assert.equal(await turn.steer(client, text), true);
  assert.equal(await turn.steer(client, '  /command'), false);
  assert.equal(pushed.length, 3);
  turn.stop();
});
