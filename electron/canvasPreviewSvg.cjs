// The generated frame reporter's answers about the design's SVG, kept as
// source text and written into GENERATED_FRAME_REPORTER, whose scope gives it
// `root` and `bytes`.
//
// Kept free of `require('electron')` so it runs under plain Node.

/** Bytes a vector design's markup may measure; a larger one is refused, never cut. */
const MAX_PREVIEW_VECTOR_BYTES = 256 * 1024;

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
  };`;

module.exports = { MAX_PREVIEW_VECTOR_BYTES, SVG_REPORTER };
