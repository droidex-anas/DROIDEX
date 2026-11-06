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
 * command with a `hover` event naming the element under a point. A kit preview's
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
  // Over the intermediate's cap the answer would be dropped and the board
  // would lose the selection, so every style value is cut to the same length,
  // shorter each round, until it fits. The text stays whole or goes last.
  const SELECTION_BUDGET = ${String(MAX_PREVIEW_SELECTION_BYTES - 512)};
  const fitted = (element) => {
    if (bytes(JSON.stringify(element)) <= SELECTION_BUDGET) return element;
    for (const longest of [256, 64, 16, 0]) {
      const styles = {};
      for (const name of Object.keys(element.styles))
        styles[name] = element.styles[name].slice(0, longest);
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
              }
            : null,
      });
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

module.exports = { GENERATED_FRAME_REPORTER, MAX_PREVIEW_SELECTION_BYTES };
