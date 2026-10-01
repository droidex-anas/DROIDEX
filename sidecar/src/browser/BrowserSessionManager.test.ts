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
  BrowserScreenshotOptions,
  BrowserState,
  BrowserTarget,
  BrowserViewport,
  DesignAnchor,
  DesignAnchorDetail,
  ScrollDirection,
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

  async capture(box?: BrowserBox): Promise<string> {
    this.captures.push(box);
    return Buffer.from('crop').toString('base64');
  }

  async snapshot(url = 'http://127.0.0.1:1420/') {
    this.snapshotRequests += 1;
    return this.stateSnapshot(url);
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
    if (this.clickError) throw this.clickError;
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
  async scroll(_direction: ScrollDirection | undefined) {
    return this.result();
  }
  async inspect(target: { ref: string } | { selector: string }) {
    this.inspections.push(target);
    return {
      selector: 'button',
      tagName: 'button',
      attributes: {},
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

test('runtime snapshots propagate navigation history state', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      runtime.canGoBack = true;
      return runtime;
    },
  });

  const { state: opened } = await manager.open({
    appSessionId: 'm1',
    url: 'http://127.0.0.1:1420/',
  });
  assert.equal(opened.canGoBack, true);
  assert.equal(opened.canGoForward, false);

  runtime.canGoForward = true;
  const { state: reloaded } = await manager.reload('m1');
  assert.equal(reloaded.canGoBack, true);
  assert.equal(reloaded.canGoForward, true);
});

test('opening a new page clears stale history when its snapshot omits navigation state', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      runtime.canGoBack = true;
      runtime.canGoForward = true;
      return runtime;
    },
  });

  await manager.open({ appSessionId: 'm1', url: 'https://example.com/first' });
  runtime.omitHistory = true;
  const { state: opened } = await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com/second',
  });

  assert.equal(opened.canGoBack, false);
  assert.equal(opened.canGoForward, false);
});

test('refs go straight to the page, which resolves them', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  await manager.click({ appSessionId: 'm1', ref: 'e1' });
  await manager.hover({ appSessionId: 'm1', ref: 'e1' });
  await manager.fill('m1', 'e1', 'active');
  await manager.inspect('m1', { ref: 'e1' });

  assert.deepEqual(runtime.clicks, [{ ref: 'e1' }]);
  assert.deepEqual(runtime.hovers, [{ ref: 'e1' }]);
  assert.deepEqual(runtime.selections, [{ ref: 'e1', value: 'active' }]);
  assert.deepEqual(runtime.inspections, [{ ref: 'e1' }]);
  assert.equal(runtime.snapshotRequests, 0);
});

test('resize requests no snapshot', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  const state = await manager.resizeViewport({
    appSessionId: 'm1',
    viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
    viewportMode: 'mobile',
  });

  assert.equal(state.viewportMode, 'mobile');
  assert.equal(runtime.snapshotRequests, 0);
});

test('failed resize preserves the previous viewport and emits no optimistic update', async () => {
  const updates: BrowserState[] = [];
  const runtime = new FakeRuntime({ width: 1200, height: 800, deviceScaleFactor: 2 });
  const manager = createManager({
    runtimeFactory: () => runtime,
    emit: (event) => {
      if (event.type === 'browser.updated') updates.push(event.state);
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });
  const updateCount = updates.length;
  runtime.viewportError = new Error('resize failed');

  await assert.rejects(
    manager.resizeViewport({
      appSessionId: 'm1',
      viewport: { width: 390, height: 844, deviceScaleFactor: 2 },
      viewportMode: 'mobile',
    }),
    /resize failed/,
  );

  assert.equal(updates.length, updateCount);
  assert.deepEqual(manager.state('m1')?.viewport, {
    width: 1200,
    height: 800,
    deviceScaleFactor: 2,
  });
});

test('agent click updates the visible agent cursor', async () => {
  const manager = createManager();
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  const { state: state } = await manager.click({ appSessionId: 'm1', x: 50, y: 35 });

  assert.deepEqual(state.agentCursor, { x: 50, y: 35 });
});

test('failed agent click still emits the attempted cursor position', async () => {
  const updates: BrowserState[] = [];
  const runtime = new FakeRuntime({ width: 1200, height: 800, deviceScaleFactor: 2 });
  const manager = createManager({
    runtimeFactory: () => runtime,
    emit: (event) => {
      if (event.type === 'browser.updated') updates.push(event.state);
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });
  const updateCount = updates.length;
  runtime.clickError = new Error('click failed');

  await assert.rejects(manager.click({ appSessionId: 'm1', x: 50, y: 35 }), /click failed/);

  assert.equal(updates.length, updateCount + 1);
  assert.deepEqual(updates.at(-1)?.agentCursor, { x: 50, y: 35 });
});

test('addReference captures an anchor crop and current browser context', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  const reference = await manager.addReference('m1', { anchor: buttonAnchor() });

  assert.equal(reference.url, 'http://127.0.0.1:1420/');
  assert.equal(reference.viewport.width, 1200);
  assert.equal(reference.anchor.id, reference.id);
  assert.ok(reference.anchor.screenshotPath, 'expected an auto-captured crop path');
  assert.deepEqual(runtime.captures.at(-1), buttonAnchor().box);
});

test('referenceDetail returns the stored reference with detail', async () => {
  const manager = createManager();
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  const reference = await manager.addReference('m1', {
    anchor: buttonAnchor(),
    detail: buttonDetail(),
  });
  const fetched = manager.referenceDetail('m1', reference.id);

  assert.equal(fetched?.detail?.selector, 'button');
  assert.equal(fetched?.detail?.id, reference.id);
});

test('designPrompt writes selected references and trims the instruction', async () => {
  let writtenInstruction = '';
  let writtenReferenceCount = 0;
  const manager = createManager({
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
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });
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

test('designPrompt requires a selected or sketched reference', async () => {
  const manager = createManager();
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  await assert.rejects(
    () =>
      manager.designPrompt({
        appSessionId: 'm1',
        instruction: 'Make this clearer',
        referenceIds: [],
      }),
    /Select or sketch at least one browser reference/,
  );
});

test('screenshot forwards its crop options', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'http://127.0.0.1:1420/' });

  await manager.screenshot('m1', { ref: 'e3', format: 'png' });

  assert.deepEqual(runtime.screenshots.at(-1), { ref: 'e3', format: 'png' });
});

test('open resizes an existing runtime before capture', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com',
    viewport: { width: 1200, height: 800, deviceScaleFactor: 2 },
  });

  const { state: state } = await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com',
    viewport: { width: 524, height: 898, deviceScaleFactor: 2 },
    viewportMode: 'fit',
  });

  assert.deepEqual(runtime.viewport, { width: 524, height: 898, deviceScaleFactor: 2 });
  assert.deepEqual(state.viewport, { width: 524, height: 898, deviceScaleFactor: 2 });
});

test('open preserves existing viewport when agent omits viewport', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({
    appSessionId: 'm1',
    url: 'https://example.com',
    viewport: { width: 820, height: 620, deviceScaleFactor: 2 },
    viewportMode: 'custom',
  });

  const { state: state } = await manager.open({ appSessionId: 'm1', url: 'https://example.org' });

  assert.deepEqual(runtime.viewport, { width: 820, height: 620, deviceScaleFactor: 2 });
  assert.deepEqual(state.viewport, { width: 820, height: 620, deviceScaleFactor: 2 });
  assert.equal(state.viewportMode, 'custom');
});

test('open normalizes bare domains before the native runtime sees them', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });

  const { state: state } = await manager.open({ appSessionId: 'm1', url: 'skeina.tech' });

  assert.equal(runtime.openedUrls[0], 'https://skeina.tech');
  assert.equal(state.url, 'https://skeina.tech');
});

test('reload updates the managed browser state from the runtime snapshot', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'https://example.com' });

  const { state: state } = await manager.reload('m1');

  assert.equal(runtime.reloads, 1);
  assert.equal(state.url, 'https://example.com/reloaded');
});

test('history navigation updates browser state through the runtime', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });
  await manager.open({ appSessionId: 'm1', url: 'https://example.com' });

  const { state: back } = await manager.goBack('m1');
  const { state: forward } = await manager.goForward('m1');

  assert.deepEqual(runtime.history, ['back', 'forward']);
  assert.equal(back.url, 'https://example.com/back');
  assert.equal(forward.url, 'https://example.com/forward');
});

test('open does not force screenshot capture', async () => {
  let runtime!: FakeRuntime;
  const manager = createManager({
    runtimeFactory: (_id, viewport) => {
      runtime = new FakeRuntime(viewport);
      return runtime;
    },
  });

  await manager.open({ appSessionId: 'm1', url: 'https://example.com' });

  assert.equal(runtime.screenshots.length, 0);
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
