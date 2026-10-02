import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppBlock } from './AppBlock';
import { RunningAppFrame } from './AppBlockFrame';
import { AppBlockErrorFallback } from './AppBlockErrorFallback';
import {
  appBlockErrorFromMessage,
  appBlockHeightFromMessage,
  appBlockStartupTransition,
  appBlockMathRequestFromMessage,
  appColorScheme,
  createAppBridgeGuard,
  createAppBridgeSession,
  createAppHeightScheduler,
  hasAppBlock,
  hasCompleteAppBlock,
  normalizeAppBlockHeight,
  renderAppBlockMath,
} from './appBlockRuntime';
import { createAppDocument } from './appBlockDocument';

test('only a closed app fence is ready for automatic playback', () => {
  assert.equal(hasAppBlock('```app\n<main>Streaming'), true);
  assert.equal(hasAppBlock('```app\r\n<main>Streaming'), true);
  assert.equal(hasAppBlock('```application\nnope\n```'), false);
  assert.equal(hasCompleteAppBlock('```app\n<main>Streaming'), false);
  assert.equal(hasCompleteAppBlock('```app\n<main>Complete</main>\n```'), true);
  assert.equal(hasCompleteAppBlock('```app\r\n<main>Complete</main>\r\n```'), true);
  assert.equal(hasCompleteAppBlock('```application\nnope\n```'), false);
  assert.equal(hasAppBlock('````markdown\n```app\nexample\n```\n````'), false);
  assert.equal(hasCompleteAppBlock('````markdown\n```app\nexample\n```\n````'), false);
});

test('an App under construction or cut off offers no playback control or frame', () => {
  const building = renderToStaticMarkup(
    createElement(AppBlock, {
      source: '<main><script>const points = [',
      isBuilding: true,
    }),
  );
  assert.match(building, /role="status"/);
  assert.match(building, /Building interactive app/);
  assert.match(building, /shimmer-text/);

  const cutOff = renderToStaticMarkup(
    createElement(AppBlock, {
      source: '<main><script>const points = [',
      isCutOff: true,
    }),
  );
  assert.match(cutOff, /role="alert"/);
  assert.match(cutOff, /Saved history kept only part/);

  for (const html of [building, cutOff]) {
    assert.doesNotMatch(html, /aria-label="Play app"/);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, /const points/);
  }
});

test('the running document preserves layout, theme, and the local bridge', () => {
  const source =
    '<main><h1>Responsive app</h1></main><script>document.body.dataset.ready="yes"</script>';
  const document = createAppDocument(source, 'app-1', {
    colorScheme: 'light',
    background: '#f7f7f5',
    surface: '#ffffff',
    foreground: '#202020',
    muted: '#666666',
    border: '#dddddd',
    accent: '#2f6fed',
  });

  assert.match(document, /<meta name="viewport"/);
  assert.match(document, /droidex:app-height/);
  assert.match(document, /bridgeToken/);
  // The host hides the frame until it reports a height, and a hidden frame runs
  // no animation frames, so the report must not wait for one.
  assert.doesNotMatch(document, /requestAnimationFrame/);
  assert.match(document, /observer\.observe\(document\.body\)/);
  assert.match(document, /"app-1"/);
  assert.match(document, /color-scheme: light/);
  assert.match(document, /--app-background: #f7f7f5/);
  assert.match(document, /--app-foreground: #202020/);
  assert.match(document, /--app-accent: #2f6fed/);
  assert.match(document, /background: transparent/);
  assert.doesNotMatch(document, /background: var\(--app-background\) !important/);
  assert.doesNotMatch(document, /\[data-droidex-app-root\] \{[\s\S]*?\n {2}background:/);
  assert.match(document, /padding: 0/);
  assert.match(document, /\[data-droidex-app-root\]/);
  assert.match(document, /max-width: none !important/);
  assert.doesNotMatch(document, /\[data-droidex-app-root\] \{[^}]*border-radius:\s*0\s*!important/);
  assert.match(document, /window\.droidex/);
  assert.match(document, /\[data-latex\]/);
  assert.match(document, /droidex:render-math/);
  assert.match(document, /droidex:math-rendered/);
  assert.match(document, /<main><h1>Responsive app<\/h1><\/main>/);
});

test('external assets are restricted to approved font and component CDNs', () => {
  const document = createAppDocument('', 'app-policy');
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(document)?.[1];
  assert.ok(policy);
  const directives = Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );
  const componentCdns = ['https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com'];
  assert.deepEqual(directives, {
    'default-src': ["'none'"],
    'script-src': ["'unsafe-inline'", ...componentCdns],
    'style-src': ["'unsafe-inline'", 'https://fonts.googleapis.com', ...componentCdns],
    'font-src': ['data:', 'https://fonts.gstatic.com', ...componentCdns],
    'img-src': ['data:', 'blob:', ...componentCdns],
    'media-src': ['data:', 'blob:'],
    'connect-src': componentCdns,
    'worker-src': ["'none'"],
    'frame-src': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  });
});

test('reported app heights follow the app instead of creating a nested scroller', () => {
  assert.equal(normalizeAppBlockHeight(40), 40);
  assert.equal(normalizeAppBlockHeight(-1), 1);
  assert.equal(normalizeAppBlockHeight(141), 141);
  assert.equal(normalizeAppBlockHeight(412.2), 413);
  assert.equal(normalizeAppBlockHeight(4_000), 4_000);
  assert.equal(normalizeAppBlockHeight(20_000), 12_000);
  assert.equal(normalizeAppBlockHeight(Number.NaN), 360);
});

test('restored app blocks mount directly without a Play or Stop card', () => {
  const html = renderToStaticMarkup(
    createElement(RunningAppFrame, {
      source: '<button>Private source</button>',
      instanceId: 'app-1',
    }),
  );

  assert.match(html, /Interactive App/);
  assert.match(html, /<iframe/i);
  assert.doesNotMatch(html, /aria-label="(?:Play|Stop) app"/);
  // A mismatched iframe/document color scheme makes Chromium paint an opaque backdrop.
  assert.match(html, /color-scheme:dark/);
});

test('the running frame keeps app code inside a script-only sandbox', () => {
  const html = renderToStaticMarkup(
    createElement(RunningAppFrame, {
      source: '<button>Safe app</button>',
      instanceId: 'app-2',
    }),
  );

  assert.match(html, /<iframe/i);
  assert.match(html, /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin/);
  assert.match(html, /referrerPolicy="no-referrer"/i);
  assert.match(html, /title="Interactive App block"/);
  assert.doesNotMatch(html, /transition-\[height\]/);
});

test('a started App builds behind a status surface until it reports its size', () => {
  const html = renderToStaticMarkup(
    createElement(RunningAppFrame, {
      source: '<button>Slow app</button>',
      instanceId: 'app-build',
    }),
  );

  assert.match(html, /role="status"/);
  assert.match(html, /Starting interactive app/);
  // The frame still loads while hidden, and stays out of the reading and tab
  // order until it is revealed at its measured height.
  assert.match(html, /loading="eager"/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /tabindex="-1"/i);
  // Off-layout, so the hidden frame's default height cannot reserve space the
  // measured App will not use.
  assert.match(html, /invisible pointer-events-none absolute inset-x-0 top-0/);
});

test('height reports coalesce on a timer so a hidden host window still measures', () => {
  // Regression: the host applied measured heights on an animation frame, which
  // a hidden or minimized window never runs. The frame stays behind its build
  // surface until a height lands, so that report cannot depend on painting.
  const applied: number[] = [];
  const scheduler = createAppHeightScheduler((height) => applied.push(height));

  scheduler.schedule(400);
  scheduler.schedule(520);
  scheduler.schedule(610);
  assert.deepEqual(applied, [], 'a burst applies nothing synchronously');

  return new Promise<void>((resolve) => {
    setTimeout(() => {
      assert.deepEqual(applied, [610], 'a burst collapses into the newest height');

      scheduler.schedule(700);
      scheduler.cancel();
      setTimeout(() => {
        assert.deepEqual(applied, [610], 'a cancelled scheduler applies nothing');
        resolve();
      });
    });
  });
});

test('a script failure is reported before the App can announce readiness', () => {
  const document = createAppDocument(
    '<script>const broken = ;</script>',
    'app-error',
    undefined,
    'token',
  );
  const script = /<script>([\s\S]*?)<\/script>/.exec(document)?.[1];
  assert.ok(script);
  const listeners = new Map<string, (event: unknown) => void>();
  const messages: unknown[] = [];
  const parent = {
    postMessage(message: unknown) {
      messages.push(message);
    },
  };

  vm.runInNewContext(script, {
    parent,
    window: {},
    Element: class {},
    document: {},
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    ResizeObserver: class {},
    addEventListener(type: string, listener: (event: unknown) => void) {
      listeners.set(type, listener);
    },
    removeEventListener: () => undefined,
  });

  listeners.get('error')?.({ message: 'Invalid or unexpected token' });

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      type: 'droidex:app-error',
      instanceId: 'app-error',
      bridgeToken: 'token',
      message: 'Invalid or unexpected token',
    },
  ]);

  messages.length = 0;
  listeners.get('unhandledrejection')?.({ reason: new Error('   ') });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    {
      type: 'droidex:app-error',
      instanceId: 'app-error',
      bridgeToken: 'token',
      message: 'The interactive App failed to start.',
    },
  ]);
});

test('a working App is not torn down by a later interaction error', () => {
  const ready = appBlockStartupTransition(
    'waiting',
    {
      type: 'droidex:app-ready',
      instanceId: 'app-error',
      bridgeToken: 'token',
    },
    'app-error',
    'token',
  );
  assert.deepEqual(ready, { state: 'ready' });

  const afterInteractionError = appBlockStartupTransition(
    ready.state,
    {
      type: 'droidex:app-error',
      instanceId: 'app-error',
      bridgeToken: 'token',
      message: 'Click handler failed',
    },
    'app-error',
    'token',
  );
  assert.deepEqual(afterInteractionError, { state: 'ready' });
});

test('the host accepts bounded runtime errors only from the mounted App document', () => {
  assert.equal(
    appBlockErrorFromMessage(
      {
        type: 'droidex:app-error',
        instanceId: 'app-error',
        bridgeToken: 'token',
        message: 'Invalid or unexpected token',
      },
      'app-error',
      'token',
    ),
    'Invalid or unexpected token',
  );
  assert.equal(
    appBlockErrorFromMessage(
      {
        type: 'droidex:app-error',
        instanceId: 'app-error',
        bridgeToken: 'wrong',
        message: 'Invalid or unexpected token',
      },
      'app-error',
      'token',
    ),
    undefined,
  );
  assert.equal(
    appBlockErrorFromMessage(
      {
        type: 'droidex:app-error',
        instanceId: 'app-error',
        bridgeToken: 'token',
        message: 'x'.repeat(501),
      },
      'app-error',
      'token',
    ),
    undefined,
  );
});

test('a failed App renders a compact recovery surface instead of a blank canvas', () => {
  const html = renderToStaticMarkup(
    createElement(AppBlockErrorFallback, {
      message: 'Invalid or unexpected token',
      source: '<main></main>',
    }),
  );
  assert.match(html, /This visualization didn’t load/);
  assert.match(html, /Invalid or unexpected token/);
});

test('the host accepts height updates only for the mounted app instance', () => {
  assert.equal(
    appBlockHeightFromMessage(
      { type: 'droidex:app-height', instanceId: 'app-3', height: 420.4 },
      'app-3',
    ),
    421,
  );
  assert.equal(
    appBlockHeightFromMessage(
      { type: 'droidex:app-height', instanceId: 'other', height: 420 },
      'app-3',
    ),
    undefined,
  );
  assert.equal(
    appBlockHeightFromMessage({ type: 'other', instanceId: 'app-3', height: 420 }, 'app-3'),
    undefined,
  );
  assert.equal(appBlockHeightFromMessage(null, 'app-3'), undefined);
  // A message without the initial document token is rejected.
  assert.equal(
    appBlockHeightFromMessage(
      { type: 'droidex:app-height', instanceId: 'app-3', bridgeToken: 'wrong', height: 420 },
      'app-3',
      'expected',
    ),
    undefined,
  );
});

test('the App bridge bounds math work, deduplicates heights, and ignores a failed App', () => {
  const guard = createAppBridgeGuard(2, 1);
  assert.equal(guard.acceptHeight(400), true);
  assert.equal(guard.acceptHeight(400), false);
  assert.equal(guard.startMath(), true);
  assert.equal(guard.startMath(), false);
  guard.finishMath();
  assert.equal(guard.startMath(), true);
  guard.finishMath();
  assert.equal(guard.startMath(), false);

  // A failed App cannot resize the chat after its recovery surface is selected.
  const failed = createAppBridgeGuard();
  failed.fail();
  assert.equal(failed.acceptHeight(1_366), false);
});

test('each iframe document gets an independent bridge token and work budget', () => {
  const first = createAppBridgeSession();
  const second = createAppBridgeSession();
  assert.notEqual(first.token, second.token);
  assert.equal(first.guard.startMath(), true);
  assert.equal(first.guard.startMath(), true);
  assert.equal(first.guard.startMath(), false);
  assert.equal(second.guard.startMath(), true);
});

test('the iframe queues early math behind readiness and authenticates repeated handshakes', async () => {
  const document = createAppDocument('<main>Ready</main>', 'app-ready', undefined, 'token');
  const script = /<script>([\s\S]*?)<\/script>/.exec(document)?.[1];
  assert.ok(script);
  const listeners = new Map<string, (event: { source: object; data: unknown }) => void>();
  const messages: unknown[] = [];
  const parent = {
    postMessage(message: unknown) {
      messages.push(message);
    },
  };
  class MathElement {
    innerHTML = '';
    hasAttribute() {
      return false;
    }
  }
  const window: {
    droidex?: { renderMath: (element: MathElement, latex: string) => Promise<boolean> };
  } = {};

  vm.runInNewContext(script, {
    parent,
    window,
    Element: MathElement,
    document: {},
    setTimeout: () => 1,
    clearTimeout: () => undefined,
    ResizeObserver: class {},
    addEventListener(type: string, listener: (event: { source: object; data: unknown }) => void) {
      listeners.set(type, listener);
    },
    removeEventListener: () => undefined,
  });

  const onMessage = listeners.get('message');
  assert.ok(onMessage);
  assert.ok(window.droidex);
  const element = new MathElement();
  const rendered = window.droidex.renderMath(element, 'x^2');
  await Promise.resolve();
  assert.deepEqual(messages, []);
  const handshake = {
    source: parent,
    data: {
      type: 'droidex:host-ready',
      instanceId: 'app-ready',
      bridgeToken: 'token',
    },
  };
  onMessage({
    ...handshake,
    data: { ...handshake.data, bridgeToken: 'wrong' },
  });
  await Promise.resolve();
  assert.deepEqual(messages, []);
  onMessage(handshake);
  onMessage(handshake);
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [
    { type: 'droidex:app-ready', instanceId: 'app-ready', bridgeToken: 'token' },
    { type: 'droidex:app-ready', instanceId: 'app-ready', bridgeToken: 'token' },
    {
      type: 'droidex:render-math',
      instanceId: 'app-ready',
      bridgeToken: 'token',
      requestId: 'app-ready-math-1',
      latex: 'x^2',
      displayMode: false,
    },
  ]);
  onMessage({
    source: parent,
    data: {
      type: 'droidex:math-rendered',
      instanceId: 'app-ready',
      bridgeToken: 'token',
      requestId: 'app-ready-math-1',
      html: '<math><msup><mi>x</mi><mn>2</mn></msup></math>',
    },
  });
  assert.equal(await rendered, true);
  assert.match(element.innerHTML, /<math>/);
});

test('the iframe reports its initial height only after built-in math settles', async () => {
  const documentHtml = createAppDocument(
    '<main><span data-latex="x^2">x²</span></main>',
    'app-math-height',
    undefined,
    'token',
  );
  const script = /<script>([\s\S]*?)<\/script>/.exec(documentHtml)?.[1];
  assert.ok(script);

  class TestElement {
    innerHTML = '';
    textContent = '';
    tagName = 'SPAN';
    children: TestElement[] = [];
    scrollHeight = 500;

    getAttribute(name: string) {
      return name === 'data-latex' ? 'x^2' : null;
    }
    hasAttribute() {
      return false;
    }
    matches() {
      return false;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    setAttribute() {}
  }

  const mathElement = new TestElement();
  const body = new TestElement();
  body.tagName = 'BODY';
  const documentElement = { scrollHeight: 500 };
  const runtimeDocument = {
    body,
    documentElement,
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === '[data-latex]' ? [mathElement] : []),
  };
  const listeners = new Map<string, (event?: { source?: object; data?: unknown }) => void>();
  const messages: Record<string, unknown>[] = [];
  const pendingReports: (() => void)[] = [];
  let observerCallback: (() => void) | undefined;
  const parent = {
    postMessage(message: Record<string, unknown>) {
      messages.push(message);
    },
  };

  vm.runInNewContext(script, {
    parent,
    window: {},
    Element: TestElement,
    document: runtimeDocument,
    setTimeout(callback: () => void) {
      pendingReports.push(callback);
      return pendingReports.length;
    },
    clearTimeout: () => undefined,
    ResizeObserver: class {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
    addEventListener(
      type: string,
      listener: (event?: { source?: object; data?: unknown }) => void,
    ) {
      listeners.set(type, listener);
    },
    removeEventListener: () => undefined,
  });

  listeners.get('DOMContentLoaded')?.();
  await Promise.resolve();
  assert.ok(observerCallback);
  // A resize before math settles must not publish the pre-math layout: the host
  // shows the App at its first reported height.
  observerCallback();
  while (pendingReports.length > 0) pendingReports.shift()?.();
  assert.equal(
    messages.some((message) => message.type === 'droidex:app-height'),
    false,
  );

  body.scrollHeight = 600;
  documentElement.scrollHeight = 600;
  listeners.get('message')?.({
    source: parent,
    data: {
      type: 'droidex:math-rendered',
      instanceId: 'app-math-height',
      bridgeToken: 'token',
      requestId: 'app-math-height-math-1',
      html: '<math></math>',
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  while (pendingReports.length > 0) pendingReports.shift()?.();

  assert.deepEqual(
    JSON.parse(JSON.stringify(messages.filter((message) => message.type === 'droidex:app-height'))),
    [
      {
        type: 'droidex:app-height',
        instanceId: 'app-math-height',
        bridgeToken: 'token',
        height: 600,
      },
    ],
  );
});

test('the iframe measures its content so the frame can shrink with it', async () => {
  const documentHtml = createAppDocument('<main>Compact</main>', 'app-shrink', undefined, 'token');
  const script = /<script>([\s\S]*?)<\/script>/.exec(documentHtml)?.[1];
  assert.ok(script);

  // The root element always fills the frame viewport, so its scrollHeight never
  // drops below the height the host already applied. Measuring it turns every
  // report into a ratchet: compact content is padded out to the frame it was
  // given, and an App that shrinks keeps its taller frame forever.
  const body = {
    tagName: 'BODY',
    scrollHeight: 141,
    children: [] as never[],
    matches: () => false,
  };
  const documentElement = { scrollHeight: 360 };
  const runtimeDocument = {
    body,
    documentElement,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const listeners = new Map<string, () => void>();
  const heights: number[] = [];
  const pendingReports: (() => void)[] = [];
  let observerCallback: (() => void) | undefined;

  vm.runInNewContext(script, {
    parent: {
      postMessage(message: Record<string, unknown>) {
        if (message.type === 'droidex:app-height') heights.push(message.height as number);
      },
    },
    window: {},
    Element: class {},
    document: runtimeDocument,
    setTimeout(callback: () => void) {
      pendingReports.push(callback);
      return pendingReports.length;
    },
    clearTimeout: () => undefined,
    ResizeObserver: class {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, listener);
    },
    removeEventListener: () => undefined,
  });

  const flushReports = () => {
    observerCallback?.();
    while (pendingReports.length > 0) pendingReports.shift()?.();
  };

  listeners.get('DOMContentLoaded')?.();
  // The first report waits for built-in math to settle, one microtask away.
  await Promise.resolve();
  await Promise.resolve();
  flushReports();
  assert.deepEqual(heights, [141]);

  body.scrollHeight = 90;
  documentElement.scrollHeight = 141;
  flushReports();
  assert.deepEqual(heights, [141, 90]);
});

test('short and functional CSS colors select the correct canvas scheme', () => {
  assert.equal(appColorScheme('#fff'), 'light');
  assert.equal(appColorScheme('rgb(250, 250, 250)'), 'light');
  assert.equal(appColorScheme('hsl(0, 0%, 5%)'), 'dark');
  assert.equal(appColorScheme('#111111ff'), 'dark');
});

test('the math bridge accepts only bounded requests for the mounted App', () => {
  assert.deepEqual(
    appBlockMathRequestFromMessage(
      {
        type: 'droidex:render-math',
        instanceId: 'app-4',
        requestId: 'math-1',
        latex: String.raw`y = \beta_0 + \beta_1 x`,
        displayMode: true,
      },
      'app-4',
    ),
    {
      requestId: 'math-1',
      latex: String.raw`y = \beta_0 + \beta_1 x`,
      displayMode: true,
    },
  );
  assert.equal(
    appBlockMathRequestFromMessage(
      {
        type: 'droidex:render-math',
        instanceId: 'other',
        requestId: 'math-1',
        latex: 'x',
        displayMode: false,
      },
      'app-4',
    ),
    undefined,
  );
  assert.equal(
    appBlockMathRequestFromMessage(
      {
        type: 'droidex:render-math',
        instanceId: 'app-4',
        requestId: 'math-1',
        latex: 'x'.repeat(20_001),
        displayMode: false,
      },
      'app-4',
    ),
    undefined,
  );
  assert.equal(
    appBlockMathRequestFromMessage(
      {
        type: 'droidex:render-math',
        instanceId: 'app-4',
        bridgeToken: 'wrong',
        requestId: 'math-1',
        latex: 'x',
        displayMode: false,
      },
      'app-4',
      'expected',
    ),
    undefined,
  );
});

test('the local math renderer produces native MathML without iframe network access', async () => {
  const html = await renderAppBlockMath({
    requestId: 'math-2',
    latex: String.raw`\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`,
    displayMode: true,
  });

  assert.match(html, /<math/);
  assert.match(html, /display="block"/);
  assert.match(html, /<mfrac>/);
  assert.doesNotMatch(html, /<script/i);
});
