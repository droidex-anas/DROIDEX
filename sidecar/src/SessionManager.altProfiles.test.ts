import { InitializeSessionResultSchema } from '@factory/droid-sdk';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import {
  createSessionManagerTestContext,
  errorEvents,
  historicalSummary,
} from './testing/sessionManagerTestContext.js';

test('changing a closed Alt chat model loads its own profile and validates its catalog', async () => {
  const h = createSessionManagerTestContext();
  const previous = process.env.DROIDEX_ALT_HOME;
  const altHome = join(h.home, 'alt');
  mkdirSync(join(altHome, '.factory'), { recursive: true });
  writeFileSync(join(altHome, '.factory', 'auth.v2.key'), 'test-login-marker');
  process.env.DROIDEX_ALT_HOME = altHome;
  try {
    writeProviderConversation(h.home, 'alt-provider', 'Alt chat');
    h.fixture.seedHistorySummaries([
      { ...historicalSummary('alt-chat', 'alt-provider'), droidProfile: 'alt' },
    ]);
    const session = new FakeFactorySession('alt-provider', {}, h.calls);
    session.initResult = InitializeSessionResultSchema.parse({
      ...session.initResult,
      availableModels: [
        {
          id: 'alt-model',
          displayName: 'Alt model',
          shortDisplayName: 'Alt',
          modelProvider: 'factory',
          supportedReasoningEfforts: [],
          defaultReasoningEffort: 'medium',
        },
      ],
    });
    h.runtime.loadQueue.set('alt-provider', [session]);
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'alt-chat',
      modelId: 'alt-model',
    });
    assert.deepEqual(errorEvents(h.events), []);
    assert.equal(h.runtime.loadCalls[0]?.handlers.droidProfile, 'alt');
    assert.equal(session.settings[0]?.modelId, 'alt-model');

    const other = new FakeFactorySession('alt-provider', {}, h.calls);
    other.initResult = session.initResult;
    h.runtime.loadQueue.set('alt-provider', [other]);
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'alt-chat',
      modelId: 'main-only-model',
    });
    assert.match(errorEvents(h.events).at(-1)?.message ?? '', /Alt Factory account has no model/);
    assert.equal(other.settings.length, 0);
  } finally {
    if (previous === undefined) delete process.env.DROIDEX_ALT_HOME;
    else process.env.DROIDEX_ALT_HOME = previous;
    await h.dispose();
  }
});
