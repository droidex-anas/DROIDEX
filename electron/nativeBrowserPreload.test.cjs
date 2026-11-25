const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Just enough of an element for the sanitizers: attributes, a subtree, text and outerHTML.
class FakeElement {
  constructor(tagName, attributes = {}, children = [], text = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = Object.entries(attributes).map(([name, value]) => ({ name, value }));
    this.children = children;
    this.text = text;
    for (const child of children) child.parent = this;
  }
  getAttribute(name) {
    return this.attributes.find((attr) => attr.name === name)?.value ?? null;
  }
  setAttribute(name, value) {
    this.attributes.find((attr) => attr.name === name).value = value;
  }
  cloneNode() {
    const attributes = Object.fromEntries(this.attributes.map((attr) => [attr.name, attr.value]));
    const children = this.children.map((child) => child.cloneNode());
    return new FakeElement(this.tagName, attributes, children, this.text);
  }
  querySelectorAll(selector) {
    const tags = selector === '*' ? null : selector.toUpperCase().split(',');
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return descendants.filter((node) => !tags || tags.includes(node.tagName));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  remove() {
    this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.text = value;
    this.children = [];
  }
  get innerText() {
    return this.textContent;
  }
  get childNodes() {
    return [{ nodeType: 3, textContent: this.text }, ...this.children];
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, width: 100, height: 20 };
  }
  get isContentEditable() {
    return this.getAttribute('contenteditable') !== null;
  }
  closest() {
    return null;
  }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attributes = this.attributes.map((attr) => ` ${attr.name}="${attr.value}"`).join('');
    const children = this.children.map((child) => child.outerHTML).join('');
    return `<${tag}${attributes}>${this.text}${children}</${tag}>`;
  }
}

const el = (tagName, attributes, children, text) =>
  new FakeElement(tagName, attributes, children, text);

function loadPage(target) {
  const inert = new Proxy(function () {}, {
    get: (_target, prop) => (prop === Symbol.toPrimitive ? undefined : inert),
    set: () => true,
    apply: () => inert,
  });
  const context = vm.createContext({
    document: {
      addEventListener() {},
      querySelector: (selector) => (selector === '#target' ? target : null),
    },
    window: inert,
    location: { href: 'https://example.test/page' },
    Node: { TEXT_NODE: 3 },
    HTMLIFrameElement: class HTMLIFrameElement {},
    getComputedStyle: () => ({ fontFamily: 'Arial', fontSize: '14px' }),
  });
  const loadInPage = (name, requireModule) => {
    const module = { exports: {} };
    vm.compileFunction(readFileSync(path.join(__dirname, name), 'utf8'), ['require', 'module'], {
      parsingContext: context,
      filename: name,
    })(requireModule, module);
    return module.exports;
  };
  const inspection = loadInPage('browserElementInspection.cjs', require);
  loadInPage('nativeBrowserPreload.cjs', (name) => {
    if (name === 'electron') return { ipcRenderer: inert };
    if (name === './browserElementInspection.cjs') return inspection;
    return require(name);
  });
  return { inspect: context.__droidexInspect, hoverInfo: inspection.hoverInfo };
}

test('inspected element text never includes script, style, or noscript bodies', () => {
  const script = el('script', {}, [], 'steal()');
  assert.equal(loadPage(script).inspect('#target').text, '[redacted]');
  const card = el(
    'div',
    {},
    [
      script,
      el('style', {}, [], '.x{}'),
      el('noscript', {}, [], 'Hidden'),
      el('p', {}, [], 'Hello'),
    ],
    'Card ',
  );
  assert.equal(loadPage(card).inspect('#target').text, 'Card Hello');
});

test('inspected element HTML redacts secrets, executable attributes, and URL credentials', () => {
  const form = el('form', { action: 'https://user:pw@example.test/login?token=abc#frag' }, [
    el('script', {}, [], 'steal()'),
    el('button', { formaction: '/submit?api_key=abc', onclick: 'steal()' }),
    el('a', { href: '/next', ping: '/track', style: 'color:red' }),
    el('iframe', { srcdoc: '<script>steal()</script>' }),
    el('input', { name: 'q', value: 'hunter2' }),
    el('meta', { 'http-equiv': 'refresh', content: '0;url=/elsewhere' }),
    el('div', { 'data-authorization': 'Bearer abc', 'data-author': 'Ada' }),
  ]);

  assert.equal(
    loadPage(form).inspect('#target').html,
    '<form action="https://example.test/login?token=%5Bredacted%5D">' +
      '<button formaction="https://example.test/submit?api_key=%5Bredacted%5D" onclick="[redacted]"></button>' +
      '<a href="https://example.test/next" ping="[redacted]" style="[redacted]"></a>' +
      '<iframe srcdoc="[redacted]"></iframe>' +
      '<input name="q" value="[redacted]"></input>' +
      '<meta http-equiv="refresh" content="[redacted]"></meta>' +
      '<div data-authorization="[redacted]" data-author="Ada"></div>' +
      '</form>',
  );
});

test('the hover label never shows what an editable element holds', () => {
  const { hoverInfo } = loadPage();
  const editable = el('h1', { contenteditable: '' }, [], 'sk-live-secret');
  const heading = el('h1', {}, [], 'Pricing');
  assert.equal(hoverInfo(editable, editable.getBoundingClientRect()).name, 'h1');
  assert.equal(hoverInfo(heading, heading.getBoundingClientRect()).name, 'Pricing');
});
