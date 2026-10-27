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
 * the element picked or named, and again whenever that element's box moves.
 * The intermediate accepts `interaction` too, which nothing produces yet.
 */
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
  // the body, its box and the computed values of the properties the board
  // asked for. The board's previews are inline styles on it, put back as soon
  // as the selection moves. Commands come only from the intermediate, which is
  // \`top\` here and, unlike \`parent\`, cannot be replaced by the design.
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
  let previewed = [];
  let lastSelection = '';
  let selectionQueued = false;
  const describe = () => {
    if (!selected || !selected.node.isConnected) return null;
    const box = selected.node.getBoundingClientRect();
    const computed = getComputedStyle(selected.node);
    const styles = {};
    for (const name of selected.properties)
      styles[name] = computed.getPropertyValue(kebab(name)).slice(0, 96);
    return {
      elementId: selected.elementId,
      instancePath: selected.instancePath,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      styles: styles,
    };
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
      post('selection', { element: element });
    });
  };
  const watchSelected = new ResizeObserver(reportSelection);
  const select = (node, properties, styles) => {
    for (const entry of previewed.reverse())
      entry.node.style.setProperty(entry.property, entry.value, entry.priority);
    previewed = [];
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
  addEventListener('message', (message) => {
    const command = message.data;
    if (message.source !== top || !command || command.canvasPreviewCommand !== nonce) return;
    if (command.command === 'pick') {
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
      select(node || null, command.properties, {});
    } else if (command.command === 'select') {
      const target = command.target;
      const node = target ? atPath(target.instancePath) : null;
      const found = node && node.getAttribute(MARKER) === target.elementId ? node : null;
      select(found, command.properties, target ? target.styles : {});
    }
  });
})();`;

module.exports = { GENERATED_FRAME_REPORTER };
