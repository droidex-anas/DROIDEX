const { ipcRenderer } = require('electron');
const { randomUUID } = require('node:crypto');
const { submittedCredential, fillCredentialForm } = require('./browserCredentialFields.cjs');
const credentialDocumentId = randomUUID();
const { isSensitiveBrowserKey, redactBrowserDiagnosticUrl } = require('./browserDiagnostics.cjs');
const { createDesignOverlay, INTERNAL_ATTR } = require('./browserDesignOverlay.cjs');

// Design mode as the app last set it.
let designMode = false;
let drawing = false;
// How much larger than the page the overlay is drawn: 1 / the pane's scale.
let uiScale = 1;
// Everything this page has picked, by id ({ id, selection, and an element,
// an area in page coordinates, or sketch strokes }), and the marks the app
// holds now ({ id, number }): marks as drawn, with picks the app has not
// answered yet, and appMarks as the app last sent them. A mark the app drops
// can come back, so what was picked is kept.
const picked = new Map();
let marks = [];
let appMarks = [];
// The element the hover outline is on. Walking with the arrow keys keeps it
// while the pointer stays inside it; walkedFrom is the way back down.
let hoverTarget = null;
let walked = false;
let walkedFrom = [];
let pendingHover = null;
let hoverFrame = 0;
let renderQueued = false;
// A press that is not yet a click or a drag, and the area a drag marks out.
let press = null;
let areaBox = null;
// The sketch this drawing session adds to, and the stroke being drawn.
let sketch = null;
let activeStroke = null;

const overlay = createDesignOverlay(window);

const redactedTextTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
const urlAttributes = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'codebase',
  'data',
  'formaction',
  'href',
  'itemid',
  'manifest',
  'poster',
  'profile',
  'src',
  'usemap',
  'xlink:href',
]);
const redactedUrlAttributes = new Set(['ping', 'srcdoc', 'srcset', 'style']);

// Main calls these here, in the preload's isolated world (browserPageScript.cjs),
// where the page's own scripts can neither see nor call them. A saved login
// arrives only to be written into the page's inputs and is never returned, so
// the agent can authorize a login without reading it.
Object.assign(globalThis, {
  __droidexApplyDesignState: applyState,
  __droidexInspect: inspectElement,
  __droidexCredentialDocument: () => credentialDocumentId,
  __droidexFillCredentials: (payload) => {
    if (payload.documentId !== credentialDocumentId)
      throw new Error('The page changed before the login was filled.');
    return fillCredentialForm(document, payload);
  },
  __droidexNextChange: nextChange,
});

// Resolves at the next change to the document, or after ms, for browser_wait.
function nextChange(ms) {
  return new Promise((resolve) => {
    const done = () => {
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };
    const observer = new MutationObserver(done);
    const timer = setTimeout(done, ms);
    observer.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
}

document.addEventListener('submit', onFormSubmit, true);

// Design mode's listeners are on the page only while it is on. The page never
// sees a press, click or menu while it is. Only the user's own input counts:
// events the page's scripts dispatch are left alone, so a page can neither
// make marks nor drive design mode.
const DESIGN_LISTENERS = [
  ['pointermove', onPointerMove],
  ['pointerdown', onPointerDown],
  ['pointerup', onPointerUp],
  ['mousedown', swallow],
  ['mouseup', swallow],
  ['click', swallow],
  ['dblclick', swallow],
  ['auxclick', swallow],
  ['contextmenu', swallow],
  ['keydown', onKeyDown],
  ['scroll', queueRender],
  ['resize', queueRender],
].map(([type, handler]) => [type, (event) => event.isTrusted && handler(event)]);
let listening = false;

function listen(on) {
  if (on === listening) return;
  listening = on;
  for (const [type, handler] of DESIGN_LISTENERS) {
    if (on) window.addEventListener(type, handler, true);
    else window.removeEventListener(type, handler, true);
  }
}

function applyState(state) {
  const wasDesigning = designMode;
  const wasDrawing = drawing;
  uiScale = 1 / (Number(state && state.scale) || 1);
  designMode = Boolean(state && state.designMode);
  drawing = designMode && Boolean(state && state.pencilMode);
  const next = Array.isArray(state && state.marks) ? state.marks : [];
  // A sketch whose chip the app took away is done: the next stroke starts a
  // new one rather than sending the removed strokes again.
  const holds = (list, id) => list.some((mark) => mark.id === id);
  if (sketch && !activeStroke && holds(appMarks, sketch.id) && !holds(next, sketch.id))
    sketch = null;
  // Only a change of mode ends a stroke or drag in progress; the app's
  // answers to earlier picks arrive in the middle of later ones, so a pick
  // or sketch it has not answered yet keeps its mark.
  const modeChanged = designMode !== wasDesigning || drawing !== wasDrawing;
  const unanswered = modeChanged
    ? []
    : marks.filter((mark) => !holds(appMarks, mark.id) && !holds(next, mark.id));
  appMarks = next;
  marks = [...next, ...unanswered];
  // Drawing again starts a new sketch.
  if (!drawing) sketch = null;
  if (modeChanged) {
    activeStroke = null;
    press = null;
    showArea(null);
  }
  listen(designMode);
  overlay.setTheme(state && state.theme, uiScale);
  overlay.setShown(designMode);
  if (!designMode || drawing) hideHover();
  render();
  // Design mode starting, as on every new document, tells the app which marks
  // this page draws: none it picked before loading again.
  if (designMode && !wasDesigning) queueRender();
}

function sendDesignEvent(event) {
  ipcRenderer.send('native-browser-design-event', event);
}

function onPointerMove(event) {
  if (activeStroke) {
    activeStroke.push(pagePoint(event));
    render();
    swallow(event);
    return;
  }
  if (press) {
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (areaBox || moved >= 6) {
      hideHover();
      showArea(boxBetween(press, point(event)));
    }
    swallow(event);
    return;
  }
  if (drawing) return;
  pendingHover = point(event);
  if (!hoverFrame) hoverFrame = requestAnimationFrame(processHover);
}

function processHover() {
  hoverFrame = 0;
  if (!designMode || drawing || press || !pendingHover) return;
  const { x, y } = pendingHover;
  if (walked && hoverTarget && contains(hoverTarget, x, y)) return;
  walked = false;
  walkedFrom = [];
  const target = pickTarget(x, y);
  if (target === hoverTarget) return;
  hoverTarget = target;
  if (target) showHover(target);
  else overlay.hideHover();
}

function showHover(el) {
  const rect = el.getBoundingClientRect();
  overlay.showHover(rect, hoverInfo(el, rect));
}

function hideHover() {
  hoverTarget = null;
  walked = false;
  walkedFrom = [];
  overlay.hideHover();
}

function onPointerDown(event) {
  swallow(event);
  if (event.button !== 0) return;
  if (!drawing) {
    press = { x: event.clientX, y: event.clientY, shift: event.shiftKey };
    return;
  }
  if (!sketch) {
    sketch = { id: `@sketch-${Date.now().toString(36)}`, strokes: [] };
    picked.set(sketch.id, sketch);
  }
  activeStroke = [pagePoint(event)];
  sketch.strokes.push(activeStroke);
  showMark(sketch.id);
  render();
}

function onPointerUp(event) {
  swallow(event);
  if (activeStroke) {
    finishStroke();
    return;
  }
  const start = press;
  press = null;
  if (!start) return;
  if (areaBox) {
    const box = areaBox;
    showArea(null);
    if (box.width >= 8 && box.height >= 8) pick(areaPick(box), false);
    return;
  }
  const target = clickTarget(event.clientX, event.clientY);
  if (target) pick(elementPick(target), start.shift);
}

// A stroke too short to mean anything is dropped; the sketch goes to the app
// again with every stroke it has, keeping its id and number.
function finishStroke() {
  const stroke = activeStroke;
  activeStroke = null;
  if (strokeLength(stroke) < 6) sketch.strokes.pop();
  if (sketch.strokes.length > 0) {
    sendDesignEvent({ type: 'select', selection: sketchSelection(sketch) });
  } else {
    marks = marks.filter((mark) => mark.id !== sketch.id);
    picked.delete(sketch.id);
    sketch = null;
  }
  render();
}

// A click marks what it lands on; Shift+click marks it or takes its mark away.
function pick(entry, toggle) {
  // A mark the app kept across a reload is not picked on this page yet;
  // picking it again brings its outline back and refreshes it.
  const marked = picked.has(entry.id) && marks.some((mark) => mark.id === entry.id);
  if (marked) {
    if (!toggle) return;
    marks = marks.filter((mark) => mark.id !== entry.id);
    sendDesignEvent({ type: 'unselect', id: entry.id });
  } else {
    picked.set(entry.id, entry);
    showMark(entry.id);
    sendDesignEvent({ type: 'select', selection: entry.selection });
  }
  // The mark takes the outline's place until the pointer moves to something else.
  overlay.hideHover();
  render();
}

// Drawn at once with the next number; the app's list, which follows, decides.
function showMark(id) {
  if (marks.some((mark) => mark.id === id)) return;
  const number = marks.reduce((top, mark) => Math.max(top, mark.number), 0) + 1;
  marks = [...marks, { id, number }];
}

function onKeyDown(event) {
  const key = event.key;
  if (key === 'Escape') {
    swallow(event);
    // Holding a key steps back or toggles drawing once, not on every repeat.
    if (event.repeat) return;
    // A stroke or drag in progress goes first; the app takes it from there.
    if (activeStroke || press) {
      if (activeStroke) {
        activeStroke.length = 0;
        finishStroke();
      }
      press = null;
      showArea(null);
      return;
    }
    sendDesignEvent({ type: 'key', key: 'escape' });
    return;
  }
  if ((key === 'd' || key === 'D') && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (isEditable(event.target)) return;
    swallow(event);
    if (!event.repeat) sendDesignEvent({ type: 'key', key: 'draw' });
    return;
  }
  if ((key === 'ArrowUp' || key === 'ArrowDown') && hoverTarget && !drawing) {
    swallow(event);
    walk(key === 'ArrowUp');
  }
}

// Up goes to the parent, Down back to where Up came from, else the first child.
function walk(up) {
  const next = up ? hoverTarget.parentElement : walkedFrom.pop() || hoverTarget.firstElementChild;
  if (!next || next === document.body || next === document.documentElement) return;
  if (up) walkedFrom.push(hoverTarget);
  walked = true;
  hoverTarget = next;
  showHover(next);
}

function clickTarget(x, y) {
  if (walked && hoverTarget && contains(hoverTarget, x, y)) return hoverTarget;
  return pickTarget(x, y);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    const drawn = render();
    // The app's prompt box stays by its mark as the page scrolls.
    if (drawn) sendDesignEvent({ type: 'boxes', boxes: drawn.map(({ id, box }) => ({ id, box })) });
  });
}

function render() {
  if (!designMode) return null;
  const drawn = [];
  for (const { id, number } of marks) {
    const entry = picked.get(id);
    if (entry) drawn.push({ id, number, box: markBox(entry), strokes: entry.strokes });
  }
  overlay.drawMarks(drawn, scrollPoint());
  if (hoverTarget) overlay.followHover(hoverTarget.getBoundingClientRect());
  return drawn;
}

// Where a mark is in the viewport now, or null when it is not on the page.
function markBox(entry) {
  if (entry.el) {
    if (!entry.el.isConnected) return null;
    const rect = entry.el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? boxFor(rect) : null;
  }
  const box = entry.strokes ? strokesBounds(entry.strokes) : entry.pageBox;
  if (!box) return null;
  const scroll = scrollPoint();
  return { ...box, x: box.x - scroll.x, y: box.y - scroll.y };
}

function showArea(box) {
  areaBox = box;
  overlay.showArea(box);
}

function elementPick(el) {
  const selection = elementSelection(el);
  return { id: selection.anchor.id, el, selection };
}

function areaPick(box) {
  const scroll = scrollPoint();
  const id = `@area-${Date.now().toString(36)}`;
  return {
    id,
    pageBox: { ...box, x: box.x + scroll.x, y: box.y + scroll.y },
    selection: pageSelection({
      id,
      kind: 'region',
      label: `area ${box.width} × ${box.height}`,
      box,
    }),
  };
}

function sketchSelection(entry) {
  const scroll = scrollPoint();
  const strokes = entry.strokes.map((stroke) =>
    stroke.map((pt) => ({ x: Math.round(pt.x - scroll.x), y: Math.round(pt.y - scroll.y) })),
  );
  return pageSelection({
    id: entry.id,
    kind: 'region',
    label: `sketch (${strokes.length} stroke${strokes.length === 1 ? '' : 's'})`,
    box: markBox(entry),
    strokes,
  });
}

function pageSelection(anchor) {
  return { anchor, url: location.href, title: document.title, scroll: scrollPoint() };
}

// What the hover label says: a name, the size, the font and its colour.
function hoverInfo(el, rect) {
  const style = getComputedStyle(el);
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  return {
    name: hoverName(el),
    size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
    font: `${family} ${Math.round(parseFloat(style.fontSize) * 10) / 10}px`,
    color: style.color,
  };
}

// Elements whose own words are their name.
const NAMED_BY_TEXT = new Set([
  'A',
  'BUTTON',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LEGEND',
  'OPTION',
  'SUMMARY',
]);

// The component's name, else the element's accessible name, else its tag.
// Its words are read as a pick reads them, so a field's content never shows.
function hoverName(el) {
  const source = resolveSource(el);
  if (source.component) return source.component;
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      (NAMED_BY_TEXT.has(el.tagName) ? safeElementText(withoutTypedContent(el), 40) : ''),
    40,
  );
  return name && name !== '[redacted]' ? name : el.tagName.toLowerCase();
}

function contains(el, x, y) {
  const rect = el.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function isEditable(node) {
  return Boolean(
    node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)),
  );
}

function boxBetween(a, b) {
  return {
    x: Math.round(Math.min(a.x, b.x)),
    y: Math.round(Math.min(a.y, b.y)),
    width: Math.round(Math.abs(a.x - b.x)),
    height: Math.round(Math.abs(a.y - b.y)),
  };
}

function point(event) {
  return { x: event.clientX, y: event.clientY };
}

// A point in page coordinates, which stay put as the page scrolls.
function pagePoint(event) {
  return { x: event.clientX + window.scrollX, y: event.clientY + window.scrollY };
}

function scrollPoint() {
  return { x: Math.round(window.scrollX), y: Math.round(window.scrollY) };
}

function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

// Observe (never block) login submissions so the main process can offer to
// save the credential. The values flow straight to main over IPC and are
// encrypted there; nothing is stored in the page or exposed to the agent.
function onFormSubmit(event) {
  if (!event.isTrusted || event.target?.getAttribute(INTERNAL_ATTR)) return;
  const credential = submittedCredential(event.target);
  if (credential) ipcRenderer.send('native-browser-credential-capture', credential);
}

function inspectElement(selector) {
  if (!selector) throw new Error('Element inspection requires a selector.');
  const el = document.querySelector(selector);
  if (!el) throw new Error('The inspected browser element is no longer available.');
  const rect = el.getBoundingClientRect();
  const shown = withoutTypedContent(el);
  const text = safeElementText(shown, 1000);
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      directText(shown) ||
      text,
    240,
  );
  const iframe =
    el instanceof HTMLIFrameElement
      ? {
          src: sanitizeUrl(el.src || el.getAttribute('src') || ''),
          accessible: canAccessFrame(el),
        }
      : undefined;
  return {
    selector,
    tagName: el.tagName.toLowerCase(),
    role: roleFor(el) || undefined,
    name: name && name !== '[redacted]' ? name : undefined,
    text: text || undefined,
    attributes: attrsFor(el),
    styles: stylesFor(el),
    box: boxFor(rect),
    html: sanitizedOuterHtml(shown),
    iframe,
  };
}

// Native and ARIA fields, whose content is what someone entered or chose.
const FIELDS = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  ...['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider'].map(
    (role) => `[role~="${role}" i]`,
  ),
].join(', ');

// A copy of an element without what its fields hold, its own included; an
// input's value never shows in its markup either.
function withoutTypedContent(el) {
  const clone = el.cloneNode(true);
  const redact = (node) => {
    if (node.textContent) node.textContent = '[redacted]';
  };
  if (el.isContentEditable || el.closest(FIELDS)) redact(clone);
  else for (const field of clone.querySelectorAll(FIELDS)) redact(field);
  return clone;
}

function canAccessFrame(frame) {
  try {
    return Boolean(frame.contentDocument);
  } catch {
    return false;
  }
}

function sanitizedOuterHtml(el) {
  const clone = el.cloneNode(true);
  if (redactedTextTags.has(clone.tagName)) {
    clone.textContent = '[redacted]';
  } else {
    for (const node of clone.querySelectorAll('script,style,noscript')) node.remove();
  }
  const nodes = [clone, ...clone.querySelectorAll('*')];
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (isSensitiveAttribute(name, node)) {
        node.setAttribute(attr.name, '[redacted]');
      } else if (redactedUrlAttributes.has(name) || isMetaRefreshContent(name, node)) {
        node.setAttribute(attr.name, '[redacted]');
      } else if (urlAttributes.has(name)) {
        node.setAttribute(attr.name, sanitizeUrl(attr.value));
      }
    }
  }
  return String(clone.outerHTML || '').slice(0, 4000);
}

function elementSelection(el) {
  const selector = selectorFor(el);
  const verified = verifySelector(el, selector);
  const source = resolveSource(el);
  const anchor = buildAnchor(el, selector, source);
  const detail = buildDetail(el, selector, verified);
  return {
    anchor,
    detail,
    url: location.href,
    title: document.title,
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
  };
}

// A pick reads its element as inspectElement does: without what its fields
// hold, so typed or sensitive content never reaches the agent.
function buildAnchor(el, selector, source) {
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const shown = withoutTypedContent(el);
  const text = safeElementText(shown, 80);
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      directText(shown) ||
      text,
    80,
  );
  return {
    id: `@live-${stableHash(selector)}`,
    kind: 'element',
    label: labelText(tag, source, name || text),
    tag,
    role: roleFor(el) || undefined,
    name: name || undefined,
    text: text || undefined,
    box: boxFor(rect),
    source,
  };
}

function buildDetail(el, selector, verified) {
  return {
    id: `@live-${stableHash(selector)}`,
    selector,
    selectorVerified: verified,
    attributes: attrsFor(el),
    styles: stylesFor(el),
    ancestors: ancestorsFor(el),
    html: cleanText(sanitizedOuterHtml(withoutTypedContent(el)), 400) || undefined,
  };
}

function labelText(tag, source, text) {
  const component = source && source.component ? `${source.component} \u203a ` : '';
  const quoted = text ? ` "${cleanText(text, 40)}"` : '';
  return `${component}<${tag}>${quoted}`;
}

function pickTarget(x, y) {
  let node = document.elementFromPoint(x, y);
  while (node && node.getAttribute && node.getAttribute(INTERNAL_ATTR)) node = node.parentElement;
  if (!node || node === document.documentElement) return null;
  return node;
}

function selectorFor(el) {
  if (el.id) {
    const selector = `#${cssEscape(el.id)}`;
    if (verifySelector(el, selector)) return selector;
  }
  const testId = el.getAttribute('data-testid');
  if (testId) {
    const selector = `[data-testid="${cssEscape(testId)}"]`;
    if (verifySelector(el, selector)) return selector;
  }
  const aria = el.getAttribute('aria-label');
  if (aria) {
    const selector = `${el.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
    if (verifySelector(el, selector)) return selector;
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (verifySelector(el, selector)) return selector;
    node = parent;
  }
  return parts.join(' > ');
}

function verifySelector(el, selector) {
  if (!selector) return false;
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function attrsFor(el) {
  const out = {};
  const secret = isSensitiveField(el);
  for (const name of [
    'id',
    'class',
    'data-testid',
    'aria-label',
    'title',
    'placeholder',
    'type',
    'href',
    'src',
    'action',
    'name',
    'value',
    'role',
  ]) {
    const value = el.getAttribute && el.getAttribute(name);
    if (!value) continue;
    if (isSensitiveAttribute(name, el) || (name === 'value' && secret)) {
      out[name] = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      continue;
    }
    out[name] = urlAttributes.has(name)
      ? sanitizeUrl(value).slice(0, 500)
      : String(value).slice(0, 160);
  }
  return out;
}

function isSensitiveAttribute(name, el) {
  if (name === 'nonce') return true;
  // A control's value, native or ARIA.
  if (['value', 'aria-valuenow', 'aria-valuetext'].includes(name) || name.startsWith('on'))
    return true;
  if (
    /(token|secret|password|passcode|credential|authori[sz]|auth(?!or)|signature|api[-_]?key|private[-_]?key|cookie|session|csrf|otp)/i.test(
      name,
    )
  )
    return true;
  if (name !== 'content') return false;
  const fieldName = String(el.getAttribute && el.getAttribute('name')).toLowerCase();
  return isSensitiveBrowserKey(fieldName);
}

function sanitizeUrl(value) {
  return redactBrowserDiagnosticUrl(value, location.href);
}

function isMetaRefreshContent(name, el) {
  return (
    name === 'content' &&
    el.tagName === 'META' &&
    String(el.getAttribute('http-equiv') || '').toLowerCase() === 'refresh'
  );
}

// Password and one-time-code fields must never reach the agent transcript, so
// their live values are redacted from every snapshot/detail payload.
function isSensitiveField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return true;
  const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
  return auto.includes('password') || auto === 'one-time-code';
}

function stylesFor(el) {
  const style = getComputedStyle(el);
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    display: style.display,
    padding: style.padding,
    margin: style.margin,
    border: style.border,
  };
}

function ancestorsFor(el) {
  const out = [];
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement && out.length < 4) {
    const testId = node.getAttribute('data-testid');
    out.push({
      tag: node.tagName.toLowerCase(),
      selector: node.id
        ? `#${cssEscape(node.id)}`
        : testId
          ? `[data-testid="${cssEscape(testId)}"]`
          : undefined,
    });
    node = node.parentElement;
  }
  return out;
}

function resolveSource(el) {
  const react = resolveReact(el);
  if (react && react.file) return react;
  const attr = resolveAttributes(el);
  if (attr && attr.file) {
    if (react) {
      attr.component = attr.component || react.component;
      attr.componentChain = attr.componentChain || react.componentChain;
      attr.framework = attr.framework || react.framework;
    }
    return attr;
  }
  const vue = resolveVue(el);
  if (vue && vue.file) return vue;
  const svelte = resolveSvelte(el);
  if (svelte && svelte.file) return svelte;
  return react || vue || svelte || attr || { confidence: 'none' };
}

function resolveReact(el) {
  const key = Object.keys(el).find(
    (name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'),
  );
  if (!key) return undefined;
  let fiber = el[key] || null;
  let file;
  let line;
  let column;
  const chain = [];
  let guard = 0;
  while (fiber && guard < 200) {
    guard += 1;
    if (!file && fiber._debugSource && typeof fiber._debugSource.fileName === 'string') {
      file = normalizeFile(fiber._debugSource.fileName);
      line = numberOr(fiber._debugSource.lineNumber);
      column = numberOr(fiber._debugSource.columnNumber);
    }
    const name = componentName(fiber.type);
    if (name && chain[chain.length - 1] !== name && chain.length < 6) chain.push(name);
    fiber = fiber._debugOwner || fiber.return || null;
  }
  if (!file && chain.length === 0) return undefined;
  return {
    framework: 'react',
    component: chain[0],
    componentChain: chain.length ? chain.slice().reverse() : undefined,
    file,
    line,
    column,
    confidence: file ? 'exact' : 'heuristic',
  };
}

function resolveVue(el) {
  let instance = el.__vueParentComponent || (el.__vnode && el.__vnode.component) || el.__vue__;
  if (!instance) return undefined;
  let file;
  const chain = [];
  let guard = 0;
  while (instance && guard < 200) {
    guard += 1;
    const type = instance.type || instance.$options;
    if (!file && type && typeof type.__file === 'string') file = normalizeFile(type.__file);
    const name = type && (type.name || type.__name);
    if (name && chain[chain.length - 1] !== name && chain.length < 6) chain.push(name);
    instance = instance.parent || instance.$parent;
  }
  if (!file && chain.length === 0) return undefined;
  return {
    framework: 'vue',
    component: chain[0],
    componentChain: chain.length ? chain.slice().reverse() : undefined,
    file,
    confidence: file ? 'exact' : 'heuristic',
  };
}

function resolveSvelte(el) {
  let node = el;
  let guard = 0;
  while (node && guard < 200) {
    guard += 1;
    const meta = node.__svelte_meta;
    if (meta && meta.loc && typeof meta.loc.file === 'string') {
      return {
        framework: 'svelte',
        file: normalizeFile(meta.loc.file),
        line: numberOr(meta.loc.line),
        column: numberOr(meta.loc.column),
        confidence: 'exact',
      };
    }
    node = node.parentElement;
  }
  return undefined;
}

function resolveAttributes(el) {
  let node = el;
  let guard = 0;
  while (node && guard < 200) {
    guard += 1;
    const path =
      node.getAttribute('data-inspector-relative-path') ||
      node.getAttribute('data-source-file') ||
      node.getAttribute('data-sourcefile') ||
      node.getAttribute('data-source');
    if (path) {
      return {
        component:
          node.getAttribute('data-component') || node.getAttribute('data-testid') || undefined,
        file: normalizeFile(path),
        line: numberOr(
          node.getAttribute('data-inspector-line') || node.getAttribute('data-source-line'),
        ),
        column: numberOr(
          node.getAttribute('data-inspector-column') || node.getAttribute('data-source-column'),
        ),
        confidence: 'attribute',
      };
    }
    node = node.parentElement;
  }
  return undefined;
}

function componentName(type) {
  if (typeof type === 'function') {
    const name = type.displayName || type.name;
    return name && /^[A-Z]/.test(name) ? name : undefined;
  }
  if (type && typeof type === 'object') {
    const name = type.displayName || type.name;
    return name && /^[A-Z]/.test(name) ? name : undefined;
  }
  return undefined;
}

function normalizeFile(file) {
  if (!file) return undefined;
  let normalized = String(file).replace(/[?#].*$/, '');
  const fsIndex = normalized.indexOf('/@fs/');
  if (fsIndex >= 0) normalized = normalized.slice(fsIndex + 4);
  normalized = normalized.replace(/^https?:\/\/[^/]+/, '');
  const srcIndex = normalized.lastIndexOf('/src/');
  if (srcIndex >= 0) return normalized.slice(srcIndex + 1);
  return normalized.replace(/^\//, '');
}

function numberOr(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : undefined;
}

function strokeLength(stroke) {
  let total = 0;
  for (let index = 1; index < stroke.length; index += 1) {
    total += Math.hypot(
      stroke[index].x - stroke[index - 1].x,
      stroke[index].y - stroke[index - 1].y,
    );
  }
  return total;
}

function strokesBounds(strokes) {
  const points = strokes.flat();
  if (points.length === 0) return null;
  const xs = points.map((pt) => pt.x);
  const ys = points.map((pt) => pt.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(1, Math.round(Math.max(...xs) - x)),
    height: Math.max(1, Math.round(Math.max(...ys) - y)),
  };
}

function boxFor(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function roleFor(el) {
  return (
    el.getAttribute('role') ||
    { A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox' }[
      el.tagName
    ] ||
    ''
  );
}

function directText(el) {
  if (redactedTextTags.has(el.tagName)) return '[redacted]';
  return cleanText(
    Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' '),
  );
}

function safeElementText(el, max = 180) {
  if (redactedTextTags.has(el.tagName)) return '[redacted]';
  if (!el.querySelector('script,style,noscript')) {
    return cleanText(el.innerText || el.textContent, max);
  }
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('script,style,noscript')) node.remove();
  return cleanText(clone.textContent, max);
}

function cleanText(value, max = 180) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}
