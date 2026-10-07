const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createBrowserActions } = require('./browserActions.cjs');
const { createBrowserReading } = require('./browserReading.cjs');
const { refFor } = require('./browserRefs.cjs');

function fixture() {
  const fields = new Map();
  const document = { defaultView: {}, activeElement: null };
  class Element {
    constructor(tag, attributes = {}) {
      this.localName = tag;
      this.attributes = attributes;
      this.type = attributes.type || 'text';
      this.textContent = '';
      this.value = '';
      this.isConnected = true;
      this.id = fields.size + 1;
      fields.set(this.id, this);
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    getRootNode() {
      return document;
    }
    matches(selector) {
      return selector.split(',').some((part) => {
        const tag = /^[a-z]+/.exec(part)?.[0];
        const attribute = /\[([^=]+)="([^"]+)"\]/.exec(part);
        return (
          (tag ? this.localName === tag : Boolean(attribute)) &&
          (!attribute || this.getAttribute(attribute[1]) === attribute[2])
        );
      });
    }
    closest(selector) {
      if (this.matches(selector)) return this;
      if (selector === 'form') return this.form || null;
      return null;
    }
    focus() {
      document.activeElement = this;
      this.onFocus?.();
    }
    dispatchEvent() {}
  }
  class Input extends Element {
    constructor(attributes) {
      super('input', attributes);
    }
    set value(value) {
      this.entered = value;
    }
    get value() {
      return this.entered;
    }
  }
  const frame = { id: 'frame', loaderId: 'document', url: 'https://example.test/login' };
  const entry = { documents: 1, errorTimes: [], networkEvents: [], consoleEvents: [] };
  const input = [];
  const prompts = [];
  let hit;
  let answer = async () => ({ response: 1 });
  const context = {
    HTMLInputElement: Input,
    HTMLTextAreaElement: class {},
    HTMLSelectElement: class {},
    Event: class {},
    document,
  };
  const dbg = new EventEmitter();
  dbg.sendCommand = async (method, params = {}) => {
    if (['Target.setAutoAttach', 'Runtime.releaseObject'].includes(method)) return {};
    if (method === 'Page.getFrameTree') return { frameTree: { frame } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 2 };
    if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { pageX: 0, pageY: 0 } };
    if (method === 'DOM.getNodeForLocation') return { backendNodeId: hit.id, frameId: frame.id };
    if (method === 'DOM.focus') {
      fields.get(params.backendNodeId).focus();
      return {};
    }
    if (method === 'DOM.resolveNode') return { object: { objectId: String(params.backendNodeId) } };
    if (method === 'DOM.describeNode') {
      const id = Number(params.objectId || params.backendNodeId);
      return { node: { backendNodeId: id, localName: fields.get(id).localName } };
    }
    if (method === 'Runtime.evaluate' && params.expression === 'document')
      return { result: { objectId: 'document' } };
    if (method === 'Runtime.callFunctionOn') {
      const target =
        params.objectId === 'document' ? document : fields.get(Number(params.objectId));
      try {
        const fn = vm.runInNewContext(`(${params.functionDeclaration})`, context);
        const value = fn.apply(
          target,
          (params.arguments || []).map((arg) => arg.value),
        );
        return {
          result:
            value instanceof Element && !params.returnByValue
              ? { objectId: String(value.id) }
              : { value },
        };
      } catch (error) {
        return { exceptionDetails: { exception: { description: error.message } } };
      }
    }
    if (method.startsWith('Input.')) {
      input.push({ method, ...params });
      return {};
    }
    throw new Error(`Unexpected CDP command ${method}`);
  };
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => frame.url,
    getTitle: () => 'Test',
    isDestroyed: () => false,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  });
  entry.contents = contents;
  const runWithWebContentsDebugger = (_contents, run) => run(dbg, () => true);
  const reading = createBrowserReading({
    runWithWebContentsDebugger,
    savedSecretsFor: async () => [],
    redactUrl: (value) => value,
  });
  const actions = createBrowserActions({
    reading,
    runWithWebContentsDebugger,
    credentials: {},
    showPrompt: async (prompt, options) => {
      prompts.push(prompt);
      return answer(prompt, options);
    },
    unthrottled: (_contents, run) => run(),
    redactUrl: (value) => value,
    onPoint: () => {},
  });
  const request = new AbortController();
  const act = (action) =>
    actions.act(contents, entry, {
      requestId: 'request',
      startBy: Date.now() + 10_000,
      runEnded: () => false,
      signal: request.signal,
      ...action,
    });
  function field(attributes) {
    const node = new Input(attributes);
    node.focus();
    return { node, ref: refFor(entry, frame.loaderId, node.id) };
  }
  function button(label, formFields = []) {
    hit = new Element('button');
    hit.textContent = label;
    hit.form = { elements: formFields, action: 'https://example.test/submit', textContent: label };
    return hit;
  }
  return {
    field,
    button,
    act,
    input,
    prompts,
    entry,
    contents,
    request,
    answer: (fn) => {
      answer = fn;
    },
  };
}

test('type, fill and key input refuse password, code and card fields without writing', async () => {
  for (const attributes of [
    { type: 'password' },
    { autocomplete: 'one-time-code' },
    { autocomplete: 'cc-number' },
  ]) {
    const f = fixture();
    const { node, ref } = f.field(attributes);
    for (const action of [
      { action: 'type', ref, text: 'secret' },
      { action: 'type', text: 'secret' },
      { action: 'fill', ref, value: 'secret' },
      { action: 'press', key: 'cmd+v' },
      { action: 'press', key: '4' },
    ])
      await assert.rejects(f.act(action), /blocked.*browser_fill_login/);
    assert.equal(node.value, '');
    assert.deepEqual(f.input, []);
    assert.deepEqual(f.prompts, []);
  }
});

test('a card field identified only by its visible label still refuses agent input', async () => {
  const f = fixture();
  const { node, ref } = f.field({});
  node.labels = [{ textContent: 'Card number' }];
  await assert.rejects(f.act({ action: 'fill', ref, value: '4242' }), /blocked/);
  await assert.rejects(f.act({ action: 'type', ref, text: '4242' }), /blocked/);
  assert.equal(node.value, '');
  assert.deepEqual(f.input, []);
});

test('a field becoming sensitive in its focus handler refuses fill and type', async () => {
  const f = fixture();
  const { node, ref } = f.field({});
  node.onFocus = () => {
    node.attributes.type = 'password';
    node.type = 'password';
  };
  await assert.rejects(f.act({ action: 'fill', ref, value: 'secret' }), /blocked/);
  await assert.rejects(f.act({ action: 'type', ref, text: 'secret' }), /blocked/);
  assert.equal(node.value, '');
  assert.deepEqual(f.input, []);
});

test('sign-in, sign-up and payment clicks require a fresh approval each time', async () => {
  for (const label of ['Sign in', 'Create an account', 'Pay now']) {
    const f = fixture();
    f.button(label);
    await assert.rejects(f.act({ action: 'click', x: 10, y: 10 }), /denied/);
    assert.equal(
      f.input.some((event) => event.type === 'mousePressed'),
      false,
    );
    f.answer(async () => ({ response: 0 }));
    await f.act({ action: 'click', x: 10, y: 10 });
    assert.equal(f.input.filter((event) => event.type === 'mousePressed').length, 1);
    assert.equal(f.prompts.length, 2);
    assert.equal(f.prompts[0].kind, 'credential');
  }
});

test('Enter can submit a saved password only after approval', async () => {
  const f = fixture();
  f.field({ type: 'password' });
  await assert.rejects(f.act({ action: 'press', key: 'Enter' }), /denied/);
  assert.deepEqual(f.input, []);
  f.answer(async () => ({ response: 0 }));
  await f.act({ action: 'press', key: 'Enter' });
  assert.equal(f.input.filter((event) => event.type === 'keyDown').length, 1);
  assert.equal(f.prompts.length, 2);
});

test('type with submit cannot send its Enter without approving the sign-in form', async () => {
  const f = fixture();
  const { node, ref } = f.field({});
  const password = f.field({ type: 'password' }).node;
  node.form = f.button('Sign in', [node, password]).form;
  await assert.rejects(f.act({ action: 'type', ref, text: 'account', submit: true }), /denied/);
  assert.deepEqual(f.input, []);
  f.answer(async () => ({ response: 0 }));
  await f.act({ action: 'type', ref, text: 'account', submit: true });
  assert.equal(f.input.filter((event) => event.method === 'Input.insertText').length, 1);
  assert.equal(f.input.filter((event) => event.type === 'keyDown').length, 1);
  assert.equal(f.prompts.length, 2);
});

test('an approval cannot be reused after the clicked control changes', async () => {
  const f = fixture();
  f.button('Sign in');
  f.answer(async () => {
    f.button('Pay now');
    return { response: 0 };
  });
  await assert.rejects(f.act({ action: 'click', x: 10, y: 10 }), /target changed/);
  assert.equal(
    f.input.some((event) => event.type === 'mousePressed'),
    false,
  );
});

test('closing a request dismisses its pending approval without sending input', async () => {
  const f = fixture();
  const shown = Promise.withResolvers();
  f.button('Sign in');
  f.answer(
    (_prompt, { signal }) =>
      new Promise((resolve) => {
        shown.resolve();
        signal.addEventListener('abort', () => resolve({ response: 1 }), { once: true });
      }),
  );
  const pending = f.act({ action: 'click', x: 10, y: 10 });
  await shown.promise;
  f.request.abort();
  await assert.rejects(pending, /request ended/);
  assert.equal(
    f.input.some((event) => event.type === 'mousePressed'),
    false,
  );
  assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
  assert.equal(f.contents.listenerCount('destroyed'), 0);
});
