// The trusted intermediate's own script, which canvasPreview.cjs serves in
// every Canvas preview guest around the generated design's frame.
//
// Kept free of `require('electron')` so it runs under plain Node.

const {
  MAX_PREVIEW_SELECTION_BYTES,
  MAX_PREVIEW_VECTOR_BYTES,
} = require('./canvasPreviewReporter.cjs');

/** One message from the generated frame, as JSON, except a selection, which has its own cap. */
const MAX_PREVIEW_EVENT_BYTES = 4096;
/** Events held between two polls. Over this, a message is dropped and counted. */
const MAX_PREVIEW_QUEUED_EVENTS = 64;
/** Diagnostics one message may carry, and how much text each may carry. */
const MAX_PREVIEW_DIAGNOSTICS = 8;
/**
 * Bytes, like every other cap here, and the same number the renderer's reader
 * cuts to. Both sides cut rather than refuse, so a design cannot end its own
 * preview by writing a diagnostic in a script where characters are three bytes.
 */
const MAX_PREVIEW_TEXT_BYTES = 512;
/** Style properties one selection command may read and preview. */
const MAX_PREVIEW_STYLE_PROPERTIES = 64;
/** Draft token values one `setTokens` may carry, and how long each may be: a kit's caps. */
const MAX_PREVIEW_TOKENS = 128;
const MAX_PREVIEW_TOKEN_VALUE_LENGTH = 160;
/** How long a hover waits for the design to answer before it answers nothing. */
const PREVIEW_HOVER_DEADLINE_MS = 250;
/** How long a probe or a locate waits for the design to answer before it answers nothing. */
const PREVIEW_ANSWER_DEADLINE_MS = 250;
/** A vector answer walks every element of the design, so it gets longer than a probe. */
const PREVIEW_VECTOR_DEADLINE_MS = 2_000;
/** JSON escaping at most doubles the markup a vector answer carries. */
const MAX_PREVIEW_VECTOR_EVENT_BYTES = 2 * MAX_PREVIEW_VECTOR_BYTES + 1024;
/** Elements one locate may name, and how long each name may be. */
const MAX_PREVIEW_LOCATE_ELEMENTS = 8;
const MAX_PREVIEW_ELEMENT_ID_LENGTH = 128;
/** The nonce charset the intermediate will embed; the renderer mints hex. */
const PREVIEW_NONCE_PATTERN = '^[0-9a-f]{32}$';

/**
 * The intermediate's own script: the receiver, the bounded queue, and the
 * calls the renderer drives through `executeJavaScript`. `start` installs one
 * instance and nothing can replace it, so a second start reaches a fresh guest
 * or nothing; `drain` throws when this document was never started, which the
 * renderer reads as a guest it no longer owns. `pick` and `select` pass a
 * bounded selection command on to the generated frame, and `setTokens` a kit's
 * draft custom properties, which the reporter sets on the design's root.
 * `hover` asks which element is under a point, or where the one a path names
 * is drawn, and answers with it directly,
 * outside the queue, so the board's outline keeps up with the pointer.
 * `probe` answers directly too, with the element at a point or the text
 * between two points, `locate` with the boxes of the elements it names, and
 * `vector` with the design's root `<svg>` or why it has none; each of those
 * waits for its own answer.
 */
const INTERMEDIATE_SCRIPT = `(() => {
  const REPORTER = __CANVAS_PREVIEW_REPORTER__;
  const frame = document.querySelector('iframe');
  const queue = [];
  let instance = null;
  let dropped = 0;

  const encoder = new TextEncoder();
  const bytes = (value) => encoder.encode(value).length;
  // Cut on a code point boundary, to the same byte cap the renderer cuts to.
  const text = (value) => {
    if (typeof value !== 'string') return '';
    if (bytes(value) <= ${String(MAX_PREVIEW_TEXT_BYTES)}) return value;
    let cut = '';
    for (const character of value) {
      if (bytes(cut + character) > ${String(MAX_PREVIEW_TEXT_BYTES)}) break;
      cut += character;
    }
    return cut;
  };
  // An element's own text is never cut: the board writes it back whole, so
  // past the cap there is none to offer or preview.
  const whole = (value) =>
    typeof value === 'string' && bytes(value) <= ${String(MAX_PREVIEW_TEXT_BYTES)} ? value : null;
  const size = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;

  // The properties the board asked about last; a selection carries no others.
  let asked = [];
  // A command's sequence number, which its answer echoes.
  const isSequence = (value) => Number.isSafeInteger(value) && value > 0;
  // A box in the design's pixels, which may start above or left of its viewport.
  const rectOf = (value) => {
    if (!value || typeof value !== 'object') return null;
    const rect = {};
    for (const side of ['x', 'y', 'width', 'height']) {
      if (typeof value[side] !== 'number' || !Number.isFinite(value[side])) return null;
      rect[side] = value[side];
    }
    return rect.width < 0 || rect.height < 0 ? null : rect;
  };
  const normalizeSelection = (data) => {
    if (!isSequence(data.sequence)) return null;
    const element = data.element;
    if (element === null) return { event: 'selection', sequence: data.sequence, element: null };
    if (!element || typeof element !== 'object') return null;
    const rect = rectOf(element.rect);
    const elementId = text(element.elementId);
    if (!rect || !elementId) return null;
    const given = element.styles && typeof element.styles === 'object' ? element.styles : {};
    const styles = {};
    for (const name of asked) if (typeof given[name] === 'string') styles[name] = text(given[name]);
    return {
      event: 'selection',
      sequence: data.sequence,
      element: {
        elementId,
        instancePath: text(element.instancePath),
        rect,
        styles,
        text: whole(element.text),
        parentDisplay: text(element.parentDisplay),
      },
    };
  };
  // Space beside a box in the design's pixels, or null for none in the way.
  const gap = (value) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const normalizeHover = (element) => {
    if (!element || typeof element !== 'object') return null;
    const rect = rectOf(element.rect);
    const elementId = text(element.elementId);
    if (!rect || !elementId) return null;
    const room = element.room && typeof element.room === 'object' ? element.room : {};
    return {
      elementId,
      instancePath: text(element.instancePath),
      rect,
      tagName: text(element.tagName),
      room: { above: gap(room.above), below: gap(room.below) },
    };
  };
  // The one hover waiting for the frame's answer; a newer one answers it with nothing.
  let hovering = null;
  let hoverSequence = 0;

  const normalizeProbe = (element) => {
    if (!element || typeof element !== 'object') return null;
    const rect = rectOf(element.rect);
    const elementId = text(element.elementId);
    if (!rect || !elementId) return null;
    const spanned = element.text && typeof element.text === 'object' ? element.text : null;
    const spannedRect = spanned && rectOf(spanned.rect);
    return {
      elementId,
      instancePath: text(element.instancePath),
      rect,
      text: spannedRect ? { excerpt: text(spanned.excerpt), rect: spannedRect } : null,
    };
  };
  // Each probe or locate waiting for the frame's answer, by the sequence number it echoes.
  const waiting = new Map();
  let answerSequence = 0;
  // Sends the frame a command it answers directly, outside the queue, and
  // answers with what read makes of that answer, or null at the deadline.
  const askFrame = (command, read, deadlineMs = ${String(PREVIEW_ANSWER_DEADLINE_MS)}) => {
    answerSequence += 1;
    const sequence = answerSequence;
    return new Promise((resolve) => {
      const settle = (found) => {
        clearTimeout(deadline);
        waiting.delete(sequence);
        resolve(JSON.stringify(found));
      };
      const deadline = setTimeout(() => settle(null), deadlineMs);
      waiting.set(sequence, { event: command.command, settle: (data) => settle(read(data)) });
      frame.contentWindow.postMessage(
        Object.assign({ canvasPreviewCommand: instance.nonce, sequence }, command),
        '*',
      );
    });
  };
  const isElementId = (value) =>
    typeof value === 'string' && value.length > 0 && value.length <= ${String(MAX_PREVIEW_ELEMENT_ID_LENGTH)};
  const pointOf = (value) =>
    value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)
      ? { x: value.x, y: value.y }
      : null;
  // Child indices from the body down, as the reporter writes an element's path.
  const isPath = (value) => typeof value === 'string' && /^[0-9]+(?:[/][0-9]+)*$/.test(value);
  // One drawn instance of an element, by its marker and its path.
  const nodeOf = (value) =>
    isElementId(value.elementId) && isPath(value.instancePath)
      ? { elementId: value.elementId, instancePath: value.instancePath }
      : null;

  // Only these shapes leave the intermediate, rebuilt field by field so no
  // getter, prototype or extra property from generated code ever travels.
  const normalize = (data) => {
    if (data.event === 'ready') return { event: 'ready' };
    if (data.event === 'resize') {
      const width = size(data.width);
      const height = size(data.height);
      return width === null || height === null ? null : { event: 'resize', width, height };
    }
    if (data.event === 'diagnostics') {
      if (!Array.isArray(data.diagnostics)) return null;
      const diagnostics = data.diagnostics
        .slice(0, ${String(MAX_PREVIEW_DIAGNOSTICS)})
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({ code: text(entry.code) || 'preview_error', message: text(entry.message) }));
      return { event: 'diagnostics', diagnostics };
    }
    if (data.event === 'selection') return normalizeSelection(data);
    if (data.event === 'interaction') return { event: 'interaction', kind: text(data.kind) };
    return null;
  };

  // The board's two selection commands, passed to the reporter in the frame.
  // They name style properties to read and preview, never code to run, and
  // carry the board's sequence number for the answer to echo.
  const PICK_STEPS = ['first', 'next', 'previous'];
  const propertiesOf = (request) => {
    if (!request || typeof request !== 'object' || !Array.isArray(request.properties)) return null;
    const { properties } = request;
    if (properties.length > ${String(MAX_PREVIEW_STYLE_PROPERTIES)}) return null;
    const named = properties.every(
      (name) => typeof name === 'string' && /^[a-z][A-Za-z]{0,31}$/.test(name),
    );
    return named ? properties.slice() : null;
  };
  const command = (message) => {
    asked = message.properties;
    frame.contentWindow.postMessage(
      Object.assign({ canvasPreviewCommand: instance.nonce }, message),
      '*',
    );
    return 'sent';
  };

  addEventListener('message', (message) => {
    if (!instance || message.source !== frame.contentWindow) return;
    const data = message.data;
    if (!data || typeof data !== 'object' || data.canvasPreview !== instance.nonce) return;
    let encoded;
    try {
      encoded = JSON.stringify(data);
    } catch {
      return;
    }
    // Bytes, not code units: a string of astral characters is four times its
    // length and would otherwise pass a cap named in bytes.
    if (typeof encoded !== 'string') return;
    const oversized =
      data.event === 'selection'
        ? bytes(encoded) > ${String(MAX_PREVIEW_SELECTION_BYTES)}
        : data.event === 'vector'
          ? bytes(encoded) > ${String(MAX_PREVIEW_VECTOR_EVENT_BYTES)}
          : bytes(encoded) > ${String(MAX_PREVIEW_EVENT_BYTES)};
    if (oversized) {
      dropped += 1;
      return;
    }
    if (data.event === 'hover') {
      if (hovering && data.sequence === hovering.sequence) hovering.settle(normalizeHover(data.element));
      return;
    }
    if (data.event === 'probe' || data.event === 'locate' || data.event === 'vector') {
      const question = waiting.get(data.sequence);
      if (question?.event === data.event) question.settle(data);
      return;
    }
    const event = normalize(data);
    if (!event) return;
    // Only the latest selection means anything, so it replaces an earlier one.
    if (event.event === 'selection') {
      const earlier = queue.findIndex((queued) => queued.event === 'selection');
      if (earlier >= 0) queue.splice(earlier, 1);
    }
    // Full queue drops the newest: the queue never grows under a flood.
    if (queue.length >= ${String(MAX_PREVIEW_QUEUED_EVENTS)}) {
      dropped += 1;
      return;
    }
    queue.push(event);
  });

  globalThis.__droidexCanvasPreview = {
    start(request) {
      if (instance) return 'already_started';
      if (!request || typeof request !== 'object') return 'invalid_request';
      if (typeof request.nonce !== 'string' || !/${PREVIEW_NONCE_PATTERN}/.test(request.nonce))
        return 'invalid_request';
      if (typeof request.html !== 'string') return 'invalid_request';
      instance = {
        nonce: request.nonce,
        designId: String(request.designId),
        revisionId: String(request.revisionId),
        generation: Number(request.generation),
      };
      // Written with JS escapes so the HTML parser never sees a tag here.
      frame.srcdoc =
        request.html +
        '\\u003cscript>' +
        REPORTER.replace('__CANVAS_PREVIEW_NONCE__', request.nonce) +
        '\\u003c/script>';
      return 'started';
    },
    drain() {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const events = queue.splice(0, queue.length);
      const lost = dropped;
      dropped = 0;
      return JSON.stringify({
        nonce: instance.nonce,
        designId: instance.designId,
        revisionId: instance.revisionId,
        generation: instance.generation,
        events,
        dropped: lost,
      });
    },
    pick(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const properties = propertiesOf(request);
      if (!properties || !isSequence(request.sequence)) return 'invalid_request';
      const { sequence } = request;
      if (PICK_STEPS.includes(request.step))
        return command({ command: 'pick', sequence, step: request.step, properties });
      if (request.instancePath !== undefined) {
        const node = nodeOf(request);
        if (!node) return 'invalid_request';
        return command(Object.assign({ command: 'pick', sequence, properties }, node));
      }
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) return 'invalid_request';
      return command({ command: 'pick', sequence, x: request.x, y: request.y, properties });
    },
    select(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const properties = propertiesOf(request);
      if (!properties || !isSequence(request.sequence)) return 'invalid_request';
      const { sequence, target } = request;
      if (target === null) return command({ command: 'select', sequence, target: null, properties });
      if (
        !target ||
        typeof target !== 'object' ||
        typeof target.elementId !== 'string' ||
        !isPath(target.instancePath) ||
        !target.styles ||
        typeof target.styles !== 'object'
      )
        return 'invalid_request';
      const styles = {};
      for (const name of properties)
        if (typeof target.styles[name] === 'string') styles[name] = text(target.styles[name]);
      return command({
        command: 'select',
        sequence,
        target: {
          elementId: text(target.elementId),
          instancePath: target.instancePath,
          styles,
          text: whole(target.text),
        },
        properties,
      });
    },
    hover(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      if (!request || typeof request !== 'object') return 'invalid_request';
      const asked = request.instancePath === undefined ? pointOf(request) : nodeOf(request);
      if (!asked) return 'invalid_request';
      if (hovering) hovering.settle(null);
      hoverSequence += 1;
      const sequence = hoverSequence;
      return new Promise((resolve) => {
        let deadline = null;
        const settle = (element) => {
          clearTimeout(deadline);
          if (hovering && hovering.sequence === sequence) hovering = null;
          resolve(JSON.stringify(element));
        };
        hovering = { sequence, settle };
        deadline = setTimeout(() => settle(null), ${String(PREVIEW_HOVER_DEADLINE_MS)});
        frame.contentWindow.postMessage(
          Object.assign({ canvasPreviewCommand: instance.nonce, command: 'hover', sequence }, asked),
          '*',
        );
      });
    },
    probe(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      if (!request || typeof request !== 'object') return 'invalid_request';
      const at = pointOf(request.at);
      const from = pointOf(request.from);
      const to = pointOf(request.to);
      if (!at && !(from && to)) return 'invalid_request';
      const asked = at ? { at } : { from, to };
      return askFrame(Object.assign({ command: 'probe' }, asked), (data) =>
        normalizeProbe(data.element),
      );
    },
    locate(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const elementIds = request && typeof request === 'object' ? request.elementIds : null;
      const named = Array.isArray(elementIds) && elementIds.length <= ${String(MAX_PREVIEW_LOCATE_ELEMENTS)};
      if (!named || !elementIds.every(isElementId)) return 'invalid_request';
      const read = (data) =>
        Array.isArray(data.rects) && data.rects.length === elementIds.length ? data.rects.map(rectOf) : null;
      return askFrame({ command: 'locate', elementIds: elementIds.slice() }, read);
    },
    vector() {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const read = (data) => {
        if (typeof data.svg === 'string' && bytes(data.svg) <= ${String(MAX_PREVIEW_VECTOR_BYTES)})
          return { svg: data.svg };
        return data.refused === 'not_vector' || data.refused === 'too_large'
          ? { refused: data.refused }
          : null;
      };
      return askFrame({ command: 'vector' }, read, ${String(PREVIEW_VECTOR_DEADLINE_MS)});
    },
    setTokens(request) {
      if (!instance) throw new Error('This Canvas preview guest was never started.');
      const given = request && typeof request === 'object' ? request.tokens : null;
      if (!given || typeof given !== 'object') return 'invalid_request';
      const entries = Object.entries(given);
      if (entries.length > ${String(MAX_PREVIEW_TOKENS)}) return 'invalid_request';
      const tokens = {};
      for (const [name, value] of entries) {
        if (!/^--[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || typeof value !== 'string') return 'invalid_request';
        if (value.length > ${String(MAX_PREVIEW_TOKEN_VALUE_LENGTH)}) return 'invalid_request';
        tokens[name] = value;
      }
      frame.contentWindow.postMessage(
        { canvasPreviewCommand: instance.nonce, command: 'setTokens', tokens },
        '*',
      );
      return 'sent';
    },
    identity() {
      if (!instance) return null;
      return {
        designId: instance.designId,
        revisionId: instance.revisionId,
        generation: instance.generation,
      };
    },
  };
})();`;

module.exports = { INTERMEDIATE_SCRIPT };
