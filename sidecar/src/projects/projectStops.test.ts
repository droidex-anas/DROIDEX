import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, drain, input, projectWithThread } from '../testing/projectServiceHarness.js';

test('Stop during an in-flight project Resume keeps the lead stopped', async (t) => {
  const { h, main } = await projectWithThread(t);
  const gate = deferred();
  h.port.interrupt = () => gate.promise;
  const pausing = h.projects.pause(main);
  const resuming = h.projects.resume(main);
  await h.projects.userStopped(main);
  gate.resolve();
  await pausing;
  await resuming;
  assert.equal(h.projects.list()[0].leadStopped, true);
});

test('cancelling a failed queued spawn while the lead is stopped leaves no report from it', async (t) => {
  const { h, main } = await projectWithThread(t);
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, { ...input, title: 'Queued' });
  await h.projects.userStopped(main);
  h.state.createFailure = 'before-bind';
  h.state.capacity = 'free';
  h.projects.capacityChanged();
  await drain();
  assert.equal(await h.projects.stop(main, queued.appSessionId), 'cancelled');
  const saved = h.state.saved[0];
  assert.ok(saved.pending.every((message) => message.from !== queued.appSessionId));
});
