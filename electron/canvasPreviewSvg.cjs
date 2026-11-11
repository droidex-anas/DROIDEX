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
  // drawn nowhere has no matrix.
  const shape = (node) => {
    if (!node) return null;
    if (!(node instanceof SVGPathElement)) return { refused: 'not_path' };
    const d = node.getAttribute('d') ?? '';
    if (bytes(d) > ${String(MAX_PREVIEW_PATH_DATA_BYTES)}) return { refused: 'too_large' };
    const matrix = node.getScreenCTM();
    if (!matrix) return { refused: 'not_drawn' };
    const { a, b, c, d: scaleY, e, f } = matrix;
    return { d: d, matrix: [a, b, c, scaleY, e, f], rect: rectOf(node) };
  };`;

// A shape answer's `d` is the source's own, which may wrap across lines; a
// preview's is the board's, written with spaces and commas only.
const SVG_INTERMEDIATE = `
  const PATH_DATA_CHARACTERS = /^[0-9MmLlHhVvCcSsQqTtAaZzEe.,+ -]*$/;
  const SOURCE_PATH_DATA_CHARACTERS = /^[0-9MmLlHhVvCcSsQqTtAaZzEe.,+\\t\\n\\f\\r -]*$/;
  const isPathData = (value, characters) =>
    typeof value === 'string' &&
    bytes(value) <= ${String(MAX_PREVIEW_PATH_DATA_BYTES)} &&
    characters.test(value);
  const SHAPE_REFUSALS = ['not_path', 'not_drawn', 'too_large'];
  const normalizeShape = (shape) => {
    if (!shape || typeof shape !== 'object') return null;
    if (SHAPE_REFUSALS.includes(shape.refused)) return { refused: shape.refused };
    const { matrix } = shape;
    const rect = rectOf(shape.rect);
    const isMatrix = Array.isArray(matrix) && matrix.length === 6 && matrix.every(Number.isFinite);
    if (!rect || !isMatrix || !isPathData(shape.d, SOURCE_PATH_DATA_CHARACTERS)) return null;
    return { d: shape.d, matrix: matrix.slice(), rect };
  };`;

module.exports = {
  MAX_PREVIEW_SHAPE_EVENT_BYTES,
  MAX_PREVIEW_VECTOR_BYTES,
  SVG_INTERMEDIATE,
  SVG_REPORTER,
};
