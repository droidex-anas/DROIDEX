import assert from 'node:assert/strict';
import test from 'node:test';

import { VoiceConnectionOwners } from './voiceConnectionOwners.js';

test('a disconnected page loses its voice session after the reconnect grace period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped: string[] = [];
  const owners = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  const connection = {};
  owners.started('chat-one', 'page-one', connection);
  owners.disconnected(connection);

  t.mock.timers.tick(9_999);
  assert.deepEqual(stopped, []);
  t.mock.timers.tick(1);
  assert.deepEqual(stopped, ['chat-one']);

  owners.stopped('chat-one');
  owners.close();
});

test('the same page reclaims a call, while a new page cannot', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped: string[] = [];
  const owners = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  const first = {};
  const second = {};
  owners.started('chat-one', 'page-one', first);
  owners.disconnected(first);
  owners.connected('page-one', second);
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, []);

  owners.disconnected(second);
  owners.connected('page-two', {});
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, ['chat-one']);

  owners.started('chat-two', 'page-two', second);
  owners.disconnected(second);
  owners.stopped('chat-two');
  owners.started('chat-three', 'page-two', second);
  owners.disconnected(second);
  owners.close();
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, ['chat-one']);
});

test('a failed replacement leaves the old orphan timer and cannot stop its call', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped: string[] = [];
  const owners = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  const first = {};
  owners.started('chat-one', 'page-one', first);
  owners.disconnected(first);

  assert.equal(owners.stopped('chat-one', 'page-two'), false);
  t.mock.timers.tick(10_000);
  assert.deepEqual(stopped, ['chat-one']);
  owners.close();
});

test('an old page cannot stop the replacement page call', () => {
  const stopped: string[] = [];
  const owners = new VoiceConnectionOwners((appSessionId) => stopped.push(appSessionId));
  owners.started('chat-one', 'page-one', {});
  owners.started('chat-one', 'page-two', {});

  assert.equal(owners.stopped('chat-one', 'page-one'), false);
  assert.equal(owners.stopped('chat-one', 'page-two'), true);
  assert.deepEqual(stopped, []);
  owners.close();
});
