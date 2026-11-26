// Minimal DOM sufficient for react-dom/client in Node, written for the feed
// render mount probe. It implements the node surface react-dom touches while
// committing (tree mutation, attributes, text, event no-ops) and the window
// globals component libraries read (matchMedia, rAF, layout boxes). Everything
// is a plain object; there is no layout, no style computation, and no event
// dispatch. Measurement code must not rely on geometry — every rect is zero.
// Importing this module installs the globals as a side effect, so it must be
// imported before react-dom.
/* eslint-disable @typescript-eslint/no-empty-function -- a DOM shim is a bag of deliberate no-op stubs */

class ShimNode {
  childNodes: ShimNode[] = [];
  parentNode: ShimNode | null = null;
  ownerDocument: unknown = null;
  appendChild(node: ShimNode) {
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node: ShimNode, before: ShimNode | null) {
    node.remove();
    node.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index >= 0) this.childNodes.splice(index, 0, node);
    else this.childNodes.push(node);
    return node;
  }
  removeChild(node: ShimNode) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  get firstChild(): ShimNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): ShimNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): ShimNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }
  get previousSibling(): ShimNode | null {
    if (!this.parentNode) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index > 0 ? this.parentNode.childNodes[index - 1] : null;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(new ShimText(value));
  }
  cloneNode() {
    throw new Error('cloneNode not implemented in the probe DOM shim');
  }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  }
  scrollIntoView() {}
  focus() {}
  blur() {}
  click() {}
  contains(node: ShimNode | null): boolean {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }
  compareDocumentPosition() {
    return 0;
  }
  getRootNode() {
    return this.ownerDocument;
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
}

class ShimText extends ShimNode {
  nodeType = 3;
  nodeName = '#text';
  nodeValue: string;
  constructor(text: string) {
    super();
    this.nodeValue = text;
  }
  override get textContent(): string {
    return this.nodeValue;
  }
  override set textContent(value: string) {
    this.nodeValue = value;
  }
  get data() {
    return this.nodeValue;
  }
  set data(value: string) {
    this.nodeValue = value;
  }
}

class ShimElement extends ShimNode {
  nodeType = 1;
  tagName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  attributes = new Map<string, string>();
  style: Record<string, unknown> = {};
  dataset: Record<string, string> = {};
  className = '';
  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
  }
  get nodeName() {
    return this.tagName;
  }
  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  set classList(_value: unknown) {
    // react-dom never writes classList; framer-motion does not either. Present
    // so feature detection does not fall over.
  }
  get classList() {
    const attrs = this.attributes;
    const list = {
      add: (...names: string[]) => {
        const current = new Set((attrs.get('class') ?? '').split(' ').filter(Boolean));
        for (const name of names) current.add(name);
        attrs.set('class', [...current].join(' '));
      },
      remove: (...names: string[]) => {
        const current = new Set((attrs.get('class') ?? '').split(' ').filter(Boolean));
        for (const name of names) current.delete(name);
        attrs.set('class', [...current].join(' '));
      },
      contains: (name: string) => (attrs.get('class') ?? '').split(' ').includes(name),
    };
    return list;
  }
  get innerHTML(): string {
    return '';
  }
  set innerHTML(value: string) {
    if (value !== '') throw new Error('probe DOM shim cannot parse innerHTML');
    this.childNodes = [];
  }
  get children() {
    return this.childNodes.filter((node) => node instanceof ShimElement);
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
}

class ShimHTMLElement extends ShimElement {}
class ShimHTMLIFrameElement extends ShimElement {}

interface DocumentShim {
  nodeType: number;
  documentElement: ShimElement;
  body: ShimHTMLElement;
  head: ShimElement;
  createElement: (tag: string) => ShimHTMLElement;
  createElementNS: (ns: string, tag: string) => ShimHTMLElement;
  createTextNode: (text: string) => ShimText;
  createComment: (text: string) => ShimText;
  addEventListener: () => void;
  removeEventListener: () => void;
  activeElement: null;
  defaultView: unknown;
  hidden: boolean;
  visibilityState: string;
}

const documentShim: DocumentShim = {
  nodeType: 9,
  documentElement: new ShimElement('html'),
  body: new ShimHTMLElement('body'),
  head: new ShimElement('head'),
  createElement: (tag) => {
    const element = new ShimHTMLElement(tag);
    element.ownerDocument = documentShim;
    return element;
  },
  createElementNS: (_ns, tag) => {
    const element = new ShimHTMLElement(tag);
    element.ownerDocument = documentShim;
    return element;
  },
  createTextNode: (text) => {
    const node = new ShimText(text);
    node.ownerDocument = documentShim;
    return node;
  },
  createComment: (text) => {
    const node = new ShimText(text);
    node.ownerDocument = documentShim;
    return node;
  },
  addEventListener() {},
  removeEventListener() {},
  activeElement: null,
  defaultView: null,
  hidden: false,
  visibilityState: 'visible',
};
documentShim.documentElement.ownerDocument = documentShim;
documentShim.body.ownerDocument = documentShim;
documentShim.head.ownerDocument = documentShim;

const windowShim = {
  document: documentShim,
  event: undefined,
  navigator: { userAgent: 'feed-render-probe' },
  Node: ShimNode,
  Element: ShimElement,
  HTMLElement: ShimHTMLElement,
  HTMLIFrameElement: ShimHTMLIFrameElement,
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
  addEventListener() {},
  removeEventListener() {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  requestAnimationFrame: (callback: (time: number) => void) =>
    setTimeout(() => {
      callback(performance.now());
    }, 16),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => {
    clearTimeout(id);
  },
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  matchMedia: () => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => true,
  }),
  innerWidth: 1024,
  innerHeight: 768,
  devicePixelRatio: 1,
  scrollTo() {},
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  },
};
documentShim.defaultView = windowShim;

const globalRecord = globalThis as Record<string, unknown>;
if (globalRecord.window === undefined) {
  globalRecord.window = windowShim;
  globalRecord.document = documentShim;
  globalRecord.requestAnimationFrame = windowShim.requestAnimationFrame;
  globalRecord.cancelAnimationFrame = windowShim.cancelAnimationFrame;
  globalRecord.ResizeObserver = windowShim.ResizeObserver;
  // floating-ui and friends do bare `instanceof Element` against the global
  // before falling back to the node's own window.
  globalRecord.Node = ShimNode;
  globalRecord.Element = ShimElement;
  globalRecord.HTMLElement = ShimHTMLElement;
  globalRecord.HTMLIFrameElement = ShimHTMLIFrameElement;
  if (globalRecord.navigator === undefined) {
    Object.defineProperty(globalThis, 'navigator', {
      value: windowShim.navigator,
      configurable: true,
    });
  }
}

export function createProbeContainer(): ShimHTMLElement {
  const container = documentShim.createElement('div');
  documentShim.body.appendChild(container);
  return container;
}
