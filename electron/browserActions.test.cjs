const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createBrowserActions } = require('./browserActions.cjs');
const { createBrowserReading } = require('./browserReading.cjs');
const { refFor } = require('./browserRefs.cjs');

function fixture() {
  const fields = new Map();
  const document = {
    defaultView: {},
    activeElement: null,
    querySelectorAll: (selector) => [...fields.values()].filter((node) => node.matches(selector)),
    getElementById: (id) => [...fields.values()].find((node) => node.getAttribute('id') === id),
  };
  const mainDocument = { defaultView: {}, activeElement: null };
  let afterCommand = () => {};
  let onInput = () => {};
  class Element {
    constructor(tag, attributes = {}) {
      this.localName = tag;
      this.ownerDocument = document;
      this.attributes = attributes;
      this.type = attributes.type || (tag === 'button' ? 'submit' : 'text');
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
    querySelectorAll(selector) {
      return document.querySelectorAll(selector).filter((node) => {
        for (let parent = node.parentElement; parent; parent = parent.parentElement)
          if (parent === this) return true;
        return false;
      });
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
      return this.parentElement?.closest(selector) || null;
    }
    focus() {
      document.activeElement = this;
      mainDocument.activeElement = this;
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
    if (method === 'DOM.scrollIntoViewIfNeeded') return {};
    if (method === 'DOM.getContentQuads') return { quads: [[0, 0, 20, 0, 20, 20, 0, 20]] };
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
      return { result: { objectId: params.contextId ? 'document' : 'main-document' } };
    if (method === 'Runtime.callFunctionOn') {
      const target =
        params.objectId === 'document'
          ? document
          : params.objectId === 'main-document'
            ? mainDocument
            : fields.get(Number(params.objectId));
      try {
        const fn = vm.runInNewContext(`(${params.functionDeclaration})`, context);
        const value = fn.apply(
          target,
          (params.arguments || []).map((arg) =>
            arg.objectId ? fields.get(Number(arg.objectId)) : arg.value,
          ),
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
      onInput(params);
      return {};
    }
    throw new Error(`Unexpected CDP command ${method}`);
  };
  const command = dbg.sendCommand;
  dbg.sendCommand = async (method, params) => {
    const result = await command(method, params);
    afterCommand(method, params);
    return result;
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
    credentials: {
      fillForAgent: async () => {
        contents.getTitle = () => 'saved-secret';
      },
    },
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
    hit.form = {
      elements: [...formFields, hit],
      action: 'https://example.test/submit',
      method: 'get',
      textContent: label,
    };
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
    mainDocument,
    document,
    element: (tag, attributes) => {
      hit = tag === 'input' ? new Input(attributes) : new Element(tag, attributes);
      return { node: hit, ref: refFor(entry, frame.loaderId, hit.id) };
    },
    afterCommand: (fn) => {
      afterCommand = fn;
    },
    onInput: (fn) => {
      onInput = fn;
    },
    label: (control) => {
      hit = new Element('label');
      hit.control = control;
    },
    groupAround: (control) => {
      const group = new Element('div', { role: 'group', 'aria-label': 'Account' });
      control.parentNode = control.parentElement = group;
      hit = new Element('span');
      hit.parentNode = hit.parentElement = control;
      return refFor(entry, frame.loaderId, group.id);
    },
    answer: (fn) => {
      answer = fn;
    },
  };
}

test('type, fill and key input refuse password, code and card fields without writing', async () => {
  for (const attributes of [
    { type: 'password' },
    { autocomplete: 'one-time-code' },
    { name: 'one-time-code', 'aria-label': 'One-time code' },
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

test('fill and type cannot relabel button controls to evade payment approval', async () => {
  for (const [tag, type] of [
    ['input', 'submit'],
    ['input', 'button'],
    ['input', 'reset'],
    ['input', 'image'],
    ['button', 'submit'],
  ]) {
    const f = fixture();
    const { node, ref } = f.element(tag, { type });
    node.value = node.textContent = 'Pay now';
    node.isContentEditable = tag === 'button';
    for (const action of [
      { action: 'fill', ref, value: 'Continue' },
      { action: 'type', ref, text: 'Continue' },
    ])
      await assert.rejects(f.act(action), /button|not a field|does not take typed text/i);
    assert.equal(node.value, 'Pay now');
    assert.equal(node.textContent, 'Pay now');
    assert.deepEqual(f.input, []);
  }
});

test('sensitive clicks use accessible control names, including referenced labels and images', async () => {
  for (const source of [
    'aria-labelledby',
    'aria-label',
    'image',
    'img',
    'title',
    'text',
    'value',
  ]) {
    const f = fixture();
    const label = 'Sign in with Google';
    const first = f.element('span', { id: 'first' }).node;
    first.textContent = 'Sign in';
    const second = f.element('span', { id: 'second' }).node;
    second.textContent = 'with Google';
    const image = f.element('img', { alt: label }).node;
    const isInput = source === 'image' || source === 'value';
    const { node } = f.element(isInput ? 'input' : 'button', {
      type: source === 'image' ? 'image' : 'submit',
    });
    if (source === 'aria-labelledby') node.attributes[source] = 'first missing second';
    else if (source === 'image') node.attributes.alt = label;
    else if (source === 'img') image.parentElement = node;
    else if (source === 'text') {
      node.textContent = label;
      image.attributes.alt = 'Brand logo';
      image.parentElement = node;
    } else if (source === 'value') node.value = label;
    else node.attributes[source] = label;

    await assert.rejects(f.act({ action: 'click', x: 10, y: 10 }), /denied/, source);
    assert.equal(f.prompts.length, 1, source);
    assert.match(f.prompts[0].message, /start an OAuth sign-in/);
    assert.equal(
      f.input.some((event) => event.type === 'mousePressed'),
      false,
      source,
    );
  }
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

test('clicking a group ref requires approval for the sign-in button under its click point', async () => {
  const f = fixture();
  const password = f.field({ type: 'password' }).node;
  const ref = f.groupAround(f.button('Continue', [password]));
  await assert.rejects(f.act({ action: 'click', ref }), /denied/);
  assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0].message, /submit a sign-in/);
  assert.equal(
    f.input.some((event) => event.type === 'mousePressed'),
    false,
  );

  f.answer(async () => ({ response: 0 }));
  await f.act({ action: 'click', ref });
  assert.equal(f.prompts.length, 2);
  assert.equal(f.input.filter((event) => event.type === 'mousePressed').length, 1);
});

test('implicit Enter approves the default submit button destination and binds its method', async () => {
  for (const action of [
    { action: 'press', key: 'Enter' },
    { action: 'type', text: 'account', submit: true },
  ]) {
    const f = fixture();
    const { node } = f.field({});
    const password = f.field({ type: 'password' }).node;
    f.button('Unrelated form');
    const submit = f.button('Sign in', [node, password]);
    const later = f.button('Other destination');
    node.form = later.form = submit.form;
    submit.attributes.formaction = submit.formAction = 'https://identity.test/login';
    submit.attributes.formmethod = submit.formMethod = 'post';
    node.focus();

    await assert.rejects(f.act(action), /denied/);
    assert.match(f.prompts[0].message, /opening https:\/\/identity\.test/);
    assert.deepEqual(f.input, []);

    f.answer(async () => {
      submit.attributes.formmethod = submit.formMethod = 'get';
      return { response: 0 };
    });
    await assert.rejects(f.act(action), /target changed/);
    assert.deepEqual(f.input, []);

    f.answer(async () => ({ response: 0 }));
    await f.act(action);
    assert.equal(f.prompts.length, 3);
    assert.equal(f.input.filter((event) => event.type === 'keyDown').length, 1);
  }
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

test('saved-login fill returns success without reading the title the page copied from its password', async () => {
  const f = fixture();
  assert.deepEqual(await f.act({ action: 'fillCredentials' }), { requestId: 'request', ok: true });
  assert.equal(f.contents.getTitle(), 'saved-secret');
});

test('main-world activeElement spoofing cannot redirect sensitive-field inspection', async () => {
  const f = fixture();
  const decoy = f.field({}).node;
  f.field({ type: 'password' });
  f.mainDocument.activeElement = decoy;
  for (const action of [
    { action: 'type', text: 'secret' },
    { action: 'press', key: 'cmd+v' },
  ])
    await assert.rejects(f.act(action), /blocked/);
  assert.deepEqual(f.input, []);
});

test('a field changing between inspection and dispatch never receives sensitive input', async () => {
  for (const action of [
    { action: 'type', text: 'secret' },
    { action: 'press', key: 'cmd+v' },
  ]) {
    const f = fixture();
    const { node } = f.field({});
    let inspections = 0;
    const receivedBy = [];
    f.afterCommand((method, params) => {
      if (method === 'Runtime.callFunctionOn' && params.returnByValue && params.arguments)
        inspections++;
      if (inspections === 2 && method === 'Runtime.releaseObject')
        node.attributes.type = 'password';
    });
    f.onInput(() => receivedBy.push(node.attributes.type || 'text'));
    await f.act(action).catch((error) => assert.match(error.message, /blocked|target changed/));
    assert.equal(receivedBy.includes('password'), false);
  }
});

test('mousedown cannot change the approved sign-in destination before release', async () => {
  const f = fixture();
  const button = f.button('Sign in');
  f.answer(async () => ({ response: 0 }));
  f.onInput((event) => {
    if (event.type === 'mousePressed') button.form.action = 'https://attacker.test/steal';
  });
  await assert.rejects(f.act({ action: 'click', x: 10, y: 10 }), /target changed/);
  assert.equal(
    f.input.some((event) => event.type === 'mousePressed'),
    true,
  );
  assert.equal(
    f.input.some((event) => event.type === 'mouseReleased' && event.x === 10),
    false,
  );
});

test('a label associated with a submit control requires sign-in approval', async () => {
  const f = fixture();
  const password = f.field({ type: 'password' }).node;
  const submit = f.field({ type: 'submit' }).node;
  submit.form = f.button('', [password, submit]).form;
  f.label(submit);
  await assert.rejects(f.act({ action: 'click', x: 10, y: 10 }), /denied/);
  assert.equal(f.prompts.length, 1);
  assert.equal(
    f.input.some((event) => event.type === 'mousePressed'),
    false,
  );
});
