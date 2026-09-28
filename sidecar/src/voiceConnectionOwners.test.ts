import assert from 'node:assert/strict';
import test from 'node:test';

import { VoiceConnectionOwners } from './voiceConnectionOwners.js';

function owners(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped: string[] = [];
  const voice = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  t.after(() => {
    voice.close();
  });
  return { voice, stopped };
}

test('a page gone for the whole grace period loses its call', (t) => {
  const { voice, stopped } = owners(t);
  const socket = {};
  voice.connected('page-one', socket);
  voice.started('chat-one', 'page-one');
  voice.disconnected(socket);

  t.mock.timers.tick(9_999);
  assert.deepEqual(stopped, []);
  t.mock.timers.tick(1);
  assert.deepEqual(stopped, ['chat-one']);
});

test('the same page reclaims its call on a new connection; a new page cannot', (t) => {
  const { voice, stopped } = owners(t);
  const first = {};
  voice.connected('page-one', first);
  voice.started('chat-one', 'page-one');
  voice.disconnected(first);
  voice.connected('page-one', {});
  voice.connected('page-two', {});
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, []);
});

test('a start that finishes after its page reconnected belongs to the live connection', (t) => {
  const { voice, stopped } = owners(t);
  const first = {};
  voice.connected('page-one', first);
  voice.startBegan('chat-one');
  voice.disconnected(first);
  voice.connected('page-one', {});
  voice.startEnded('chat-one');
  voice.started('chat-one', 'page-one');
  t.mock.timers.tick(20_000);
  assert.deepEqual(stopped, []);
});

test('an orphan stop waits for a new call opening on the same chat', (t) => {
  const { voice, stopped } = owners(t);
  const reloaded = {};
  voice.connected('page-one', reloaded);
  voice.started('chat-one', 'page-one');
  voice.disconnected(reloaded);
  voice.connected('page-two', {});
  voice.startBegan('chat-one');
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, []);

  // The new call opened, so it replaces the orphan without a stop.
  voice.startEnded('chat-one');
  voice.started('chat-one', 'page-two');
  t.mock.timers.tick(20_000);
  assert.deepEqual(stopped, []);
});

test('an orphan is still stopped when the new call on its chat fails to open', (t) => {
  const { voice, stopped } = owners(t);
  const reloaded = {};
  voice.connected('page-one', reloaded);
  voice.started('chat-one', 'page-one');
  voice.disconnected(reloaded);
  voice.startBegan('chat-one');
  t.mock.timers.tick(10_000);
  voice.startEnded('chat-one');
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, ['chat-one']);
});

test('only the owning page can stop a call', (t) => {
  const { voice, stopped } = owners(t);
  voice.connected('page-one', {});
  voice.connected('page-two', {});
  voice.started('chat-one', 'page-one');
  voice.started('chat-one', 'page-two');

  assert.equal(voice.stopped('chat-one', 'page-one'), false);
  assert.equal(voice.stopped('chat-one', 'page-two'), true);
  assert.deepEqual(stopped, []);
});
