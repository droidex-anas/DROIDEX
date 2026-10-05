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
  BrowserScreenshotOptions,
  BrowserState,
  BrowserTarget,
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
  clicks: BrowserTarget[] = [];
  hovers: BrowserTarget[] = [];
  selections: { ref: string; value: string }[] = [];
  inspections: ({ ref: string } | { selector: string })[] = [];
  screenshots: BrowserScreenshotOptions[] = [];
  viewport: BrowserViewport;
  openedUrls: string[] = [];
  reloads = 0;
  history: ('back' | 'forward')[] = [];
  canGoBack = false;
  canGoForward = false;
  omitHistory = false;
  viewportError?: Error;

  constructor(viewport: BrowserViewport) {
    this.viewport = viewport;
  }

  async open(url: string) {
    this.openedUrls.push(url);
    return this.result(url);
  }

  async reload() {
    this.reloads += 1;
    return this.result('https://example.com/reloaded');
  }

  async goBack() {
    this.history.push('back');
    return this.result('https://example.com/back');
  }

  async goForward() {
    this.history.push('forward');
    return this.result('https://example.com/forward');
  }

  async setViewport(viewport: BrowserViewport): Promise<void> {
    if (this.viewportError) throw this.viewportError;
    this.viewport = viewport;
  }

  async screenshot(options: BrowserScreenshotOptions = {}) {
    this.screenshots.push(options);
    return {
      image: Buffer.from('screenshot').toString('base64'),
      mimeType: 'image/jpeg' as const,
      text: 'Screenshot of the viewport',
    };
  }

  async readText() {
    return '# Page';
  }

  async wait() {
    return this.result();
  }

  async setColorScheme() {}

  async evaluate() {
    return this.result('https://example.com/');
  }

  async awaitViewport() {
    return this.result();
  }

  private result(url?: string) {
    return { snapshot: this.stateSnapshot(url), text: '[Droid Control · page]' };
  }

  private stateSnapshot(url = 'http://127.0.0.1:1420/') {
    return {
      url,
      title: 'Droid Control',
      scroll: { x: 0, y: 0 },
      ...(this.omitHistory ? {} : { canGoBack: this.canGoBack, canGoForward: this.canGoForward }),
    };
  }

  async readPage() {
    return '- button "Save" [ref=e1]';
  }

  async find() {
    return { text: '- button "Save" [ref=e1]', matches: 1 };
  }

  async click(target: BrowserTarget) {
    this.clicks.push(target);
    return this.result();
  }

  async hover(target: BrowserTarget) {
    this.hovers.push(target);
    return this.result();
  }

  async fill(ref: string, value: string) {
    this.selections.push({ ref, value });
    return this.result();
  }
  async type() {
    return this.result();
  }
  async press() {
    return this.result();
  }
  async scroll() {
    return this.result();
  }
  async inspect(target: { ref: string } | { selector: string }) {
    this.inspections.push(target);
    return {
      selector: 'button',
      tagName: 'button',
      attributes: {},
      styles: {},
      box: { x: 10, y: 20, width: 80, height: 30 },
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
  const { state } = await manager.open({ appSessionId: 'm1', url });
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
  const { state: reloaded } = await manager.reload('m1');
  assert.equal(runtime.reloads, 1);
  assert.equal(reloaded.url, 'https://example.com/reloaded');
  assert.equal(reloaded.canGoBack, true);
  assert.equal(reloaded.canGoForward, true);

  const { state: back } = await manager.goBack('m1');
  const { state: forward } = await manager.goForward('m1');
  assert.deepEqual(runtime.history, ['back', 'forward']);
  assert.equal(back.url, 'https://example.com/back');
  assert.equal(forward.url, 'https://example.com/forward');

  runtime.omitHistory = true;
  const { state: second } = await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com/second',
  });
  assert.equal(second.canGoBack, false);
  assert.equal(second.canGoForward, false);
});

test('refs go straight to the page, which resolves them', async () => {
  const { manager, runtime } = await opened();
  await manager.click({ appSessionId: 'm1', ref: 'e1' });
  await manager.hover({ appSessionId: 'm1', ref: 'e1' });
  await manager.fill('m1', 'e1', 'active');
  await manager.inspect('m1', { ref: 'e1' });

  assert.deepEqual(runtime.clicks, [{ ref: 'e1' }]);
  assert.deepEqual(runtime.hovers, [{ ref: 'e1' }]);
  assert.deepEqual(runtime.selections, [{ ref: 'e1', value: 'active' }]);
  assert.deepEqual(runtime.inspections, [{ ref: 'e1' }]);
});

test('a failed resize keeps the viewport and emits nothing, and a resize records the viewport mode', async () => {
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
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
  });

  delete runtime.viewportError;
  const state = await manager.resizeViewport(mobile);
  assert.equal(state.viewportMode, 'mobile');
});

test('addReference saves the crop the app took and the current browser context, readable by id', async () => {
  const { manager } = await opened();
  const reference = await manager.addReference(
    'm1',
    { anchor: buttonAnchor(), detail: buttonDetail() },
    { base64: Buffer.from('crop').toString('base64'), box: buttonAnchor().box! },
  );

  assert.equal(reference.url, 'http://127.0.0.1:1420/');
  assert.equal(reference.viewport.width, 1440);
  assert.equal(reference.anchor.id, reference.id);
  assert.ok(reference.anchor.screenshotPath, 'expected the crop to be saved');
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
        references: [],
      }),
    /Select or sketch at least one browser reference/,
  );

  // A pick that reaches the sidecar only with its prompt goes from the prompt's
  // own copy, without becoming a live mark.
  const result = await manager.designPrompt({
    appSessionId: 'm1',
    instruction: '  Make the button clearer  ',
    references: [{ id: 'pick-1', anchor: buttonAnchor(), url: 'http://127.0.0.1:1420/' }],
  });

  assert.equal(writtenInstruction, 'Make the button clearer');
  assert.equal(writtenReferenceCount, 1);
  assert.match(result.prompt, /Make the button clearer/);
  assert.match(result.prompt, /pick-1/);
  assert.equal(manager.referenceDetail('m1', 'pick-1'), undefined);
});

test('screenshots are taken only on request, with the requested crop', async () => {
  const { manager, runtime } = await opened({}, 'https://example.com');
  assert.equal(runtime.screenshots.length, 0);

  await manager.screenshot('m1', { ref: 'e3', format: 'png' });
  assert.deepEqual(runtime.screenshots, [{ ref: 'e3', format: 'png' }]);
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
    viewportMode: 'tablet',
  });
  // The agent omitting a viewport keeps the one in place.
  const { state } = await manager.open({ appSessionId: 'm1', url: 'https://example.org' });
  assert.deepEqual(runtime.viewport, custom);
  assert.deepEqual(state.viewport, custom);
  assert.equal(state.viewportMode, 'tablet');
});

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

test('restore takes up a kept browser under its id and page, and leaves an open one alone', async () => {
  const updates: BrowserState[] = [];
  const runtimes = new Map<string, FakeRuntime>();
  const manager = createManager({
    emit: recordUpdates(updates),
    runtimeFactory: (id, viewport) => {
      const runtime = new FakeRuntime(viewport);
      runtimes.set(id, runtime);
      return runtime;
    },
  });
  const { state: open } = await manager.open({ appSessionId: 'm1', url: 'https://example.com' });
  const updateCount = updates.length;
  const viewport = { width: 900, height: 700, deviceScaleFactor: 2 };

  manager.restore([
    {
      appSessionId: 'm1',
      browserSessionId: 'kept-1',
      url: 'https://old.example',
      viewport,
      viewportMode: 'fit',
    },
    {
      appSessionId: 'm2',
      browserSessionId: 'kept-2',
      url: 'https://kept.example/',
      viewport,
      viewportMode: 'tablet',
    },
  ]);

  assert.deepEqual(manager.state('m1'), open);
  assert.equal(manager.state('m2')?.browserSessionId, 'kept-2');
  assert.equal(manager.state('m2')?.url, 'https://kept.example/');
  assert.equal(manager.state('m2')?.viewportMode, 'tablet');
  assert.deepEqual(runtimes.get('kept-2')?.openedUrls, []);
  assert.equal(updates.length, updateCount);
  await manager.reload('m2');
  assert.equal(runtimes.get('kept-2')?.reloads, 1);

  const closing = manager.close('m2');
  manager.restore([
    {
      appSessionId: 'm2',
      browserSessionId: 'kept-2',
      url: 'https://kept.example/',
      viewport,
      viewportMode: 'tablet',
    },
  ]);
  await closing;
  assert.equal(manager.hasSession('m2'), false);
});
