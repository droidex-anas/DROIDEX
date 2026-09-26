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
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attributes = this.attributes.map((attr) => ` ${attr.name}="${attr.value}"`).join('');
    const children = this.children.map((child) => child.outerHTML).join('');
    return `<${tag}${attributes}>${this.text}${children}</${tag}>`;
  }
}

const el = (tagName, attributes, children, text) =>
  new FakeElement(tagName, attributes, children, text);

// Top-level function declarations become properties of the vm context.
function loadPreload() {
  const inert = new Proxy(function () {}, {
    get: (_target, prop) => (prop === Symbol.toPrimitive ? undefined : inert),
    set: () => true,
    apply: () => inert,
  });
  class HTMLSelectElement {}
  const context = {
    document: { createElement: () => inert, createElementNS: () => inert, addEventListener() {} },
    window: inert,
    location: { href: 'https://example.test/page' },
    HTMLSelectElement,
    Event: class Event {},
    require: (name) =>
      name === 'electron'
        ? { contextBridge: inert, ipcRenderer: inert }
        : require(path.join(__dirname, name)),
  };
  vm.runInNewContext(
    readFileSync(path.join(__dirname, 'nativeBrowserPreload.cjs'), 'utf8'),
    context,
  );
  return context;
}

const preload = loadPreload();

test('inspected element text never includes script, style, or noscript bodies', () => {
  assert.equal(preload.safeElementText(el('script', {}, [], 'steal()')), '[redacted]');
  const card = el('div', {}, [el('style', {}, [], '.x{}'), el('p', {}, [], 'Hello')], 'Card ');
  assert.equal(preload.safeElementText(card), 'Card Hello');
});

test('inspected element HTML redacts secrets, executable attributes, and URL credentials', () => {
  const form = el('form', { action: 'https://user:pw@example.test/login?token=abc#frag' }, [
    el('script', {}, [], 'steal()'),
    el('button', { formaction: '/submit?api_key=abc', onclick: 'steal()' }),
    el('a', { href: '/next', ping: '/track', style: 'color:red' }),
    el('iframe', { srcdoc: '<script>steal()</script>' }),
    el('input', { name: 'q', value: 'hunter2' }),
    el('meta', { 'http-equiv': 'refresh', content: '0;url=/elsewhere' }),
  ]);

  assert.equal(
    preload.sanitizedOuterHtml(form),
    '<form action="https://example.test/login?token=%5Bredacted%5D">' +
      '<button formaction="https://example.test/submit?api_key=%5Bredacted%5D" onclick="[redacted]"></button>' +
      '<a href="https://example.test/next" ping="[redacted]" style="[redacted]"></a>' +
      '<iframe srcdoc="[redacted]"></iframe>' +
      '<input name="q" value="[redacted]"></input>' +
      '<meta http-equiv="refresh" content="[redacted]"></meta>' +
      '</form>',
  );
});

test('select option matching accepts the option label', () => {
  const select = Object.assign(new preload.HTMLSelectElement(), {
    options: [{ value: 'us', label: 'United States', textContent: 'US' }],
    dispatchEvent() {},
  });
  preload.document.querySelector = () => select;
  preload.selectOption('#country', 'United States');
  assert.equal(select.value, 'us');
});
