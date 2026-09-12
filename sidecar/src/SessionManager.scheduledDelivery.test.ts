import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';

const prompt = 'Design Mode reference pack:\nScheduled follow-up';

async function ready(onSessionAvailable?: (appSessionId: string) => void) {
  let finish: () => void = () => undefined;
  const initialTurn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let streaming = false;
  const h = createSessionManagerTestContext({
    ...(onSessionAvailable ? { onSessionAvailable } : {}),
    onEvent: (event) => {
      if (event.type !== 'session.updated') return;
      if (event.session.streaming) streaming = true;
      else if (streaming) finish();
    },
  });
  await h.create({
    clientRef: 'scheduled-target',
    cwd: h.home,
    sessionPurpose: 'chat',
    goal: 'Initial user prompt',
    title: 'User conversation',
    interactionMode: 'auto',
    autonomy: 'low',
  });
  await initialTurn;
  return h;
}

test('scheduled acceptance waits for setup and a runtime response, not streaming reservation', async () => {
  const h = await ready();
  const provider = h.provider.session('provider-1');
  const settings = provider.deferNextUpdateSettings();
  const stream = provider.deferNextStream();
  let acknowledged = false;
  try {
    const count = provider.settings.length;
    const delivery = h
      .deliverScheduledMessage('provider-1', prompt, () => true)
      .then((receipt) => {
        acknowledged = true;
        return receipt;
      });
    await provider.waitForSettings(count + 1);
    assert.equal(acknowledged, false);
    assert.deepEqual(provider.prompts, ['Initial user prompt']);
    settings.resolve();
    await provider.waitForPrompts(2);
    assert.equal(acknowledged, false);
    stream.resolve();
    const receipt = await delivery;
    assert.equal(receipt.status, 'accepted');
    if (receipt.status === 'accepted') await receipt.settled;
    assert.deepEqual(provider.prompts, ['Initial user prompt', prompt]);
  } finally {
    settings.resolve();
    stream.resolve();
    await h.dispose();
  }
});

test('provider setup failure never reports delivery or submits the scheduled prompt', async () => {
  const h = await ready();
  try {
    const provider = h.provider.session('provider-1');
    provider.nextUpdateSettingsError = new Error('Policy setup failed');
    const receipt = await h.deliverScheduledMessage('provider-1', prompt, () => true);
    assert.equal(receipt.status, 'unavailable');
    assert.deepEqual(provider.prompts, ['Initial user prompt']);
    assert.ok(
      h.events.some((event) => event.type === 'error' && /Policy setup failed/.test(event.message)),
    );
  } finally {
    await h.dispose();
  }
});

for (const action of ['cancel', 'close', 'interrupt']) {
  test(`${action} during async provider setup prevents the scheduled send`, async () => {
    const h = await ready();
    const provider = h.provider.session('provider-1');
    const settings = provider.deferNextUpdateSettings();
    let current = true;
    try {
      const count = provider.settings.length;
      const delivery = h.deliverScheduledMessage('provider-1', prompt, () => current);
      await provider.waitForSettings(count + 1);
      if (action === 'cancel') current = false;
      else if (action === 'interrupt')
        await h.handle({ type: 'session.interrupt', appSessionId: 'provider-1' });
      else await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
      settings.resolve();
      assert.equal((await delivery).status, 'unavailable');
      assert.deepEqual(provider.prompts, ['Initial user prompt']);
      if (action === 'cancel') {
        assert.equal(
          h.calls.some((call) => call.method === 'session.close'),
          false,
        );
      }
    } finally {
      settings.resolve();
      await h.dispose();
    }
  });
}

test('an unacknowledged runtime failure is conservatively unknown, never Delivered', async () => {
  const h = await ready();
  try {
    const provider = h.provider.session('provider-1');
    provider.nextStreamError = new Error('Transport failed before first response');
    const receipt = await h.deliverScheduledMessage(
      'provider-1',
      'Scheduled follow-up',
      () => true,
    );
    assert.equal(receipt.status, 'unavailable');
    if (receipt.status === 'unavailable') assert.match(receipt.error, /outcome unknown/);
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Scheduled follow-up']);
  } finally {
    await h.dispose();
  }
});

test('scheduled delivery waits for user settings changes and keeps their effective values', async () => {
  const available: string[] = [];
  const h = await ready((id) => {
    available.push(id);
  });
  const provider = h.provider.session('provider-1');
  const gate = provider.deferNextUpdateSettings();
  try {
    const count = provider.settings.length;
    const changing = h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      modelId: 'user-selected-model',
      autonomy: 'medium',
    });
    await provider.waitForSettings(count + 1);
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), {
      status: 'busy',
    });
    const eventCount = h.events.length;
    gate.resolve();
    await changing;
    assert.deepEqual(available, ['provider-1']);
    assert.ok(h.events.slice(eventCount).some((event) => event.type === 'session.updated'));
    const receipt = await h.deliverScheduledMessage('provider-1', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    if (receipt.status === 'accepted') await receipt.settled;
    const latest = h.events.filter((event) => event.type === 'session.updated').at(-1);
    assert.equal(latest?.session.modelId, 'user-selected-model');
    assert.equal(latest?.session.autonomy, 'medium');
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Later']);
  } finally {
    gate.resolve();
    await h.dispose();
  }
});

test('manual compaction completion rearms delivery without fabricating a summary update', async () => {
  const available: string[] = [];
  const h = await ready((id) => {
    available.push(id);
  });
  const gate = h.provider.session('provider-1').deferNextCompaction();
  try {
    const compacting = h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), {
      status: 'busy',
    });
    assert.deepEqual(available, []);
    gate.resolve();
    await compacting;
    assert.deepEqual(available, ['provider-1']);
    const receipt = await h.deliverScheduledMessage('provider-1', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    if (receipt.status === 'accepted') await receipt.settled;
  } finally {
    gate.resolve();
    await h.dispose();
  }
});

test('only the last pending question response rearms delivery, without protocol noise', async () => {
  const available: string[] = [];
  const h = await ready((id) => {
    available.push(id);
  });
  try {
    const ask = h.provider.session('provider-1').handlers.askUserHandler;
    assert.ok(ask);
    const answers = [
      ask({ toolCallId: 'first', questions: [] }),
      ask({ toolCallId: 'last', questions: [] }),
    ];
    const questions = h.events.filter((event) => event.type === 'question.requested');
    assert.equal(questions.length, 2);
    assert.deepEqual(await h.deliverScheduledMessage('provider-1', 'Later', () => true), {
      status: 'busy',
    });
    const eventCount = h.events.length;
    for (const [index, event] of questions.entries()) {
      await h.handle({
        type: 'question.respond',
        appSessionId: 'provider-1',
        requestId: event.question.requestId,
        cancelled: true,
        answers: [],
      });
      assert.equal(available.length, index);
    }
    await Promise.all(answers);
    assert.deepEqual(available, ['provider-1']);
    assert.equal(h.events.length, eventCount);
  } finally {
    await h.dispose();
  }
});

test('acknowledged delivery need not wait for turn cleanup', async () => {
  let finish: () => void = () => undefined;
  const initialTurn = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let streaming = false;
  const h = createSessionManagerTestContext({
    onEvent: (event) => {
      if (event.type !== 'session.updated') return;
      if (event.session.streaming) streaming = true;
      else if (streaming) finish();
    },
  });
  let release: () => void = () => undefined;
  const settlement = new Promise<void>((resolve) => {
    release = resolve;
  });
  class DeferredSettlementSession extends FakeFactorySession {
    waitForSettlement = false;
    override async *stream(text: string, options: Parameters<FakeFactorySession['stream']>[1]) {
      yield* super.stream(text, options);
      if (this.waitForSettlement) await settlement;
    }
  }
  const provider = new DeferredSettlementSession('provider-delivery', {}, h.calls);
  h.runtime.createQueue.push(provider);
  try {
    await h.create({
      clientRef: 'scheduled-settlement',
      cwd: h.home,
      sessionPurpose: 'chat',
      goal: 'Initial user prompt',
      title: 'User conversation',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    await initialTurn;
    provider.waitForSettlement = true;
    const receipt = await h.deliverScheduledMessage('provider-delivery', 'Later', () => true);
    assert.equal(receipt.status, 'accepted');
    let settled = false;
    if (receipt.status === 'accepted')
      void receipt.settled.then(() => {
        settled = true;
      });
    await Promise.resolve();
    assert.equal(settled, false);
    release();
    if (receipt.status === 'accepted') await receipt.settled;
    assert.deepEqual(provider.prompts, ['Initial user prompt', 'Later']);
  } finally {
    release();
    await h.dispose();
  }
});
