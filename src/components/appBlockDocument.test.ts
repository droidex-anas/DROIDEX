import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createAppDocument } from './appBlockDocument';
import { DEFAULT_APP_THEME, type AppBlockTheme } from './appBlockRuntime';

interface DrawFrame {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
  pixelRatio: number;
  theme: AppBlockTheme;
}

function documentRuntime() {
  const events = new EventTarget();
  const timers = new Map<number, () => void>();
  const messages: unknown[] = [];
  const variables = new Map<string, string>();
  const observers: ResizeObserverFake[] = [];
  const transforms: number[][] = [];
  let timerId = 0;
  let restores = 0;
  class Canvas {
    width = 300;
    height = 150;
    clientWidth = 400;
    clientHeight = 200;
    style = { aspectRatio: '' };
    setAttribute() {}
    getContext() {
      return {
        setTransform: (...args: number[]) => transforms.push(args),
        save() {},
        restore() {
          restores++;
        },
      };
    }
  }
  class ResizeObserverFake {
    disconnected = false;
    targets: unknown[] = [];
    constructor(readonly callback: () => void) {
      observers.push(this);
    }
    observe(target: unknown) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  class MathElement {
    innerHTML = '';
    constructor(readonly latex = '') {}
    getAttribute(name: string) {
      return name === 'data-latex' ? this.latex : null;
    }
    hasAttribute() {
      return false;
    }
  }
  const mathElements: MathElement[] = [];
  const canvas = new Canvas();
  const body = { children: [], scrollHeight: 200 };
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const style = {
    colorScheme: '',
    setProperty: (key: string, value: string) => variables.set(key, value),
  };
  const window = {
    devicePixelRatio: 3,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    droidex: undefined as
      | {
          readonly theme: AppBlockTheme;
          renderMath: (element: MathElement, latex: string) => Promise<boolean>;
          createCanvas: (
            target: string | Canvas,
            draw: (frame: DrawFrame) => void,
          ) => { redraw: () => void; dispose: () => void };
        }
      | undefined,
  };
  const script = /<script>([\s\S]*?)<\/script>/.exec(
    createAppDocument('', 'app', DEFAULT_APP_THEME, 'token'),
  )?.[1];
  assert.ok(script);
  vm.runInNewContext(script, {
    window,
    parent,
    document: {
      documentElement: { style, scrollHeight: 360 },
      body,
      querySelector: (selector: string) => (selector === '#plot' ? canvas : null),
      querySelectorAll: (selector: string) => (selector === '[data-latex]' ? mathElements : []),
    },
    Element: MathElement,
    HTMLCanvasElement: Canvas,
    CustomEvent,
    CSS: { supports: (_property: string, value: string) => /^#[\da-f]{6}$/i.test(value) },
    getComputedStyle: () => ({
      aspectRatio: canvas.style.aspectRatio || 'auto ' + canvas.width + ' / ' + canvas.height,
      paddingLeft: '0px',
      paddingRight: '0px',
      paddingTop: '0px',
      paddingBottom: '0px',
    }),
    ResizeObserver: ResizeObserverFake,
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener,
    setTimeout: (callback: () => void) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  assert.ok(window.droidex);
  const api = window.droidex;
  const send = (data: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
    const event = new Event('message');
    Object.assign(event, { source: parent, data, ...overrides });
    events.dispatchEvent(event);
  };
  const sendTheme = (theme: unknown, overrides: Record<string, unknown> = {}) =>
    send(
      { type: 'droidex:theme-update', instanceId: 'app', bridgeToken: 'token', theme },
      overrides,
    );
  const heights = () =>
    messages.flatMap((message) =>
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === 'droidex:app-height' &&
      'height' in message
        ? [message.height]
        : [],
    );
  const flush = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  };
  return {
    api,
    body,
    MathElement,
    mathElements,
    canvas,
    events,
    window,
    timers,
    messages,
    variables,
    style,
    observers,
    transforms,
    send,
    sendTheme,
    flush,
    heights,
    restores: () => restores,
  };
}

test('only authenticated parent themes update CSS, the getter, and the change event', () => {
  const runtime = documentRuntime();
  const { api, events, sendTheme, variables, style } = runtime;
  const changes: unknown[] = [];
  events.addEventListener('droidex:themechange', (event) => {
    assert.ok(event instanceof CustomEvent);
    changes.push(event.detail);
  });
  assert.equal(api.theme.accent, DEFAULT_APP_THEME.accent);
  const theme = { ...DEFAULT_APP_THEME, colorScheme: 'light', accent: '#123456' };
  sendTheme(theme, { source: {} });
  sendTheme(theme, {
    data: { type: 'droidex:theme-update', instanceId: 'app', bridgeToken: 'wrong', theme },
  });
  sendTheme(theme, {
    data: { type: 'droidex:theme-update', instanceId: 'other', bridgeToken: 'token', theme },
  });
  sendTheme({ ...theme, accent: 'url(https://example.com)' });
  sendTheme({ ...theme, colorScheme: 'invalid' });
  assert.equal(changes.length, 0);
  assert.equal(variables.size, 0);

  sendTheme(theme);
  assert.equal(style.colorScheme, 'light');
  assert.equal(variables.get('--app-accent'), '#123456');
  assert.equal(variables.size, 6);
  assert.equal(api.theme.accent, '#123456');
  assert.equal(changes[0], api.theme);
  assert.ok(Object.isFrozen(api.theme));
  theme.accent = '#abcdef';
  assert.equal(api.theme.accent, '#123456');
});

test('Canvas draws immediately without animation frames and coalesces resize/theme redraws', () => {
  const runtime = documentRuntime();
  const frames: DrawFrame[] = [];
  const chart = runtime.api.createCanvas('#plot', (frame) => frames.push(frame));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].width, 400);
  assert.equal(frames[0].height, 200);
  assert.equal(frames[0].pixelRatio, 2);
  assert.equal(runtime.canvas.width, 800);
  assert.equal(runtime.canvas.height, 400);
  assert.equal(runtime.canvas.style.aspectRatio, '2');
  assert.deepEqual(runtime.transforms[0], [2, 0, 0, 2, 0, 0]);
  assert.equal(runtime.restores(), 1);

  runtime.canvas.clientWidth = 240;
  runtime.canvas.clientHeight = 120;
  runtime.observers[0].callback();
  runtime.observers[0].callback();
  runtime.sendTheme({ ...DEFAULT_APP_THEME, accent: '#123456' });
  assert.equal(runtime.timers.size, 1);
  runtime.flush();
  assert.equal(frames.length, 2);
  assert.equal(frames[1].width, 240);
  assert.equal(frames[1].theme.accent, '#123456');
  assert.equal(runtime.canvas.width, 480);
  assert.equal(runtime.canvas.style.aspectRatio, '2');
  chart.redraw();
  assert.equal(frames.length, 3);
});

test('dispose and pagehide cancel Canvas work and detach its observers and listeners', () => {
  for (const cleanup of ['dispose', 'pagehide']) {
    const runtime = documentRuntime();
    let draws = 0;
    const chart = runtime.api.createCanvas(runtime.canvas, () => draws++);
    runtime.observers[0].callback();
    assert.equal(runtime.timers.size, 1);
    if (cleanup === 'dispose') chart.dispose();
    else runtime.events.dispatchEvent(new Event('pagehide'));
    chart.dispose();
    chart.redraw();
    runtime.events.dispatchEvent(new Event('resize'));
    runtime.sendTheme({ ...DEFAULT_APP_THEME, accent: '#123456' });
    runtime.observers[0].callback();
    runtime.flush();
    assert.equal(draws, 1);
    assert.equal(runtime.timers.size, 0);
    assert.equal(runtime.observers[0].disconnected, true);
  }
});

test('Canvas preserves an authored CSS aspect ratio', () => {
  const runtime = documentRuntime();
  runtime.canvas.style.aspectRatio = '16 / 9';
  const chart = runtime.api.createCanvas('#plot', () => {});
  chart.redraw();
  assert.equal(runtime.canvas.style.aspectRatio, '16 / 9');
  chart.dispose();
});

test('a failed first Canvas draw restores the context and releases its resources', () => {
  const runtime = documentRuntime();
  assert.throws(
    () =>
      runtime.api.createCanvas('#plot', () => {
        throw new Error('draw failed');
      }),
    /draw failed/,
  );
  assert.equal(runtime.restores(), 1);
  assert.equal(runtime.observers[0].disconnected, true);
  runtime.events.dispatchEvent(new Event('resize'));
  assert.equal(runtime.timers.size, 0);
});

test('hidden document reports content height on a timer, shrinks with it, and stops on pagehide', async () => {
  const runtime = documentRuntime();
  runtime.events.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  await Promise.resolve();
  runtime.flush();
  // The body, not the viewport-filling root (360), is the content height.
  assert.deepEqual(runtime.heights(), [200]);

  // Measuring the root would ratchet: a shrinking App would keep its taller frame.
  runtime.body.scrollHeight = 90;
  runtime.observers[0].callback();
  runtime.flush();
  assert.deepEqual(runtime.heights(), [200, 90]);

  runtime.observers[0].callback();
  runtime.events.dispatchEvent(new Event('pagehide'));
  runtime.sendTheme({ ...DEFAULT_APP_THEME, accent: '#123456' });
  runtime.flush();
  assert.equal(runtime.api.theme.accent, DEFAULT_APP_THEME.accent);
  assert.equal(runtime.observers[0].disconnected, true);
  assert.equal(runtime.timers.size, 0);
});

test('a script failure is reported before the App can announce readiness', () => {
  const runtime = documentRuntime();
  const errors = () =>
    runtime.messages.filter(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'droidex:app-error',
    );

  runtime.events.dispatchEvent(
    Object.assign(new Event('error'), { message: 'Invalid or unexpected token' }),
  );
  runtime.events.dispatchEvent(
    Object.assign(new Event('unhandledrejection'), { reason: new Error('   ') }),
  );

  assert.deepEqual(JSON.parse(JSON.stringify(errors())), [
    {
      type: 'droidex:app-error',
      instanceId: 'app',
      bridgeToken: 'token',
      message: 'Invalid or unexpected token',
    },
    {
      type: 'droidex:app-error',
      instanceId: 'app',
      bridgeToken: 'token',
      message: 'The interactive App failed to start.',
    },
  ]);
});

test('early math waits for an authenticated host handshake, and repeated handshakes are answered', async () => {
  const runtime = documentRuntime();
  const element = new runtime.MathElement();
  const rendered = runtime.api.renderMath(element, 'x^2');
  await Promise.resolve();
  assert.deepEqual(runtime.messages, []);

  const handshake = { type: 'droidex:host-ready', instanceId: 'app', bridgeToken: 'token' };
  runtime.send({ ...handshake, bridgeToken: 'wrong' });
  await Promise.resolve();
  assert.deepEqual(runtime.messages, []);
  runtime.send(handshake);
  runtime.send(handshake);
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(runtime.messages)), [
    { type: 'droidex:app-ready', instanceId: 'app', bridgeToken: 'token' },
    { type: 'droidex:app-ready', instanceId: 'app', bridgeToken: 'token' },
    {
      type: 'droidex:render-math',
      instanceId: 'app',
      bridgeToken: 'token',
      requestId: 'app-math-1',
      latex: 'x^2',
      displayMode: false,
    },
  ]);
  runtime.send({
    type: 'droidex:math-rendered',
    instanceId: 'app',
    bridgeToken: 'token',
    requestId: 'app-math-1',
    html: '<math><msup><mi>x</mi><mn>2</mn></msup></math>',
  });
  assert.equal(await rendered, true);
  assert.match(element.innerHTML, /<math>/);
});

test('the first height report waits until built-in math has settled', async () => {
  const runtime = documentRuntime();
  runtime.mathElements.push(new runtime.MathElement('x^2'));

  runtime.events.dispatchEvent(new Event('DOMContentLoaded'));
  await Promise.resolve();
  // A resize before math settles must not publish the pre-math layout: the host
  // shows the App at its first reported height.
  runtime.observers[0].callback();
  runtime.flush();
  assert.deepEqual(runtime.heights(), []);

  runtime.body.scrollHeight = 600;
  runtime.send({
    type: 'droidex:math-rendered',
    instanceId: 'app',
    bridgeToken: 'token',
    requestId: 'app-math-1',
    html: '<math></math>',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  runtime.flush();
  assert.deepEqual(runtime.heights(), [600]);
});
