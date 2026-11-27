import assert from 'node:assert/strict';
import test from 'node:test';

import { PrimaryTurnState } from './PrimaryTurnState.js';

test('typed ownership reserves streaming before the provider starts and settles once', () => {
  const state = new PrimaryTurnState();
  assert.deepEqual(state.summaryFields(false), {
    streaming: false,
    queuedSends: 0,
    pendingSteers: [],
  });
  const turn = state.beginTypedTurn();
  assert.equal(state.streaming, true);
  assert.equal(state.settle(), false);
  assert.throws(() => state.beginTypedTurn());
  const promise = Promise.resolve();
  state.attachTypedPromise(turn, promise);
  assert.equal(state.turnPromise, promise);
  assert.equal(state.endTypedTurn(turn), true);
  assert.equal(state.turnPromise, undefined);
  assert.equal(state.settle(), true);
  assert.equal(state.streaming, false);
  assert.equal(state.settle(), false);
});

test('a late Stop receipt and stale typed settlement cannot pause a newer turn', () => {
  const state = new PrimaryTurnState();
  const first = state.beginTypedTurn();
  const stopped = Promise.resolve();
  state.attachTypedPromise(first, stopped);
  state.requestStop();
  state.endTypedTurn(first);
  state.settle();
  const next = state.beginTypedTurn();
  const running = Promise.resolve();
  state.attachTypedPromise(next, running);

  assert.equal(state.acknowledgeStop(stopped), false);
  assert.equal(state.endTypedTurn(first), false);
  assert.throws(() => state.attachTypedPromise(first, stopped));
  assert.equal(state.turnPromise, running);
  assert.equal(state.summaryFields(false).streaming, true);
});

test('Send now keeps the next typed turn reserved until its interrupt is released', async () => {
  const state = new PrimaryTurnState();
  const turn = state.beginTypedTurn();
  let resolve = (): void => undefined;
  const interrupt = new Promise<void>((done) => {
    resolve = done;
  });
  state.requestSendNow();
  state.trackSendNowInterrupt(interrupt);
  state.endTypedTurn(turn);
  assert.equal(state.settle(), false);
  assert.throws(() => state.beginTypedTurn());
  state.releaseSendNowInterrupt(Promise.resolve());
  assert.equal(state.settle(), false);
  assert.throws(() => state.beginTypedTurn());
  resolve();
  await interrupt;
  state.releaseSendNowInterrupt(interrupt);
  assert.equal(state.settle(), true);
  assert.equal(state.interruptingToSend, false);
  state.beginTypedTurn();
  assert.equal(state.streaming, true);
});

test('overlapping typed and delegated turns reserve settlement for the last owner', () => {
  for (const typedEndsFirst of [true, false]) {
    const state = new PrimaryTurnState();
    const typed = state.beginTypedTurn();
    const reservation = Promise.resolve();
    const delegated = state.beginDelegatedTurn(reservation);
    assert.equal(state.delegatedTurnOpen, true);
    state.endDelegatedTurn();
    assert.equal(state.delegatedTurnOpen, false);
    assert.equal(state.delegatedTurnSettled, reservation);
    if (typedEndsFirst) assert.equal(state.endTypedTurn(typed), false);
    else state.releaseDelegatedTurn(delegated);
    assert.equal(state.settle(), false);
    if (typedEndsFirst) state.releaseDelegatedTurn(delegated);
    else assert.equal(state.endTypedTurn(typed), true);
    assert.equal(state.settle(), true);
    assert.equal(state.streaming, false);
  }
});

test('a stale delegated flush cannot release a newer delegated turn', () => {
  const state = new PrimaryTurnState();
  const settled = Promise.resolve();
  const firstTurn = state.beginDelegatedTurn(settled);
  state.endDelegatedTurn();
  const nextTurn = state.beginDelegatedTurn(settled);
  assert.equal(state.releaseDelegatedTurn(firstTurn), false);
  assert.equal(state.isCurrentDelegated(firstTurn), false);
  assert.equal(state.settle(), false);
  assert.equal(state.releaseDelegatedTurn(nextTurn), true);
  assert.equal(state.settle(), true);
  assert.equal(state.isCurrentDelegated(nextTurn), true);
});

test('close preserves or discards both queues, cannot downgrade, and failure reopens', () => {
  const state = new PrimaryTurnState();
  const prompt = { text: 'waiting', order: 1, steerId: 'steer' };
  state.queueSend(prompt);
  state.holdSteer(prompt);
  state.beginClose('preserve-pending');
  assert.deepEqual(state.pendingSends, [prompt]);
  assert.deepEqual(state.steers, [prompt]);
  assert.throws(() => state.beginTypedTurn());
  assert.throws(() => state.beginDelegatedTurn(Promise.resolve()));
  state.reopenAfterFailedClose();
  assert.equal(state.closeMode, undefined);
  const turn = state.beginTypedTurn();
  state.beginClose('discard-pending');
  state.beginClose('preserve-pending');
  assert.equal(state.closeMode, 'discard-pending');
  assert.deepEqual(state.pendingSends, []);
  assert.deepEqual(state.steers, []);
  assert.equal(state.streaming, true);
  assert.equal(state.summaryFields(false).streaming, true);
  state.endTypedTurn(turn);
  state.settle();
  assert.equal(state.streaming, false);
});

test('failed-open cleanup retains both queues when process cleanup fails and reopens', () => {
  const state = new PrimaryTurnState();
  const prompt = { text: 'waiting', order: 1, steerId: 'steer' };
  state.queueSend(prompt);
  state.holdSteer(prompt);
  state.beginFailedOpenCleanup();
  assert.equal(state.closeMode, 'discard-pending');
  assert.throws(() => state.beginTypedTurn());
  state.reopenAfterFailedClose();
  assert.deepEqual(state.summaryFields(false), {
    streaming: false,
    queuedSends: 1,
    pendingSteers: [{ id: 'steer', text: 'waiting', canWithdraw: false }],
  });
  assert.equal(state.takeNext(), prompt);
  state.beginTypedTurn();
  assert.equal(state.streaming, true);
});

test('interrupt refusal clears only its own Stop or Send now request', () => {
  const state = new PrimaryTurnState();
  const turn = state.beginTypedTurn();
  state.requestSendNow();
  state.requestStop();
  state.clearStop();
  assert.equal(state.interrupting, false);
  assert.equal(state.interruptingToSend, true);
  state.requestStop();
  state.refuseSendNow();
  assert.equal(state.interrupting, true);
  assert.equal(state.interruptingToSend, false);
  assert.equal(state.acknowledgeStop(undefined), true);
  assert.equal(state.streaming, true);
  assert.equal(state.summaryFields(false, 'stop-receipt').streaming, false);
  assert.equal(state.summaryFields(false, 'stop-receipt').phase, 'paused');
  assert.equal(state.summaryFields(false).streaming, true);
  state.endTypedTurn(turn);
  state.settle();
  assert.equal(state.interrupting, false);
});

test('queue projections deduplicate steers, preserve order and reflect harness withdrawal', () => {
  const state = new PrimaryTurnState();
  const first = { text: 'first', order: 1, steerId: 'one' };
  const second = { text: 'second', order: 2, steerId: 'two' };
  state.queueSend(second);
  state.requeueFirst([first]);
  state.holdSteer(first);
  assert.deepEqual(state.summaryFields(false), {
    streaming: false,
    queuedSends: 2,
    pendingSteers: [
      { id: 'one', text: 'first', canWithdraw: false },
      { id: 'two', text: 'second', canWithdraw: true },
    ],
  });
  assert.equal(state.summaryFields(true).pendingSteers?.[0].canWithdraw, true);
  assert.equal(state.removeSteer(first), true);
  assert.equal(state.removeSteer(first), false);
  assert.equal(state.takeNext(), first);
  assert.deepEqual(state.takeAllPending(), [second]);
  assert.equal(state.takeNext(), undefined);
  state.requeueFirst([first, second]);
  assert.equal(state.removePending(first), true);
  assert.equal(state.removePending(first), false);
  state.holdSteer(second);
  state.clearPending();
  assert.equal(state.summaryFields(false).queuedSends, 0);
  assert.deepEqual(state.steers, [second]);
  state.queueSend(first);
  state.clearQueue();
  assert.deepEqual(state.summaryFields(false).pendingSteers, []);
});

test('Send now moves a steer first, keeps harness ownership and orders the remaining sends', () => {
  const state = new PrimaryTurnState();
  assert.equal(state.prioritizeForSendNow('missing'), undefined);
  const first = { text: 'first', order: 1, steerId: 'one' };
  const second = { text: 'second', order: 2, steerId: 'two' };
  const third = { text: 'third', order: 3, steerId: 'three' };
  state.queueSend(third);
  state.queueSend(second);
  state.holdSteer(first);
  state.holdSteer(second);
  assert.equal(state.prioritizeForSendNow('missing'), undefined);
  assert.deepEqual(state.pendingSends, [third, second]);
  assert.equal(state.prioritizeForSendNow('two'), second);
  assert.deepEqual(state.steers, [first, second]);
  assert.equal(state.takeNext(), second);
  assert.deepEqual(state.takeAllPending(), [first, third]);
  assert.equal(state.takeNext(), undefined);
  assert.deepEqual(state.takeAllPending(), []);
  assert.equal(state.removeSteer(second), true);
  assert.deepEqual(state.steers, [first]);
});
