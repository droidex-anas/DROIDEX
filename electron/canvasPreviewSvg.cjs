// The generated frame's answers about the design's SVG, kept as source text:
// SVG_REPORTER goes into GENERATED_FRAME_REPORTER, whose scope gives it
// `root`, `bytes` and `rectOf`, and SVG_INTERMEDIATE into the intermediate's
// script, whose scope gives it `bytes` and `rectOf`.
//
// Kept free of `require('electron')` so it runs under plain Node.

/** Bytes a vector design's markup may measure; a larger one is refused, never cut. */
const MAX_PREVIEW_VECTOR_BYTES = 256 * 1024;
/** Bytes a path's `d` may measure, in a shape answer or a select's preview; a longer one is refused, never cut. */
const MAX_PREVIEW_PATH_DATA_BYTES = 16 * 1024;
/** JSON escaping at most doubles the whitespace a shape answer's `d` may carry. */
const MAX_PREVIEW_SHAPE_EVENT_BYTES = 2 * MAX_PREVIEW_PATH_DATA_BYTES + 1024;
const SVG_REPORTER = `
  // A vector design is one <svg> under the root. Its copy carries the paint
  // and type the page's CSS gave each element, its tokens resolved, as inline
  // style, so the file draws the same on its own. An inherited property is
  // written where it changes; the others where they leave their initial value.
  const INHERITED_PAINT = [
    'fill',
    'fill-opacity',
    'fill-rule',
    'clip-rule',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-miterlimit',
    'stroke-dasharray',
    'stroke-dashoffset',
    'paint-order',
    'visibility',
    'color',
    'font-family',
    'font-size',
    'font-style',
    'font-variant',
    'font-weight',
    'letter-spacing',
    'word-spacing',
    'text-anchor',
    'dominant-baseline',
  ];
  const OWN_PAINT = {
    'stop-color': 'rgb(0, 0, 0)',
    'stop-opacity': '1',
    'flood-color': 'rgb(0, 0, 0)',
    'flood-opacity': '1',
    opacity: '1',
    display: 'inline',
  };
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
    // Page CSS can override even an absolute width or height, so the file gets the drawn size.
    const box = svg.getBoundingClientRect();
    copy.setAttribute('width', String(Math.ceil(box.width)));
    copy.setAttribute('height', String(Math.ceil(box.height)));
    const markup = new XMLSerializer().serializeToString(copy);
    return bytes(markup) <= ${String(MAX_PREVIEW_VECTOR_BYTES)} ? { svg: markup } : { refused: 'too_large' };
  };
  // A path's own data, the matrix from its user units to the design's pixels,
  // which covers its viewBox, transforms and groups, and its box there. A path
  // drawn nowhere has no matrix, and one under display none no client rect.
  const shape = (node) => {
    if (!node) return null;
    if (!(node instanceof SVGPathElement)) return { refused: 'not_path' };
    const d = node.getAttribute('d') ?? '';
    if (bytes(d) > ${String(MAX_PREVIEW_PATH_DATA_BYTES)}) return { refused: 'too_large' };
    const matrix = node.getScreenCTM();
    if (!matrix || node.getClientRects().length === 0) return { refused: 'not_drawn' };
    const { a, b, c, d: scaleY, e, f } = matrix;
    return { d: d, matrix: [a, b, c, scaleY, e, f], rect: rectOf(node) };
  };`;

/**
 * Whether `d` is whole SVG path data, read the way Chromium draws it. Between
 * its parts, `board` data has spaces and commas only, as the board writes it;
 * `source` data any SVG whitespace, as a source may wrap. The sidecar
 * (sidecar/src/canvas/pathData.ts) and the renderer
 * (src/features/canvas/paths/pathData.ts) read it by the same rule;
 * sidecar/src/canvas/pathData.test.ts holds the three to one set of cases.
 * The intermediate runs this function's own text, so it uses nothing around it.
 */
function isPathData(d, spacing) {
  const space = spacing === 'source' ? '[ \\t\\n\\f\\r]*' : ' *';
  const SPACES = new RegExp(space, 'y');
  const SEPARATOR = new RegExp(`${space}(,?)${space}`, 'y');
  const NUMBER = /[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE]([+-]?[0-9]+))?/y;
  // An arc's large-arc and sweep flags are one digit each, which may touch what follows.
  const FLAG = /[01]/y;
  // How many numbers one segment of each command takes; Z takes none.
  const COMMAND_NUMBERS = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  // Only ASCII letters are commands, and `ſ` upper-cases to S.
  const upperCase = (character) =>
    /^[a-z]$/.test(character) ? character.toUpperCase() : character;
  const isCommand = (character) => Object.hasOwn(COMMAND_NUMBERS, upperCase(character));
  // Chromium reads a path's numbers as floats, and refuses one past 1e38 or an exponent past 38.
  const isInRange = ([number, exponent]) =>
    Math.abs(Number(number)) <= 1e38 && Number(exponent ?? 0) <= 38;
  let at = 0;
  const read = (pattern) => {
    pattern.lastIndex = at;
    const found = pattern.exec(d);
    if (found) at = pattern.lastIndex;
    return found;
  };
  read(SPACES);
  if (upperCase(d.charAt(at)) !== 'M') return false;
  while (at < d.length) {
    const command = upperCase(d.charAt(at));
    if (!isCommand(command)) return false;
    const count = COMMAND_NUMBERS[command];
    at += 1;
    read(SPACES);
    if (count === 0) continue;
    let comma = false;
    do {
      for (let index = 0; index < count; index += 1) {
        const isFlag = command === 'A' && (index === 3 || index === 4);
        const found = read(isFlag ? FLAG : NUMBER);
        if (!found || (!isFlag && !isInRange(found))) return false;
        comma = read(SEPARATOR)[1] === ',';
      }
      // A comma promises another segment; anything but a command or the end is one.
    } while (comma || (at < d.length && !isCommand(d.charAt(at))));
  }
  return true;
}

// A shape answer's `d` is the source's own; a preview's is the board's.
const SVG_INTERMEDIATE = `
  ${String(isPathData)}
  const isPreviewPathData = (value, spacing) =>
    typeof value === 'string' &&
    bytes(value) <= ${String(MAX_PREVIEW_PATH_DATA_BYTES)} &&
    isPathData(value, spacing);
  const SHAPE_REFUSALS = ['not_path', 'not_drawn', 'too_large', 'unreadable'];
  const normalizeShape = (shape) => {
    if (!shape || typeof shape !== 'object') return null;
    if (SHAPE_REFUSALS.includes(shape.refused)) return { refused: shape.refused };
    const { d, matrix } = shape;
    const rect = rectOf(shape.rect);
    const isMatrix = Array.isArray(matrix) && matrix.length === 6 && matrix.every(Number.isFinite);
    if (!rect || !isMatrix || typeof d !== 'string' || bytes(d) > ${String(MAX_PREVIEW_PATH_DATA_BYTES)})
      return null;
    // A source may write data Chromium draws only up to its first fault; the board cannot edit that.
    if (!isPathData(d, 'source')) return { refused: 'unreadable' };
    return { d, matrix: matrix.slice(), rect };
  };`;

module.exports = {
  MAX_PREVIEW_SHAPE_EVENT_BYTES,
  MAX_PREVIEW_VECTOR_BYTES,
  SVG_INTERMEDIATE,
  SVG_REPORTER,
  isPathData,
};
