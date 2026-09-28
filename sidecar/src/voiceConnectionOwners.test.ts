import assert from 'node:assert/strict';
import test from 'node:test';

import { VoiceConnectionOwners } from './voiceConnectionOwners.js';

function owners(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const stopped: string[] = [];
  const voice = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  t.after(() => {
    voice.close();
  });
  const call = (appSessionId: string, pageId: string, attempt: string) => {
    voice.startBegan(appSessionId, pageId, attempt);
    voice.startSucceeded(appSessionId, attempt);
  };
  return { voice, stopped, call };
}

test('a page gone for the whole grace period loses its call', (t) => {
  const { voice, stopped, call } = owners(t);
  const socket = {};
  voice.connected('page-one', socket);
  call('chat-one', 'page-one', 'a');
  voice.disconnected(socket);

  t.mock.timers.tick(9_999);
  assert.deepEqual(stopped, []);
  t.mock.timers.tick(1);
  assert.deepEqual(stopped, ['chat-one']);
});

test('the same page reclaims its call on a new connection; a new page cannot', (t) => {
  const { voice, stopped, call } = owners(t);
  const first = {};
  voice.connected('page-one', first);
  call('chat-one', 'page-one', 'a');
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
  voice.startBegan('chat-one', 'page-one', 'a');
  voice.disconnected(first);
  voice.connected('page-one', {});
  voice.startSucceeded('chat-one', 'a');
  t.mock.timers.tick(20_000);
  assert.deepEqual(stopped, []);
});

test('an orphan stop waits for a newer call opening on the same chat', (t) => {
  const { voice, stopped, call } = owners(t);
  const reloaded = {};
  voice.connected('page-one', reloaded);
  call('chat-one', 'page-one', 'a');
  voice.disconnected(reloaded);
  voice.connected('page-two', {});
  voice.startBegan('chat-one', 'page-two', 'b');
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, []);

  voice.startSucceeded('chat-one', 'b');
  t.mock.timers.tick(20_000);
  assert.deepEqual(stopped, []);
});

test('a replaced start cannot take the call back from the newer one', (t) => {
  const { voice, stopped } = owners(t);
  const gone = {};
  voice.connected('page-one', gone);
  voice.startBegan('chat-one', 'page-one', 'a');
  voice.disconnected(gone);
  voice.connected('page-two', {});
  voice.startBegan('chat-one', 'page-two', 'b');
  voice.startSucceeded('chat-one', 'b');
  // The first start settles late, after it was replaced.
  voice.startSucceeded('chat-one', 'a');
  t.mock.timers.tick(20_000);
  assert.deepEqual(stopped, []);
});

test('an older start settling does not clear the newer one', (t) => {
  const { voice, stopped, call } = owners(t);
  const reloaded = {};
  voice.connected('page-one', reloaded);
  call('chat-one', 'page-one', 'a');
  voice.disconnected(reloaded);
  voice.connected('page-two', {});
  voice.startBegan('chat-one', 'page-two', 'b');
  voice.startBegan('chat-one', 'page-two', 'c');
  voice.startFailed('chat-one', 'b');
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, []);
});

test('an orphan is still stopped when the newer call fails or never settles', (t) => {
  const { voice, stopped, call } = owners(t);
  const first = {};
  voice.connected('page-one', first);
  call('chat-one', 'page-one', 'a');
  voice.disconnected(first);
  voice.startBegan('chat-one', 'page-two', 'b');
  voice.startFailed('chat-one', 'b');
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, ['chat-one']);

  const second = {};
  voice.connected('page-three', second);
  call('chat-two', 'page-three', 'c');
  voice.disconnected(second);
  voice.startBegan('chat-two', 'page-four', 'd');
  t.mock.timers.tick(40_000);
  assert.deepEqual(stopped, ['chat-one', 'chat-two']);
});

test('only the owning page can stop a call', (t) => {
  const { voice, stopped, call } = owners(t);
  voice.connected('page-one', {});
  voice.connected('page-two', {});
  call('chat-one', 'page-one', 'a');
  call('chat-one', 'page-two', 'b');

  assert.equal(voice.stopped('chat-one', 'page-one'), false);
  assert.equal(voice.stopped('chat-one', 'page-two'), true);
  assert.deepEqual(stopped, []);
});
