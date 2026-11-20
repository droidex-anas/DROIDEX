const { ipcRenderer } = require('electron');
const { createDesignOverlay, INTERNAL_ATTR } = require('./browserDesignOverlay.cjs');
const {
  boxFor,
  elementSelection,
  hoverInfo,
  inspectElement,
  pickTarget,
} = require('./browserElementInspection.cjs');

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

// Main calls these here, in the preload's isolated world (browserPageScript.cjs),
// where the page's own scripts can neither see nor call them. A saved login
// arrives only to be written into the page's inputs and is never returned, so
// the agent can authorize a login without reading it.
Object.assign(globalThis, {
  __droidexApplyDesignState: applyState,
  __droidexInspect: inspectElement,
  __droidexFillCredentials: fillCredentials,
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
  try {
    const form = event.target;
    if (!form || form.getAttribute(INTERNAL_ATTR)) return;
    const fields = form.querySelectorAll ? form.querySelectorAll('input') : [];
    let password = null;
    let username = null;
    for (const field of fields) {
      const type = (field.getAttribute('type') || '').toLowerCase();
      if (!password && type === 'password' && field.value) password = field.value;
      else if (
        !username &&
        (type === 'email' || type === 'text' || type === '' || type === 'tel') &&
        field.value
      )
        username = field.value;
    }
    if (!password) return;
    ipcRenderer.send('native-browser-credential-capture', {
      origin: location.origin,
      url: location.href,
      username: username || '',
      password,
    });
  } catch {
    /* never interfere with the page's own submit */
  }
}

function fillCredentials(payload) {
  try {
    if (!payload || payload.origin !== location.origin)
      return { ok: false, filled: false, error: 'The page changed before the login was filled.' };
    // Checked again around each focus: the page's handlers can take their time.
    const inTime = () => {
      if (payload.startBy && Date.now() >= payload.startBy)
        throw new Error('The browser page did not finish in time.');
    };
    inTime();
    const username = typeof payload.username === 'string' ? payload.username : '';
    const password = typeof payload.password === 'string' ? payload.password : '';
    if (!password) return { ok: false, filled: false };
    const passwordField = firstVisible(document.querySelectorAll('input[type="password"]'));
    if (!passwordField) return { ok: false, filled: false };
    if (username) {
      const userField = usernameFieldFor(passwordField);
      if (userField) setFieldValue(userField, username, inTime);
    }
    setFieldValue(passwordField, password, inTime);
    return { ok: true, filled: true };
  } catch (err) {
    return { ok: false, filled: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function usernameFieldFor(passwordField) {
  const form = passwordField.form;
  const scope = form || document;
  const fields = scope.querySelectorAll('input');
  let previous = null;
  for (const field of fields) {
    if (field === passwordField) break;
    const type = (field.getAttribute('type') || '').toLowerCase();
    if ((type === 'email' || type === 'text' || type === 'tel' || type === '') && isVisible(field))
      previous = field;
  }
  return (
    previous ||
    firstVisible(
      scope.querySelectorAll(
        'input[type="email"],input[type="text"],input[type="tel"],input:not([type])',
      ),
    )
  );
}

function setFieldValue(field, value, inTime) {
  inTime();
  field.focus();
  inTime();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function firstVisible(nodes) {
  for (const node of nodes) if (isVisible(node)) return node;
  return null;
}

function isVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );
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
