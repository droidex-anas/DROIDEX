import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { ProfileUsageSnapshot } from './profileShare';
import { useProfileUsage } from './useProfileUsage';

function usageWith(lifetimeTokens: number): ProfileUsageSnapshot {
  return {
    sync: { status: 'ready', sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' } },
    lifetimeTokens,
    peakDayTokens: lifetimeTokens,
    sessions: 1,
    currentStreak: 1,
    longestStreak: 1,
    trackingSince: 1,
    days: [],
    harnesses: [],
    models: [],
    mostUsedHarness: null,
    totals: {
      events: 1,
      inputTokens: lifetimeTokens,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      providerCostMicrousd: 0,
      estimatedCostMicrousd: 0,
      tokensComplete: true,
    },
    coverage: {},
    timeZone: 'UTC',
  };
}

test('an older background poll reply does not replace a finished manual refresh', async (t) => {
  t.after(async () => {
    await act(async () => root.unmount());
  });
  const document = {
    nodeType: 9,
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  const replies: ((usage: ProfileUsageSnapshot) => void)[] = [];
  const droidex = {
    getProfileUsage: () => new Promise<ProfileUsageSnapshot>((resolve) => replies.push(resolve)),
  };
  const window = { document, HTMLIFrameElement: class {}, droidex };
  for (const [key, value] of Object.entries({ window, document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const container = {
    nodeType: 1,
    tagName: 'DIV',
    ownerDocument: document,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    addEventListener() {},
    removeEventListener() {},
    textContent: '',
  };
  let ledger!: ReturnType<typeof useProfileUsage>;
  function Harness() {
    ledger = useProfileUsage();
    return null;
  }
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => root.render(createElement(Harness)));
  await act(async () => replies[0](usageWith(500)));
  await act(async () => t.mock.timers.tick(5000));
  assert.equal(replies.length, 2, 'the background poll is in flight');

  let refresh!: Promise<void>;
  await act(async () => {
    refresh = ledger.refresh();
  });
  await act(async () => {
    replies[2](usageWith(2000));
    await refresh;
  });
  assert.equal(ledger.usage?.lifetimeTokens, 2000);

  await act(async () => replies[1](usageWith(1000)));
  assert.equal(ledger.usage?.lifetimeTokens, 2000, 'the older poll reply must be dropped');
  assert.equal(ledger.loading, false);
});
