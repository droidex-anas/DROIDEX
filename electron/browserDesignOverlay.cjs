// What design mode draws in the page: one hover outline that glides from
// element to element with its label docked to it, the numbered marks the user
// picked, the strokes of their sketches, and the area being dragged out. It
// lives in a closed shadow root, so the page's styles never reach it and the
// page cannot see it. The page script decides what to draw; this only draws.
//
// Colours and the font come from the app (setTheme), since the page cannot
// read the app's CSS. `ui` is how much larger than the page the overlay is
// drawn: the pane can show a page scaled down, and lines and labels keep their
// size on screen.

const INTERNAL_ATTR = 'data-droid-design';
const SVG_NS = 'http://www.w3.org/2000/svg';

const STYLE = `
:host { all: initial; }
.hover, .label, .mark, .badge, .area { position: fixed; left: 0; top: 0; pointer-events: none; box-sizing: border-box; }
.hover {
  border: calc(1.5px * var(--ui)) solid var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-radius: calc(1px * var(--ui));
  transition: transform 120ms var(--ease), width 120ms var(--ease), height 120ms var(--ease);
}
.label {
  display: flex; align-items: center; gap: 6px;
  max-width: 420px; padding: 4px 7px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--muted);
  font: 11px/16px var(--font); white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
  transform-origin: 0 0;
  transition: transform 120ms var(--ease);
}
.label b { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.label .swatch { width: 9px; height: 9px; border-radius: 2px; box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.45); }
.instant, .instant + .label { transition: none !important; }
.mark { border: calc(1.5px * var(--ui)) solid var(--accent); border-radius: calc(1px * var(--ui)); }
.badge {
  min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: var(--accent); color: var(--on-accent);
  font: 600 10px/16px var(--font); text-align: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transform-origin: 0 0;
}
.area { border: calc(1.5px * var(--ui)) dashed var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
svg { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
path { fill: none; stroke: var(--accent); stroke-width: calc(3px * var(--ui)); stroke-linecap: round; stroke-linejoin: round; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) { .hover, .label { transition: none; } }
`;

function createDesignOverlay(window) {
  const { document } = window;
  const host = document.createElement('div');
  host.setAttribute(INTERNAL_ATTR, '1');
  host.style.cssText = [
    'all:initial!important',
    'position:fixed!important',
    'left:0!important',
    'top:0!important',
    'width:0!important',
    'height:0!important',
    'display:block!important',
    'overflow:visible!important',
    'pointer-events:none!important',
    'z-index:2147483647!important',
    '--ease:cubic-bezier(0.2,0.8,0.2,1)',
    '--ui:1',
  ].join(';');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const strokes = document.createElementNS(SVG_NS, 'svg');
  const strokeLayer = document.createElementNS(SVG_NS, 'g');
  strokes.appendChild(strokeLayer);
  const area = div('area');
  const hover = div('hover');
  const label = div('label');
  const name = document.createElement('b');
  const size = document.createElement('span');
  const font = document.createElement('span');
  const swatch = div('swatch');
  label.append(name, size, font, swatch);
  root.append(style, strokes, area, hover, label);
  area.hidden = true;
  hideHover();

  let ui = 1;
  // Each mark's outline, badge and strokes, by mark id.
  const drawn = new Map();

  function div(className) {
    const node = document.createElement('div');
    node.className = className;
    return node;
  }

  function mount() {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  }

  function setTheme(theme, scale) {
    ui = scale;
    host.style.setProperty('--ui', String(ui));
    // onAccent becomes --on-accent, and so on.
    for (const [key, value] of Object.entries(theme || {}))
      if (typeof value === 'string' && value)
        host.style.setProperty(`--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value);
  }

  function setShown(shown) {
    if (shown) mount();
    host.style.setProperty('display', shown ? 'block' : 'none', 'important');
  }

  // Glides to the element's box; from hidden it appears in place instead.
  function showHover(rect, info) {
    const appearing = hover.hidden;
    if (appearing) hover.classList.add('instant');
    hover.hidden = false;
    label.hidden = false;
    name.textContent = info.name;
    size.textContent = info.size;
    font.textContent = info.font;
    swatch.style.background = info.color;
    placeHover(rect);
    if (appearing) settle();
  }

  // Follows the element as the page scrolls or resizes, without gliding.
  function followHover(rect) {
    if (hover.hidden) return;
    hover.classList.add('instant');
    placeHover(rect);
    settle();
  }

  function settle() {
    // Placed with no transition; the next move glides again.
    void hover.offsetWidth;
    window.requestAnimationFrame(() => hover.classList.remove('instant'));
  }

  function placeHover(rect) {
    hover.style.transform = `translate(${px(rect.x)}, ${px(rect.y)})`;
    hover.style.width = px(rect.width);
    hover.style.height = px(rect.height);
    placeLabel(rect);
  }

  // Docked under the outline's left edge, above it when there is no room
  // below, and inside its top when there is room for neither.
  function placeLabel(rect) {
    const width = label.offsetWidth * ui;
    const height = label.offsetHeight * ui;
    const gap = 4 * ui;
    const edge = 4 * ui;
    let top = rect.y + rect.height + gap;
    if (top + height > window.innerHeight - edge) top = rect.y - height - gap;
    if (top < edge) top = Math.max(edge, rect.y + gap);
    const left = Math.max(edge, Math.min(rect.x, window.innerWidth - width - edge));
    label.style.transform = `translate(${px(left)}, ${px(top)}) scale(${ui})`;
  }

  function hideHover() {
    hover.hidden = true;
    label.hidden = true;
  }

  // `marks`: [{ id, number, box (viewport) or null when off-page, strokes
  // (document coordinates) }]. The sketch layer is shifted by the scroll, so
  // strokes stay on what they were drawn over.
  function drawMarks(marks, scroll) {
    const ids = new Set();
    for (const mark of marks) {
      ids.add(mark.id);
      const item = drawn.get(mark.id) ?? addMark(mark.id);
      const box = mark.box;
      const outlined = Boolean(box) && !mark.strokes;
      item.outline.hidden = !outlined;
      item.badge.hidden = !box;
      if (box) {
        if (outlined) {
          item.outline.style.transform = `translate(${px(box.x)}, ${px(box.y)})`;
          item.outline.style.width = px(box.width);
          item.outline.style.height = px(box.height);
        }
        const badgeTop = box.y - 18 * ui >= 0 ? box.y - 18 * ui : box.y + 2 * ui;
        item.badge.style.transform = `translate(${px(box.x)}, ${px(badgeTop)}) scale(${ui})`;
        item.badge.textContent = String(mark.number);
      }
      drawStrokes(item, mark.strokes ?? []);
    }
    for (const [id, item] of drawn) {
      if (ids.has(id)) continue;
      item.outline.remove();
      item.badge.remove();
      item.group.remove();
      drawn.delete(id);
    }
    strokeLayer.setAttribute('transform', `translate(${-scroll.x} ${-scroll.y})`);
  }

  function addMark(id) {
    const item = {
      outline: div('mark'),
      badge: div('badge'),
      group: document.createElementNS(SVG_NS, 'g'),
    };
    root.insertBefore(item.outline, hover);
    root.insertBefore(item.badge, hover);
    strokeLayer.appendChild(item.group);
    drawn.set(id, item);
    return item;
  }

  function drawStrokes(item, list) {
    const paths = item.group.children;
    while (paths.length > list.length) paths[paths.length - 1].remove();
    list.forEach((stroke, index) => {
      const path = paths[index] ?? item.group.appendChild(document.createElementNS(SVG_NS, 'path'));
      path.setAttribute('d', strokePath(stroke));
    });
  }

  function showArea(box) {
    area.hidden = !box;
    if (!box) return;
    area.style.transform = `translate(${px(box.x)}, ${px(box.y)})`;
    area.style.width = px(box.width);
    area.style.height = px(box.height);
  }

  return { setTheme, setShown, showHover, followHover, hideHover, drawMarks, showArea };
}

function strokePath(stroke) {
  return stroke
    .map((pt, index) => `${index === 0 ? 'M' : 'L'}${Math.round(pt.x)} ${Math.round(pt.y)}`)
    .join(' ');
}

function px(value) {
  return `${Math.round(value * 10) / 10}px`;
}

module.exports = { createDesignOverlay, INTERNAL_ATTR };
