// The reporter the Canvas preview intermediate (canvasPreview.cjs) adds to
// every generated design. It runs inside the sandboxed design frame, so it is
// kept as source text here and installed by the intermediate.
//
// Kept free of `require('electron')` so it runs under plain Node.

/**
 * The reporter that runs inside the generated frame: readiness once it has
 * painted, its content size, and its own uncaught failures as bounded
 * diagnostics, with a root render that failed before painting marked
 * `render_failed`. It is the only code the host adds to a design, it talks to
 * the intermediate and nothing else, and the nonce it carries is a correlator
 * the generated code can read (spec §6), not an authorization token.
 *
 * It also answers the board's selection commands with a `selection` event for
 * the element picked or named, and again whenever that element's box moves,
 * each echoing the sequence number of the command it answers, and its hover
 * command with a `hover` event naming the element under a point. Its probe
 * command selects nothing either: a `probe` event names the element at a point,
 * or the text between two points and the element that holds it, and a `locate`
 * event gives the box of the first drawn instance of each element it names; a
 * `vector` event carries the design's root `<svg>` as a standalone file. A kit preview's
 * draft token values arrive as one set that replaces the last, as inline custom
 * properties on the root, which win over the kit's own root and mode rules.
 * The intermediate accepts `interaction` too, which nothing produces yet.
 */
/**
 * Bytes one `selection` event may measure. It is the one event the board must
 * never lose, so it has its own cap, and the reporter cuts long style values
 * until its answer fits rather than let the intermediate drop it.
 */
const MAX_PREVIEW_SELECTION_BYTES = 16384;
/** Bytes a vector design's markup may measure; a larger one is refused, never cut. */
const MAX_PREVIEW_VECTOR_BYTES = 256 * 1024;

const GENERATED_FRAME_REPORTER = `(() => {
  const nonce = '__CANVAS_PREVIEW_NONCE__';
  const post = (event, payload) => {
    try {
      parent.postMessage(Object.assign({ canvasPreview: nonce, event: event }, payload), '*');
    } catch {}
  };
  const report = (message, code = 'preview_error') => {
    post('diagnostics', {
      diagnostics: [{ code: code, message: String(message) }],
    });
  };
  addEventListener('error', (event) => report(event.message || 'The preview stopped with an error.'));
  addEventListener('unhandledrejection', (event) => report('Unhandled rejection: ' + String(event.reason)));
  const root = document.getElementById('canvas-root') || document.body;
  let lastWidth = -1;
  let lastHeight = -1;
  let ready = false;
  let reportedError = false;
  const measure = () => {
    const width = Math.ceil(root.scrollWidth);
    const height = Math.ceil(root.scrollHeight);
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    post('resize', { width: width, height: height });
  };
  const renderState = () => {
    const result = globalThis.__droidexCanvasRenderState;
    if (result?.state === 'failed') {
      if (!reportedError) report(result.message || 'The preview stopped with an error.', 'render_failed');
      reportedError = true;
      return;
    }
    if (result?.state !== 'committed' || ready) return;
    ready = true;
    requestAnimationFrame(() => {
      if (globalThis.__droidexCanvasRenderState?.state !== 'committed') return;
      new ResizeObserver(measure).observe(root);
      measure();
      post('ready', {});
    });
  };
  addEventListener('droidex-canvas-render-state', renderState);
  renderState();

  // The element the board selected: its source marker, where it sits under
  // the body, its box, the computed values of the properties the board asked
  // for and its text. The board's previews are inline styles on it and the
  // text it holds, put back as soon as the selection moves. Commands come only
  // from the intermediate, which is \`top\` here and, unlike \`parent\`, cannot
  // be replaced by the design.
  const MARKER = 'data-droidex-element';
  const kebab = (name) => name.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
  const pathOf = (node) => {
    const steps = [];
    for (let at = node; at !== document.body; at = at.parentElement) {
      if (!at || !at.parentElement) return null;
      steps.unshift(Array.prototype.indexOf.call(at.parentElement.children, at));
    }
    return steps.join('/');
  };
  const atPath = (path) => {
    let at = document.body;
    for (const step of path.split('/')) at = at && at.children[Number(step)];
    return at || null;
  };
  let selected = null;
  // The command that made the current selection; every report of it echoes
  // this so the board can tell its latest command's answer from a late one.
  let commandSequence = 0;
  let previewed = [];
  let previewedText = null;
  let lastSelection = '';
  let selectionQueued = false;
  // Text a direct edit can write is an element's one text node. It is offered
  // whole or not at all, within the intermediate's 512-byte text cap.
  const soleText = (node) => {
    const only = node.childNodes.length === 1 ? node.firstChild : null;
    return only && only.nodeType === Node.TEXT_NODE ? only : null;
  };
  const encoder = new TextEncoder();
  const bytes = (value) => encoder.encode(value).length;
  const textOf = (node) => {
    const value = previewedText ? previewedText.value : soleText(node)?.data;
    return typeof value === 'string' && bytes(value) <= 512 ? value : null;
  };
  const rectOf = (node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  // What a node beside the hovered element's ancestry paints, a box per line
  // where it wraps, so the lines before and after an inline element count.
  const paintedBoxes = (node) => {
    let boxes = [];
    if (node.nodeType === Node.TEXT_NODE && node.data.trim() !== '') {
      const range = document.createRange();
      range.selectNodeContents(node);
      boxes = range.getClientRects();
    } else if (node.nodeType === Node.ELEMENT_NODE) boxes = node.getClientRects();
    return Array.from(boxes).filter((box) => box.width > 0 && box.height > 0);
  };
  // How far a box can grow up and down, across its width, before it meets
  // anything but its own ancestors: a sibling, an ancestor's sibling or an
  // ancestor's own text. Null where nothing is in the way.
  const roomAround = (node) => {
    const own = node.getBoundingClientRect();
    let above = null;
    let below = null;
    for (let child = node; child.parentElement; child = child.parentElement) {
      for (const other of child.parentElement.childNodes) {
        if (other === child) continue;
        for (const box of paintedBoxes(other)) {
          if (box.right <= own.left || box.left >= own.right) continue;
          if (box.bottom <= own.top) above = Math.min(above ?? Infinity, own.top - box.bottom);
          if (box.top >= own.bottom) below = Math.min(below ?? Infinity, box.top - own.bottom);
        }
      }
    }
    return { above: above, below: below };
  };
  // Over the intermediate's cap the answer would be dropped and the board
  // would lose the selection, so every style value is cut to the same length,
  // shorter each round, until it fits. Cuts count code points, so none leaves
  // half a surrogate pair. The text stays whole or goes last.
  const SELECTION_BUDGET = ${String(MAX_PREVIEW_SELECTION_BYTES - 512)};
  const fitted = (element) => {
    if (bytes(JSON.stringify(element)) <= SELECTION_BUDGET) return element;
    for (const longest of [256, 64, 16, 0]) {
      const styles = {};
      for (const name of Object.keys(element.styles))
        styles[name] = Array.from(element.styles[name]).slice(0, longest).join('');
      const candidate = Object.assign({}, element, { styles: styles });
      if (bytes(JSON.stringify(candidate)) <= SELECTION_BUDGET) return candidate;
    }
    return Object.assign({}, element, { styles: {}, text: null });
  };
  const describe = () => {
    if (!selected || !selected.node.isConnected) return null;
    const node = selected.node;
    const computed = getComputedStyle(node);
    const styles = {};
    for (const name of selected.properties) styles[name] = computed.getPropertyValue(kebab(name));
    return fitted({
      elementId: selected.elementId,
      instancePath: selected.instancePath,
      rect: rectOf(node),
      styles: styles,
      text: textOf(node),
      parentDisplay: node.parentElement ? getComputedStyle(node.parentElement).display : '',
    });
  };
  const reportSelection = () => {
    if (selectionQueued) return;
    selectionQueued = true;
    requestAnimationFrame(() => {
      selectionQueued = false;
      const element = describe();
      const encoded = JSON.stringify(element);
      if (encoded === lastSelection) return;
      lastSelection = encoded;
      post('selection', { sequence: commandSequence, element: element });
    });
  };
  const watchSelected = new ResizeObserver(reportSelection);
  const select = (node, properties, styles, text, sequence) => {
    commandSequence = sequence;
    for (const entry of previewed.reverse())
      entry.node.style.setProperty(entry.property, entry.value, entry.priority);
    previewed = [];
    if (previewedText) previewedText.node.data = previewedText.value;
    previewedText = null;
    if (selected) watchSelected.unobserve(selected.node);
    const elementId = node ? node.getAttribute(MARKER) : null;
    const instancePath = node ? pathOf(node) : null;
    selected = elementId && instancePath !== null ? { node, elementId, instancePath, properties } : null;
    if (selected) {
      for (const [name, value] of Object.entries(styles)) {
        const property = kebab(name);
        previewed.push({
          node: node,
          property: property,
          value: node.style.getPropertyValue(property),
          priority: node.style.getPropertyPriority(property),
        });
        node.style.setProperty(property, value);
      }
      const shown = soleText(node);
      if (shown && typeof text === 'string') {
        previewedText = { node: shown, value: shown.data };
        shown.data = text;
      }
      watchSelected.observe(node);
    }
    // Every command is answered, even with the selection it already had.
    lastSelection = '';
    reportSelection();
  };
  new ResizeObserver(() => {
    if (selected) reportSelection();
  }).observe(root);
  addEventListener('scroll', () => {
    if (selected) reportSelection();
  }, true);
  // A probe's text is cut so its answer stays inside the intermediate's event
  // cap; the intermediate cuts it again, to its text cap.
  const probe = (command) => {
    let node = null;
    let spanned = null;
    if (command.at) {
      const hit = document.elementFromPoint(command.at.x, command.at.y);
      node = hit && hit.closest('[' + MARKER + ']');
    } else {
      const from = document.caretRangeFromPoint(command.from.x, command.from.y);
      const to = document.caretRangeFromPoint(command.to.x, command.to.y);
      if (!from || !to) return null;
      const range = from.cloneRange();
      if (from.compareBoundaryPoints(Range.START_TO_START, to) <= 0)
        range.setEnd(to.startContainer, to.startOffset);
      else range.setStart(to.startContainer, to.startOffset);
      const holder = range.commonAncestorContainer;
      const host = holder.nodeType === Node.ELEMENT_NODE ? holder : holder.parentElement;
      node = host && host.closest('[' + MARKER + ']');
      spanned = range.collapsed
        ? null
        : { excerpt: Array.from(range.toString()).slice(0, 512).join(''), rect: rectOf(range) };
    }
    const instancePath = node ? pathOf(node) : null;
    if (!node || instancePath === null) return null;
    return {
      elementId: node.getAttribute(MARKER),
      instancePath: instancePath,
      rect: rectOf(node),
      text: spanned,
    };
  };
  // A vector design is one <svg> under the root. Its copy carries the paint
  // and type the page's CSS gave each element, its tokens resolved, as inline
  // style, so the file draws the same on its own. An inherited property is
  // written where it changes; the others where they leave their initial value.
  const INHERITED_PAINT = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'letter-spacing',
  ];
  const OWN_PAINT = { 'stop-color': 'rgb(0, 0, 0)', 'flood-color': 'rgb(0, 0, 0)', opacity: '1' };
  const ABSOLUTE_LENGTH = /^[0-9]+([.][0-9]+)?(px)?$/;
  const vector = () => {
    const svg = root.childElementCount === 1 ? root.firstElementChild : null;
    if (!(svg instanceof SVGSVGElement)) return { refused: 'not_vector' };
    const copy = svg.cloneNode(true);
    const drawn = [svg, ...svg.querySelectorAll('*')];
    const copied = [copy, ...copy.querySelectorAll('*')];
    const computedOf = new Map();
    drawn.forEach((node, index) => {
      const computed = getComputedStyle(node);
      computedOf.set(node, computed);
      const inherited = index === 0 ? null : computedOf.get(node.parentElement);
      const style = copied[index].style;
      for (const name of INHERITED_PAINT) {
        const value = computed.getPropertyValue(name);
        if (!inherited || inherited.getPropertyValue(name) !== value) style.setProperty(name, value);
      }
      for (const [name, initial] of Object.entries(OWN_PAINT)) {
        const value = computed.getPropertyValue(name);
        if (value !== initial) style.setProperty(name, value);
      }
    });
    // A size from CSS or in percent means nothing outside the page: the file gets the drawn one.
    const box = svg.getBoundingClientRect();
    for (const [side, length] of [['width', box.width], ['height', box.height]]) {
      if (!ABSOLUTE_LENGTH.test(copy.getAttribute(side) || '')) copy.setAttribute(side, String(Math.ceil(length)));
    }
    const markup = new XMLSerializer().serializeToString(copy);
    return bytes(markup) <= ${String(MAX_PREVIEW_VECTOR_BYTES)} ? { svg: markup } : { refused: 'too_large' };
  };
  let draftTokens = [];
  const setTokens = (tokens) => {
    const style = document.documentElement.style;
    for (const name of draftTokens) style.removeProperty(name);
    draftTokens = Object.keys(tokens);
    for (const name of draftTokens) style.setProperty(name, tokens[name]);
  };
  addEventListener('message', (message) => {
    const command = message.data;
    if (message.source !== top || !command || command.canvasPreviewCommand !== nonce) return;
    if (command.command === 'setTokens') {
      setTokens(command.tokens);
    } else if (command.command === 'pick') {
      let node = null;
      if (command.step) {
        const marked = Array.from(document.querySelectorAll('[' + MARKER + ']'));
        const at = selected ? marked.indexOf(selected.node) : -1;
        const step = command.step === 'next' ? 1 : -1;
        node = command.step === 'first' || at < 0
          ? marked[0]
          : marked[Math.min(Math.max(at + step, 0), marked.length - 1)];
      } else {
        const hit = document.elementFromPoint(command.x, command.y);
        node = hit && hit.closest('[' + MARKER + ']');
      }
      if (selected && node === selected.node) {
        // The board keeps its draft for the element it already holds, so the
        // guest keeps showing what that draft previews and only answers, with
        // the properties the board asks for now.
        selected.properties = command.properties;
        commandSequence = command.sequence;
        lastSelection = '';
        reportSelection();
      } else {
        select(node || null, command.properties, {}, null, command.sequence);
      }
    } else if (command.command === 'hover') {
      const hit = document.elementFromPoint(command.x, command.y);
      const node = hit && hit.closest('[' + MARKER + ']');
      const instancePath = node ? pathOf(node) : null;
      post('hover', {
        sequence: command.sequence,
        element:
          node && instancePath !== null
            ? {
                elementId: node.getAttribute(MARKER),
                instancePath: instancePath,
                rect: rectOf(node),
                tagName: node.localName,
                room: roomAround(node),
              }
            : null,
      });
    } else if (command.command === 'probe') {
      post('probe', { sequence: command.sequence, element: probe(command) });
    } else if (command.command === 'locate') {
      const marked = Array.from(document.querySelectorAll('[' + MARKER + ']'));
      const rects = command.elementIds.map((elementId) => {
        const node = marked.find(
          (each) => each.getAttribute(MARKER) === elementId && paintedBoxes(each).length > 0,
        );
        return node ? rectOf(node) : null;
      });
      post('locate', { sequence: command.sequence, rects: rects });
    } else if (command.command === 'vector') {
      post('vector', Object.assign({ sequence: command.sequence }, vector()));
    } else if (command.command === 'select') {
      const target = command.target;
      const node = target ? atPath(target.instancePath) : null;
      const found = node && node.getAttribute(MARKER) === target.elementId ? node : null;
      select(
        found,
        command.properties,
        target ? target.styles : {},
        target ? target.text : null,
        command.sequence,
      );
    }
  });
})();`;

module.exports = {
  GENERATED_FRAME_REPORTER,
  MAX_PREVIEW_SELECTION_BYTES,
  MAX_PREVIEW_VECTOR_BYTES,
};
