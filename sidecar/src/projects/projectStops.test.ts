import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deferred,
  drain,
  harness,
  input,
  interruptedSummary,
  projectWithThread,
  summary,
} from '../testing/projectServiceHarness.js';

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

test('a late Stop receipt preserves restart recovery for a newer thread turn', async (t) => {
  const { h, main, child } = await projectWithThread(t);
  const receipt = deferred();
  h.port.interrupt = async (id) => {
    await receipt.promise;
    // The lifecycle's late interrupt receipt overwrites the summary, not the live turn.
    const session = h.sessions.get(id);
    assert.ok(session);
    session.streaming = false;
    session.phase = 'paused';
    await h.projects.observe({ type: 'session.updated', session: { ...session } });
  };
  const stopping = h.projects.stop(main, child.appSessionId);
  await h.finish(child.appSessionId, 'Old turn finished.');
  await h.streaming(child.appSessionId, true);
  receipt.resolve();
  await stopping;
  assert.equal(
    h.state.saved[0].threads.find((thread) => thread.appSessionId === child.appSessionId)?.stopped,
    undefined,
  );
  h.projects.close();

  const restored = await harness(t, h.state.saved, false);
  restored.sessions.set(main, summary(main));
  restored.sessions.set(child.appSessionId, interruptedSummary(child.appSessionId));
  restored.projects.historyReady();
  await drain();
  const continuations = restored.sent.filter(({ id }) => id === child.appSessionId);
  assert.equal(continuations.length, 1);
  assert.match(continuations[0].prompt, /DROIDEX restarted while you were working/);
});
