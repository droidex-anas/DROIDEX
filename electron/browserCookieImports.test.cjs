const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  COOKIE_IMPORT_FAILURE_TAG,
  createBrowserCookieImports,
  serializeCookieImportFailure,
} = require('./browserCookieImports.cjs');

const preview = Object.freeze({
  source: 'chrome',
  importMethod: 'profile',
  profileId: 'Default',
  profileLabel: 'Personal',
  importCount: 2,
  skippedCount: 0,
  replacementCount: 1,
  domainCount: 1,
  affectedDomains: Object.freeze(['example.com']),
  keychainApproved: true,
});

function fixture(response = 0, prepareErrorCode, overrides = {}) {
  const calls = [];
  const receipts = [];
  const timers = [];
  let latestReceipt = null;
  const plan = Object.freeze({ preview });
  const controller = createBrowserCookieImports({
    platform: 'darwin',
    getCookieStore: () => ({ get: async () => [], set: async () => undefined }),
    showPrompt: async () => ({ response }),
    snapshot:
      overrides.snapshot ??
      (async () => ({
        cookieCount: 2,
        ...(latestReceipt ? { lastCookieImport: latestReceipt } : {}),
      })),
    recordReceipt: async (receipt) => {
      receipts.push(receipt);
      latestReceipt = receipt;
      if (overrides.recordReceipt) return overrides.recordReceipt(receipt);
    },
    beforeCommit: overrides.beforeCommit ?? (() => {}),
    afterCommit: overrides.afterCommit ?? (async () => {}),
    releaseBrowsers: overrides.releaseBrowsers ?? (() => {}),
    now: overrides.now,
    nextPlanId: overrides.nextPlanId ?? (() => 'opaque-plan-1'),
    setTimeout: (callback, timeoutMs) => {
      const timer = { callback, timeoutMs };
      timers.push(timer);
      return timer;
    },
    clearTimeout: () => undefined,
    profileImport: {
      discoverBrowserCookieProfiles: async () => ({ chrome: { status: 'available' } }),
      createChromeProfileCookieImportPlan: async ({ profileId }) => {
        calls.push(`prepare:${profileId}`);
        if (overrides.prepare) return overrides.prepare();
        if (prepareErrorCode) {
          const error = new Error('private host detail');
          error.code = prepareErrorCode;
          throw error;
        }
        return plan;
      },
      commitChromeProfileCookieImport: async (candidate) => {
        assert.equal(candidate, plan);
        calls.push('commit');
        if (overrides.profileCommit) return overrides.profileCommit();
        return { ...preview, importedCount: 2, failedCount: 0 };
      },
      discardChromeProfileCookieImportPlan: (candidate) => {
        assert.equal(candidate, plan);
        calls.push('discard');
        return true;
      },
    },
  });
  return { calls, controller, receipts, timers, plan };
}

test('Chrome profile preparation requires app approval and returns only an opaque plan id', async () => {
  const denied = fixture(1);
  assert.deepEqual(await denied.controller.prepareProfile('Default'), { status: 'canceled' });
  assert.deepEqual(denied.calls, []);

  const approved = fixture(0);
  const result = await approved.controller.prepareProfile('Default');
  assert.deepEqual(result, { status: 'ready', planId: 'opaque-plan-1', preview });
  assert.equal(JSON.stringify(result).includes('cookie-value'), false);
});

test('Chrome preparation exposes only a sanitized recovery reason', async () => {
  const cases = [
    ['CHROME_KEYCHAIN_ACCESS_DENIED', 'keychain_denied'],
    ['CHROME_PROFILE_NOT_FOUND', 'profile_missing'],
    ['CHROME_COOKIE_SCHEMA_UNSUPPORTED', 'schema_unsupported'],
    ['CHROME_COOKIE_DATABASE_UNAVAILABLE', 'database_unavailable'],
    ['CHROME_PROFILE_HAS_NO_IMPORTABLE_COOKIES', 'no_importable_cookies'],
    ['CHROME_PROFILE_COOKIE_LIMIT_EXCEEDED', 'cookie_limit_exceeded'],
    ['UNEXPECTED_PRIVATE_FAILURE', 'database_unavailable'],
  ];

  for (const [hostCode, reason] of cases) {
    const { controller } = fixture(0, hostCode);
    assert.deepEqual(await controller.prepareProfile('Default'), { status: 'failed', reason });
  }
});

test('profile plans commit or discard exactly once through their opaque id', async () => {
  const { calls, controller, receipts } = fixture(0);
  await controller.prepareProfile('Default');
  const result = await controller.commitProfile('opaque-plan-1');
  assert.equal(result.importedCount, 2);
  assert.deepEqual(result.snapshot, { cookieCount: 2, lastCookieImport: receipts[0] });
  assert.deepEqual(receipts, [
    {
      source: 'chrome',
      importMethod: 'profile',
      profileLabel: 'Personal',
      importedCount: 2,
      replacementCount: 1,
      skippedCount: 0,
      failedCount: 0,
      domainCount: 1,
    },
  ]);
  assert.equal('affectedDomains' in receipts[0], false);
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
  assert.deepEqual(calls, ['prepare:Default', 'commit', 'discard']);

  const discarded = fixture(0);
  await discarded.controller.prepareProfile('Default');
  assert.equal(discarded.controller.discardProfile('opaque-plan-1'), true);
  assert.equal(discarded.controller.discardProfile('opaque-plan-1'), false);
  assert.deepEqual(discarded.calls, ['prepare:Default', 'discard']);
});

test('profile plans expire and discard decrypted cookie data', async () => {
  const { calls, controller, timers } = fixture(0);
  await controller.prepareProfile('Default');

  assert.equal(timers.length, 1);
  assert.equal(timers[0].timeoutMs, 120_000);
  timers[0].callback();

  assert.deepEqual(calls, ['prepare:Default', 'discard']);
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
});

test('partial profile commits return counts and a receipt so the UI can show the completed import', async () => {
  const partialResult = {
    ...preview,
    importedCount: 1,
    failedCount: 1,
  };
  const partialError = new Error('private failure details');
  partialError.code = 'BROWSER_PROFILE_COOKIE_IMPORT_PARTIAL';
  partialError.result = partialResult;
  const { controller, receipts } = fixture(0, undefined, {
    profileCommit: () => {
      throw partialError;
    },
  });
  await controller.prepareProfile('Default');

  const result = await controller.commitProfile('opaque-plan-1');
  assert.equal(result.importedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.snapshot.lastCookieImport, receipts[0]);
  assert.doesNotMatch(JSON.stringify(result), /private failure details/);
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
  assert.deepEqual(receipts, [
    {
      source: 'chrome',
      importMethod: 'profile',
      profileLabel: 'Personal',
      importedCount: 1,
      replacementCount: 1,
      skippedCount: 0,
      failedCount: 1,
      domainCount: 1,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(receipts), /example\.com|private failure details/);
});

test('cookie commits close live browser views before mutation and flush storage afterward', async () => {
  const calls = [];
  const { controller } = fixture(0, undefined, {
    beforeCommit: async () => calls.push('close'),
    profileCommit: () => {
      calls.push('write');
      return { ...preview, importedCount: 2, failedCount: 0 };
    },
    afterCommit: async () => calls.push('flush'),
  });
  await controller.prepareProfile('Default');
  await controller.commitProfile('opaque-plan-1');
  assert.deepEqual(calls, ['close', 'write', 'flush']);
});

test('a partial import still fails when its receipt cannot be saved', async () => {
  const partialError = Object.assign(new Error('private host error'), {
    code: 'BROWSER_PROFILE_COOKIE_IMPORT_PARTIAL',
    result: { ...preview, importedCount: 1, failedCount: 1 },
  });
  const { controller } = fixture(0, undefined, {
    profileCommit: () => {
      throw partialError;
    },
    recordReceipt: () => {
      throw new Error('private storage path');
    },
  });
  await controller.prepareProfile('Default');
  await assert.rejects(controller.commitProfile('opaque-plan-1'), (error) => {
    assert.equal(error.code, 'BROWSER_COOKIE_IMPORT_FINALIZE_FAILED');
    assert.equal(error.receiptPersistenceFailed, true);
    assert.equal(error.result.importedCount, 1);
    assert.doesNotMatch(error.message, /private/);
    return true;
  });
});

test('an import with no stored cookies remains a failure, not partial success', async () => {
  const error = Object.assign(new Error('Cookie import failed for 2 cookies.'), {
    code: 'BROWSER_PROFILE_COOKIE_IMPORT_FAILED',
    result: { ...preview, importedCount: 0, failedCount: 2 },
  });
  const { controller, receipts } = fixture(0, undefined, {
    profileCommit: () => {
      throw error;
    },
  });
  await controller.prepareProfile('Default');
  await assert.rejects(controller.commitProfile('opaque-plan-1'), error);
  assert.equal(receipts[0].importedCount, 0);
  assert.equal(receipts[0].failedCount, 2);
});

test('a profile lifecycle failure discards the taken plan before rethrowing', async () => {
  const lifecycleError = new Error('close failed');
  const { calls, controller } = fixture(0, undefined, {
    beforeCommit: async () => {
      throw lifecycleError;
    },
  });
  await controller.prepareProfile('Default');

  await assert.rejects(controller.commitProfile('opaque-plan-1'), lifecycleError);

  assert.deepEqual(calls, ['prepare:Default', 'discard']);
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
});

test('a profile setup failure discards the created plan before rethrowing', async () => {
  const setupError = new Error('plan id unavailable');
  const { calls, controller } = fixture(0, undefined, {
    nextPlanId: () => {
      throw setupError;
    },
  });

  await assert.rejects(controller.prepareProfile('Default'), setupError);

  assert.deepEqual(calls, ['prepare:Default', 'discard']);
});

test('a receipt persistence failure reports the completed import and still flushes storage', async () => {
  const lifecycle = [];
  const { controller } = fixture(0, undefined, {
    recordReceipt: async () => {
      lifecycle.push('receipt');
      throw new Error('private settings path');
    },
    afterCommit: async () => lifecycle.push('flush'),
  });
  await controller.prepareProfile('Default');

  let error;
  try {
    await controller.commitProfile('opaque-plan-1');
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'BROWSER_COOKIE_IMPORT_FINALIZE_FAILED');
  assert.equal(error?.result?.importedCount, 2);
  assert.equal(error?.result?.failedCount, 0);
  assert.equal(error?.receiptPersistenceFailed, true);
  assert.equal(error?.storageFlushFailed, false);
  assert.match(error?.message, /Cookies were imported/);
  assert.match(error?.message, /receipt could not be saved/);
  assert.doesNotMatch(error?.message, /private settings path/);
  assert.deepEqual(lifecycle, ['receipt', 'flush']);

  // The renderer only sees the rejection message, so the code and flags travel
  // in the serialized envelope instead of a matched sentence.
  const serialized = serializeCookieImportFailure(error);
  assert.ok(serialized.message.startsWith(COOKIE_IMPORT_FAILURE_TAG));
  assert.deepEqual(JSON.parse(serialized.message.slice(COOKIE_IMPORT_FAILURE_TAG.length)), {
    code: 'BROWSER_COOKIE_IMPORT_FINALIZE_FAILED',
    message: error.message,
    receiptPersistenceFailed: true,
    snapshotFailed: false,
    storageFlushFailed: false,
  });
});

test('a snapshot failure reports the completed import after receipt and storage flush', async () => {
  const lifecycle = [];
  const { controller } = fixture(0, undefined, {
    recordReceipt: async () => lifecycle.push('receipt'),
    afterCommit: async () => lifecycle.push('flush'),
    snapshot: async () => {
      lifecycle.push('snapshot');
      throw new Error('private snapshot detail');
    },
  });
  await controller.prepareProfile('Default');

  let error;
  try {
    await controller.commitProfile('opaque-plan-1');
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'BROWSER_COOKIE_IMPORT_FINALIZE_FAILED');
  assert.equal(error?.result?.importedCount, 2);
  assert.equal(error?.snapshotFailed, true);
  assert.match(error?.message, /Cookies were imported and recorded/);
  assert.match(error?.message, /Settings could not be refreshed/);
  assert.doesNotMatch(error?.message, /private snapshot detail/);
  assert.deepEqual(lifecycle, ['receipt', 'flush', 'snapshot']);
});

test('a committed import records its receipt once before a storage flush failure', async () => {
  const { controller, receipts } = fixture(0, undefined, {
    afterCommit: async () => {
      throw new Error('private flush detail');
    },
  });
  await controller.prepareProfile('Default');

  let error;
  try {
    await controller.commitProfile('opaque-plan-1');
  } catch (caught) {
    error = caught;
  }

  assert.equal(error?.code, 'BROWSER_COOKIE_IMPORT_FINALIZE_FAILED');
  assert.equal(error?.result?.importedCount, 2);
  assert.equal(error?.result?.failedCount, 0);
  assert.equal(error?.snapshot, undefined);
  assert.equal(receipts.length, 1);
  assert.doesNotMatch(error.message, /private flush detail/);
});

test('successful commits persist, flush, then build the authoritative IPC snapshot', async () => {
  const calls = [];
  const snapshot = { cookieCount: 2, lastCookieImport: { importedCount: 2 } };
  const { controller } = fixture(0, undefined, {
    afterCommit: async () => calls.push('flush'),
    recordReceipt: async () => calls.push('receipt'),
    snapshot: async () => {
      calls.push('snapshot');
      return snapshot;
    },
  });
  await controller.prepareProfile('Default');

  const result = await controller.commitProfile('opaque-plan-1');

  assert.deepEqual(calls, ['receipt', 'flush', 'snapshot']);
  assert.equal(result.snapshot, snapshot);
});

test('commit asks again with the preview and cancellation consumes the plan without writing', async () => {
  const prompts = [];
  // Preparation approval is separate from authorization to replace signed-in sessions.
  const cancelled = createBrowserCookieImports({
    getCookieStore: () => ({}),
    showPrompt: async (prompt, options) => {
      prompts.push({ prompt, options });
      return { response: prompts.length === 1 ? 0 : 1 };
    },
    profileImport: {
      createChromeProfileCookieImportPlan: async () => ({ preview }),
      discardChromeProfileCookieImportPlan: () => true,
      commitChromeProfileCookieImport: () => assert.fail('cancelled import wrote cookies'),
    },
    snapshot: () => ({}),
    releaseBrowsers: () => {},
  });
  const prepared = await cancelled.prepareProfile('Default');
  assert.equal((await cancelled.commitProfile(prepared.planId)).canceled, true);
  assert.equal(prompts[1].prompt.title, 'Import Personal cookies?');
  assert.match(prompts[1].prompt.message, /2 cookies for 1 domains/);
  assert.match(prompts[1].prompt.detail, /example.com.*1 existing cookie/);
  assert.ok(prompts.every(({ options }) => options.rendererOnly));
  await assert.rejects(cancelled.commitProfile(prepared.planId), /invalid or expired/);
});

test('teardown during Keychain preparation discards the late plan and blocks overlapping imports', async () => {
  const preparing = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { controller, calls, plan } = fixture(0, undefined, {
    prepare: () => {
      started.resolve();
      return preparing.promise;
    },
  });
  const pending = controller.prepareProfile('Default');
  const rejected = assert.rejects(pending, /renderer closed/);
  await started.promise;
  await assert.rejects(controller.prepareProfile('Profile 1'), /already in progress/);
  controller.cancelAll();
  preparing.resolve(plan);
  await rejected;
  assert.deepEqual(calls, ['prepare:Default', 'discard']);
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
});

test('teardown after page suspension prevents writes and releases the browser', async () => {
  const suspended = Promise.withResolvers();
  const release = Promise.withResolvers();
  let resumed = 0;
  const { controller, calls } = fixture(0, undefined, {
    beforeCommit: () => {
      suspended.resolve();
      return release.promise;
    },
    releaseBrowsers: () => resumed++,
  });
  await controller.prepareProfile('Default');
  const committing = controller.commitProfile('opaque-plan-1');
  const rejected = assert.rejects(committing, /renderer closed/);
  await suspended.promise;
  controller.cancelAll();
  release.resolve();
  await rejected;
  assert.deepEqual(calls, ['prepare:Default', 'discard']);
  assert.equal(resumed, 1);
});

test('elapsed plan deadlines reject commits even before their timer runs', async () => {
  let nowMs = 1_000;
  const { controller, calls } = fixture(0, undefined, { now: () => nowMs });
  await controller.prepareProfile('Default');
  nowMs += 120_000;
  await assert.rejects(controller.commitProfile('opaque-plan-1'), /invalid or expired/);
  assert.deepEqual(calls, ['prepare:Default', 'discard']);
});

test('renderer-selected Chrome exports require confirmation and report persisted counts', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-cookie-export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'cookies.json');
  await fs.writeFile(
    filePath,
    JSON.stringify([{ domain: 'example.com', name: 'session', value: 'fixture-secret' }]),
  );
  const writes = [];
  let approve = false;
  let receipt;
  const controller = createBrowserCookieImports({
    getCookieStore: () => ({ get: async () => [], set: async (cookie) => writes.push(cookie) }),
    showPrompt: async () => ({ response: approve ? 0 : 1 }),
    beforeCommit: () => {},
    afterCommit: async () => {},
    releaseBrowsers: () => {},
    recordReceipt: async (value) => {
      receipt = value;
    },
    snapshot: () => ({ lastCookieImport: receipt ?? null }),
  });
  assert.equal((await controller.importFile(filePath)).canceled, true);
  assert.deepEqual(writes, []);
  approve = true;
  const result = await controller.importFile(filePath);
  assert.equal(result.importedCount, 1);
  assert.equal(writes[0].value, 'fixture-secret');
  assert.equal(result.snapshot.lastCookieImport.importMethod, 'file');
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|"session"/);
});
