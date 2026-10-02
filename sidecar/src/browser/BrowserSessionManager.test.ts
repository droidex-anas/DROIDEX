import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BrowserSessionManager,
  type BrowserRuntime,
  type BrowserSessionManagerOptions,
} from './BrowserSessionManager.js';
import type {
  BrowserBox,
  BrowserElementRef,
  BrowserScreenshotOptions,
  BrowserState,
  BrowserViewport,
  DesignAnchor,
  DesignAnchorDetail,
} from './types.js';

const dataDir = mkdtempSync(join(tmpdir(), 'droid-browser-test-'));

function createManager(options: BrowserSessionManagerOptions = {}): BrowserSessionManager {
  return new BrowserSessionManager({
    browserDataDir: dataDir,
    runtimeFactory: (_id, viewport) => new FakeRuntime(viewport),
    ...options,
  });
}

class FakeRuntime implements BrowserRuntime {
  clicks: { x: number; y: number; selector?: string }[] = [];
  hovers: { x: number; y: number; selector?: string }[] = [];
  refs: BrowserElementRef[] = [buttonRef()];
  selections: { selector: string; value: string }[] = [];
  screenshots: BrowserScreenshotOptions[] = [];
  captures: (BrowserBox | undefined)[] = [];
  viewport: BrowserViewport;
  openedUrls: string[] = [];
  reloads = 0;
  history: ('back' | 'forward')[] = [];
  canGoBack = false;
  canGoForward = false;
  omitHistory = false;
  snapshotRequests = 0;
  clickError?: Error;
  viewportError?: Error;

  constructor(viewport: BrowserViewport) {
    this.viewport = viewport;
  }

  async open(url: string) {
    this.openedUrls.push(url);
    return this.stateSnapshot(url);
  }

  async reload() {
    this.reloads += 1;
    return this.stateSnapshot('https://example.com/reloaded');
  }

  async goBack() {
    this.history.push('back');
    return this.stateSnapshot('https://example.com/back');
  }

  async goForward() {
    this.history.push('forward');
    return this.stateSnapshot('https://example.com/forward');
  }

  async setViewport(viewport: BrowserViewport): Promise<void> {
    if (this.viewportError) throw this.viewportError;
    this.viewport = viewport;
  }

  async screenshot(options: BrowserScreenshotOptions = {}): Promise<string> {
    this.screenshots.push(options);
    return Buffer.from('full-screenshot').toString('base64');
  }

  async capture(box?: BrowserBox): Promise<string> {
    this.captures.push(box);
    return Buffer.from('crop').toString('base64');
  }

  async snapshot(url = 'http://127.0.0.1:1420/') {
    this.snapshotRequests += 1;
    return this.stateSnapshot(url);
  }

  private stateSnapshot(url = 'http://127.0.0.1:1420/') {
    return {
      url,
      title: 'Droid Control',
      scroll: { x: 0, y: 0 },
      refs: this.refs,
      ...(this.omitHistory ? {} : { canGoBack: this.canGoBack, canGoForward: this.canGoForward }),
    };
  }

  async click(x: number, y: number, selector?: string) {
    this.clicks.push({ x, y, selector });
    if (this.clickError) throw this.clickError;
    return this.stateSnapshot();
  }

  async hover(x: number, y: number, selector?: string) {
    this.hovers.push({ x, y, selector });
    return this.stateSnapshot();
  }

  async selectOption(selector: string, value: string) {
    this.selections.push({ selector, value });
    return this.stateSnapshot();
  }
  async type() {
    return this.stateSnapshot();
  }
  async keypress() {
    return this.stateSnapshot();
  }
  async scroll() {
    return this.stateSnapshot();
  }
  async inspect(selector: string) {
    const ref = this.refs.find((item) => item.selector === selector);
    if (!ref) throw new Error('Element not found');
    return {
      selector,
      tagName: ref.tagName,
      role: ref.role,
      name: ref.name,
      text: ref.text,
      attributes: ref.attributes ?? {},
      box: ref.box,
      html: '<button>Save</button>',
    };
  }
  async network() {
    return [];
  }
  async console() {
    return [];
  }
  async close(): Promise<void> {}
}

/** A manager with one page open in session m1, and the runtime behind it. */
async function opened(options: BrowserSessionManagerOptions = {}, url = 'http://127.0.0.1:1420/') {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
    ...options,
  });
  const state = await manager.open({ appSessionId: 'm1', url });
  return { manager, runtime, state };
}

function recordUpdates(updates: BrowserState[]): BrowserSessionManagerOptions['emit'] {
  return (event) => {
    if (event.type === 'browser.updated') updates.push(event.state);
  };
}

test('reload and history navigation adopt the runtime history state, and a new page without one clears it', async () => {
  const { manager, runtime } = await opened({}, 'https://example.com');
  runtime.canGoBack = true;
  runtime.canGoForward = true;
  const reloaded = await manager.reload('m1');
  assert.equal(runtime.reloads, 1);
  assert.equal(reloaded.url, 'https://example.com/reloaded');
  assert.equal(reloaded.canGoBack, true);
  assert.equal(reloaded.canGoForward, true);

  const back = await manager.goBack('m1');
  const forward = await manager.goForward('m1');
  assert.deepEqual(runtime.history, ['back', 'forward']);
  assert.equal(back.url, 'https://example.com/back');
  assert.equal(forward.url, 'https://example.com/forward');

  runtime.omitHistory = true;
  const second = await manager.open({ appSessionId: 'm1', url: 'https://example.com/second' });
  assert.equal(second.canGoBack, false);
  assert.equal(second.canGoForward, false);
});

test('actions by ref target the cached selector without a pre-action snapshot', async () => {
  const { manager, runtime } = await opened();
  await manager.click({ appSessionId: 'm1', ref: '@e1' });
  await manager.hover({ appSessionId: 'm1', ref: '@e1' });
  await manager.selectOption('m1', '@e1', 'active');
  const inspection = await manager.inspect('m1', { ref: '@e1' });

  assert.deepEqual(runtime.clicks, [{ x: 50, y: 35, selector: 'button' }]);
  assert.deepEqual(runtime.hovers, [{ x: 50, y: 35, selector: 'button' }]);
  assert.deepEqual(runtime.selections, [{ selector: 'button', value: 'active' }]);
  assert.equal(inspection.selector, 'button');
  assert.equal(inspection.html, '<button>Save</button>');
  assert.equal(runtime.snapshotRequests, 0);
});

test('click by missing ref fails without issuing a runtime action', async () => {
  const runtime = new FakeRuntime({ width: 1200, height: 800, deviceScaleFactor: 2 });
  runtime.refs = [];
  const manager = createManager({ runtimeFactory: () => runtime });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  await assert.rejects(
    manager.click({ appSessionId: 'm1', ref: '@e1' }),
    /Browser ref @e1 is not available/,
  );
  assert.deepEqual(runtime.clicks, []);
});

test('a failed resize keeps the viewport and emits nothing, and a resize clears refs without a snapshot', async () => {
  const updates: BrowserState[] = [];
  const { manager, runtime } = await opened({ emit: recordUpdates(updates) });
  const mobile = {
    appSessionId: 'm1',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
    viewportMode: 'mobile' as const,
  };
  const updateCount = updates.length;
  runtime.viewportError = new Error('resize failed');
  await assert.rejects(manager.resizeViewport(mobile), /resize failed/);
  assert.equal(updates.length, updateCount);
  assert.deepEqual(manager.state('m1')?.viewport, {
    width: 1200,
    height: 800,
    deviceScaleFactor: 2,
  });

  delete runtime.viewportError;
  const state = await manager.resizeViewport(mobile);
  assert.deepEqual(state.refs, []);
  assert.equal(runtime.snapshotRequests, 0);
});

test('only agent clicks move the visible agent cursor, even when the click fails', async () => {
  const updates: BrowserState[] = [];
  const { manager, runtime } = await opened({ emit: recordUpdates(updates) });

  const byUser = await manager.click({ appSessionId: 'm1', ref: '@e1', source: 'user' });
  assert.equal(byUser.agentCursor, undefined);
  const byAgent = await manager.click({ appSessionId: 'm1', ref: '@e1' });
  assert.deepEqual(byAgent.agentCursor, { x: 50, y: 35 });

  const updateCount = updates.length;
  runtime.clickError = new Error('click failed');
  await assert.rejects(manager.click({ appSessionId: 'm1', ref: '@e1' }), /click failed/);
  assert.equal(updates.length, updateCount + 1);
  assert.deepEqual(updates.at(-1)?.agentCursor, { x: 50, y: 35 });
});

test('addReference captures an anchor crop and current browser context, readable by id', async () => {
  const { manager, runtime } = await opened();
  const reference = await manager.addReference('m1', {
    anchor: buttonAnchor(),
    detail: buttonDetail(),
  });

  assert.equal(reference.url, 'http://127.0.0.1:1420/');
  assert.equal(reference.viewport.width, 1200);
  assert.equal(reference.anchor.id, reference.id);
  assert.ok(reference.anchor.screenshotPath, 'expected an auto-captured crop path');
  assert.deepEqual(runtime.captures.at(-1), buttonAnchor().box);
  const fetched = manager.referenceDetail('m1', reference.id);
  assert.equal(fetched?.detail?.selector, 'button');
  assert.equal(fetched?.detail?.id, reference.id);
});

test('designPrompt needs a reference and writes the selected ones with a trimmed instruction', async () => {
  let writtenInstruction = '';
  let writtenReferenceCount = 0;
  const { manager } = await opened({
    writePack: async (options) => {
      writtenInstruction = options.instruction;
      writtenReferenceCount = options.references.length;
      return {
        path: '/tmp/droid/pack.json',
        pack: {
          appSessionId: options.appSessionId,
          browserSessionId: options.browserSessionId,
          createdAt: '2026-06-07T00:00:00.000Z',
          instruction: options.instruction,
          references: options.references,
        },
      };
    },
  });
  await assert.rejects(
    () =>
      manager.designPrompt({
        appSessionId: 'm1',
        instruction: 'Make this clearer',
        referenceIds: [],
      }),
    /Select or sketch at least one browser reference/,
  );

  const reference = await manager.addReference('m1', { anchor: buttonAnchor() });
  const result = await manager.designPrompt({
    appSessionId: 'm1',
    instruction: '  Make the button clearer  ',
    referenceIds: [reference.id],
  });

  assert.equal(writtenInstruction, 'Make the button clearer');
  assert.equal(writtenReferenceCount, 1);
  assert.match(result.prompt, /Make the button clearer/);
});

test('screenshots are taken only on request, with the requested detail', async () => {
  const { manager, runtime } = await opened({}, 'https://example.com');
  await manager.refresh('m1');
  assert.equal(runtime.screenshots.length, 0);

  await manager.screenshot('m1', { fullPage: true, deviceScaleFactor: 3 });
  assert.deepEqual(runtime.screenshots, [{ fullPage: true, deviceScaleFactor: 3 }]);
});

test('open normalizes bare domains and resizes an existing runtime only when given a viewport', async () => {
  const { manager, runtime, state: first } = await opened({}, 'skeina.tech');
  // A bare domain is made loadable before the native runtime sees it.
  assert.equal(runtime.openedUrls[0], 'https://skeina.tech');
  assert.equal(first.url, 'https://skeina.tech');
  const custom = { width: 820, height: 620, deviceScaleFactor: 2 };
  await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com',
    viewport: { width: 524, height: 898, deviceScaleFactor: 2 },
    viewportMode: 'fit',
  });
  assert.deepEqual(runtime.viewport, { width: 524, height: 898, deviceScaleFactor: 2 });

  await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com',
    viewport: custom,
    viewportMode: 'custom',
  });
  // The agent omitting a viewport keeps the one in place.
  const state = await manager.open({ appSessionId: 'm1', url: 'https://example.org' });
  assert.deepEqual(runtime.viewport, custom);
  assert.deepEqual(state.viewport, custom);
  assert.equal(state.viewportMode, 'custom');
});

function buttonRef(): BrowserElementRef {
  return {
    ref: '@e1',
    selector: 'button',
    tagName: 'button',
    role: 'button',
    name: 'Save',
    text: 'Save',
    attributes: {},
    box: { x: 10, y: 20, width: 80, height: 30 },
    computedStyles: {},
  };
}

function buttonAnchor(): DesignAnchor {
  return {
    id: '@live-button',
    kind: 'element',
    label: 'Save',
    tag: 'button',
    role: 'button',
    name: 'Save',
    text: 'Save',
    box: { x: 10, y: 20, width: 80, height: 30 },
  };
}

function buttonDetail(): DesignAnchorDetail {
  return {
    id: '@live-button',
    selector: 'button',
    selectorVerified: true,
    attributes: {},
    styles: {},
    ancestors: [],
  };
}
